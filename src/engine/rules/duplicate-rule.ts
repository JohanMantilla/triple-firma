import type { RuleResult } from "@/contracts/decision";
import { type HistoryEntry, isCountedInBudget } from "@/contracts/history";
import type { Invoice } from "@/contracts/invoice";
import { normalizePayee } from "@/contracts/payee";
import { normalizeReference } from "@/contracts/reference";
import { formatMoney } from "../format-money";
import { MESSAGES, quoteUntrusted } from "../messages";
import { type RuleContext, toLocalDate } from "../rule-context";
import { isOneSwapApart, isWithinOneEdit } from "./edit-distance";

type MatchKind = "EXACT" | "NEAR" | "UNREADABLE_AMOUNT" | "UNREADABLE_REFERENCE";
type Match = { entry: HistoryEntry; kind: MatchKind };

// The invoice's own reference, normalized once for the whole history.
type CurrentReference = { normalized: string | null; isCertain: boolean };

// From the strongest match to the weakest: the explanation reports the strongest one.
const STRENGTH: Record<MatchKind, number> = {
  EXACT: 0,
  NEAR: 1,
  UNREADABLE_AMOUNT: 2,
  UNREADABLE_REFERENCE: 3,
};

// R2: the invoice is compared with every past invoice of any period except its own pending escalation
// (same id, same file, PENDING_APPROVAL), which is the one being decided. Its own entry once PAYABLE
// is not skipped: deciding an invoice that was already paid blocks it as the same file, so a retry can
// never pay it twice. Ids come from outside the engine, so the same id with another file is compared
// like any other invoice. The same file, or
// an exact duplicate (same payee, amount, currency and reference) of a payable or pending invoice
// -> BLOCK. A near duplicate, a match with a rejected or blocked invoice, or a match where a reference
// could not be read -> ESCALATE: a person decides, and nothing is presented as fraud.
export function evaluateDuplicateRule(ctx: RuleContext): RuleResult {
  const { invoice, config, history } = ctx;
  const { payee, amountMinor, currency, reference } = invoice.extraction;
  const others = history.filter((entry) => !isOwnPendingEntry(entry, invoice));
  const result = (
    outcome: RuleResult["outcome"],
    message: string,
    matchType: string,
    entry: HistoryEntry | null = null,
  ): RuleResult => ({
    ruleId: "R2",
    outcome,
    message,
    compared: {
      matchType,
      matchedInvoiceId: entry?.invoiceId ?? null,
      matchedStatus: entry?.status ?? null,
      matchedReference: entry?.reference ?? null,
    },
  });

  const sameFile = others.find((entry) => entry.fileHash === invoice.fileHash);
  if (sameFile !== undefined) {
    return result("BLOCK", MESSAGES.duplicate.sameFile(sameFile.invoiceId), "SAME_FILE", sameFile);
  }

  // A missing value leaves nothing to compare. An uncertain one is still compared with history, so a
  // copy of a paid invoice is reported (or blocked) instead of hidden behind "could not be read".
  const labelsOf = (isProblem: (field: { value: unknown; isUncertain: boolean }) => boolean) =>
    [
      isProblem(payee) && MESSAGES.fieldLabels.payee,
      isProblem(amountMinor) && MESSAGES.fieldLabels.amountMinor,
      isProblem(currency) && MESSAGES.fieldLabels.currency,
    ].filter((label): label is string => typeof label === "string");
  if (payee.value === null || amountMinor.value === null || currency.value === null) {
    const missing = labelsOf((field) => field.value === null).join(", ");
    return result("ESCALATE", MESSAGES.duplicate.unreadable(missing), "UNREADABLE");
  }
  const uncertain = labelsOf((field) => field.isUncertain);

  const current: CurrentReference = {
    normalized: reference.value === null ? null : normalizeReference(reference.value),
    isCertain: !reference.isUncertain,
  };
  const invoicePayee = normalizePayee(payee.value);
  const matches = others
    .map((entry): Match | null => {
      const isSamePayee = entry.payee !== null && normalizePayee(entry.payee) === invoicePayee;
      // A past invoice whose amount or currency could not be read (kept so a resubmitted copy is
      // caught) is compared on payee and reference only; it can never be proven identical.
      if (entry.amountMinor === null || entry.currency === null) {
        const byReference = isSamePayee ? classify(entry, current) : null;
        const isReferenceMatch =
          byReference !== null && byReference.kind !== "UNREADABLE_REFERENCE";
        return isReferenceMatch ? { entry, kind: "UNREADABLE_AMOUNT" } : null;
      }
      const isSameMoney =
        entry.amountMinor === amountMinor.value && entry.currency === currency.value;
      if (!isSameMoney || (!isSamePayee && entry.payee !== null)) return null;
      const match = classify(entry, current);
      // An anonymous past invoice (no payee) with a missing reference on either side would match
      // every invoice of that amount, from any payee: it is too weak to compare and is skipped. Only
      // a missing reference skips it; a reference that is present but unclear (foreign digits, an
      // uncertain reading) still needs review.
      const isReferenceMissing = entry.reference === null || current.normalized === null;
      return entry.payee === null && isReferenceMissing ? null : match;
    })
    .filter((match): match is Match => match !== null);

  const reportPayee = quoteUntrusted(payee.value);
  const reportAmount = formatMoney(amountMinor.value, currency.value);
  const blocking = matches.find(
    ({ entry, kind }) => kind === "EXACT" && isCountedInBudget(entry.status),
  );
  if (blocking !== undefined) {
    const { entry } = blocking;
    const date = toLocalDate(entry.decidedAt, config.timezone);
    return result(
      "BLOCK",
      MESSAGES.duplicate.exact(entry.reference, reportPayee, reportAmount, date),
      "EXACT",
      entry,
    );
  }

  // The strongest match is reported; between equally strong ones, a rejected or blocked invoice
  // explains best why a person must look again.
  const review = [...matches].sort(
    (a, b) =>
      STRENGTH[a.kind] - STRENGTH[b.kind] ||
      Number(isCountedInBudget(a.entry.status)) - Number(isCountedInBudget(b.entry.status)),
  )[0];
  if (review !== undefined) {
    const { entry, kind } = review;
    const date = toLocalDate(entry.decidedAt, config.timezone);
    if (!isCountedInBudget(entry.status)) {
      const isRejected = entry.status === "REJECTED";
      return result(
        "ESCALATE",
        MESSAGES.duplicate.previouslyResolved(entry.reference, isRejected, date),
        isRejected ? "PREVIOUSLY_REJECTED" : "PREVIOUSLY_BLOCKED",
        entry,
      );
    }
    if (kind === "UNREADABLE_AMOUNT") {
      return result(
        "ESCALATE",
        MESSAGES.duplicate.unreadableAmount(entry.reference, date),
        "UNREADABLE_AMOUNT",
        entry,
      );
    }
    if (kind === "UNREADABLE_REFERENCE") {
      return result(
        "ESCALATE",
        MESSAGES.duplicate.unreadableReference(reportPayee, reportAmount),
        "UNREADABLE_REFERENCE",
        entry,
      );
    }
    return result(
      "ESCALATE",
      MESSAGES.duplicate.near(entry.reference, reference.value),
      "NEAR",
      entry,
    );
  }

  if (uncertain.length > 0) {
    return result("ESCALATE", MESSAGES.duplicate.unreadable(uncertain.join(", ")), "UNREADABLE");
  }
  return result("PASS", MESSAGES.duplicate.none, "NONE");
}

// Same payee, amount and currency are already known; the reference decides how close the match is.
// A missing payee or reference on either side cannot rule a duplicate out, so it needs review. An
// uncertain reference still blocks an exact copy, but any other reference of the same payee and
// amount needs review, since the reading itself may be wrong.
function classify(entry: HistoryEntry, current: CurrentReference): Match | null {
  if (entry.reference === null || current.normalized === null) {
    return { entry, kind: "UNREADABLE_REFERENCE" };
  }
  const past = normalizeReference(entry.reference);
  if (past === current.normalized) return { entry, kind: entry.payee === null ? "NEAR" : "EXACT" };
  if (!current.isCertain || hasForeignDigits(past) || hasForeignDigits(current.normalized)) {
    return { entry, kind: "UNREADABLE_REFERENCE" };
  }
  const isNear =
    isWithinOneEdit(past, current.normalized) ||
    isOneSwapApart(past, current.normalized) ||
    withoutZeros(past) === withoutZeros(current.normalized);
  return isNear ? { entry, kind: "NEAR" } : null;
}

// Digits other than 0-9 (Arabic-Indic, Devanagari...) are not folded by NFKC, so such a reference
// cannot be compared reliably: it needs review, like an unreadable one.
function hasForeignDigits(normalizedReference: string): boolean {
  return /[^0-9]/.test(normalizedReference.replace(/[^\p{Nd}]/gu, ""));
}

// Compares normalized references ignoring every zero, so padding never hides a copy, however it is
// written: "FAC-00102" vs "FAC-102", "INV-2026-007" vs "INV-2026-7", zeros split by invisible
// characters or spaces. Broader than leading zeros only ("FAC-120" vs "FAC-12" also match), which is
// the safe direction: it only applies to the same payee, amount and currency, and only escalates.
function withoutZeros(normalizedReference: string): string {
  return normalizedReference.replaceAll("0", "");
}

// The escalation of this same invoice that a person is deciding: it must not count as its own duplicate.
function isOwnPendingEntry(entry: HistoryEntry, invoice: Invoice): boolean {
  return (
    entry.invoiceId === invoice.id &&
    entry.fileHash === invoice.fileHash &&
    entry.status === "PENDING_APPROVAL"
  );
}
