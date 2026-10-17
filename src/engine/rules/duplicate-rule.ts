import type { RuleResult } from "@/contracts/decision";
import { type HistoryEntry, isCountedInBudget } from "@/contracts/history";
import { normalizePayee } from "@/contracts/payee";
import { normalizeReference } from "@/contracts/reference";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import { type RuleContext, toLocalDate } from "../rule-context";
import { isOneSwapApart, isWithinOneEdit } from "./edit-distance";

type Match = {
  entry: HistoryEntry;
  kind: "EXACT" | "NEAR" | "UNREADABLE_REFERENCE" | "UNREADABLE_AMOUNT";
};

// R2: the invoice is compared with every past invoice of any period except itself. The same file, or
// an exact duplicate (same payee, amount, currency and reference) of a payable or pending invoice
// -> BLOCK. A near duplicate, a match with a rejected or blocked invoice, or a match where a reference
// could not be read -> ESCALATE: a person decides, and nothing is presented as fraud.
export function evaluateDuplicateRule(ctx: RuleContext): RuleResult {
  const { invoice, config, history } = ctx;
  const { payee, amountMinor, currency, reference } = invoice.extraction;
  const others = history.filter((entry) => entry.invoiceId !== invoice.id);
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

  const invoiceReference = reference.value;
  const isReferenceCertain = !reference.isUncertain;
  const invoicePayee = normalizePayee(payee.value);
  const matches = others
    .map((entry) => {
      const isSamePayee = entry.payee !== null && normalizePayee(entry.payee) === invoicePayee;
      // A past invoice whose amount or currency could not be read (kept so a resubmitted copy is
      // caught) is compared on payee and reference only; it can never be proven identical.
      if (entry.amountMinor === null || entry.currency === null) {
        const byReference = isSamePayee
          ? classify(entry, invoiceReference, isReferenceCertain)
          : null;
        const isReferenceMatch =
          byReference !== null && byReference.kind !== "UNREADABLE_REFERENCE";
        return isReferenceMatch ? { entry, kind: "UNREADABLE_AMOUNT" as const } : null;
      }
      const isSameMoney =
        entry.amountMinor === amountMinor.value && entry.currency === currency.value;
      return (isSamePayee || entry.payee === null) && isSameMoney
        ? classify(entry, invoiceReference, isReferenceCertain)
        : null;
    })
    .filter((match): match is Match => match !== null);

  const blocking = matches.find(
    ({ entry, kind }) =>
      kind === "EXACT" && entry.payee !== null && isCountedInBudget(entry.status),
  );
  if (blocking !== undefined) {
    const { entry } = blocking;
    return result(
      "BLOCK",
      MESSAGES.duplicate.exact(
        entry.reference ?? "",
        entry.payee ?? "",
        formatMoney(entry.amountMinor ?? 0, entry.currency ?? ""),
        toLocalDate(entry.decidedAt, config.timezone),
      ),
      "EXACT",
      entry,
    );
  }

  // A match with a rejected or blocked invoice explains best why a person must look again.
  const review = matches.find(({ entry }) => !isCountedInBudget(entry.status)) ?? matches[0];
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
        MESSAGES.duplicate.unreadableAmount(entry.reference ?? "", date),
        "UNREADABLE_AMOUNT",
        entry,
      );
    }
    if (kind === "UNREADABLE_REFERENCE") {
      return result(
        "ESCALATE",
        MESSAGES.duplicate.unreadableReference(
          payee.value,
          formatMoney(amountMinor.value, currency.value),
        ),
        "UNREADABLE_REFERENCE",
        entry,
      );
    }
    return result(
      "ESCALATE",
      MESSAGES.duplicate.near(entry.reference ?? "", invoiceReference ?? ""),
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
function classify(
  entry: HistoryEntry,
  invoiceReference: string | null,
  isReferenceCertain: boolean,
): Match | null {
  if (entry.reference === null || invoiceReference === null) {
    return { entry, kind: "UNREADABLE_REFERENCE" };
  }
  const past = normalizeReference(entry.reference);
  const current = normalizeReference(invoiceReference);
  if (past === current) return { entry, kind: entry.payee === null ? "NEAR" : "EXACT" };
  // Digits other than 0-9 (Arabic-Indic, Devanagari...) are not folded by NFKC, so such a reference
  // cannot be compared reliably: it needs review, like an unreadable one.
  const hasForeignDigits = (text: string) => /[^0-9]/u.test(text.replace(/[^\p{Nd}]/gu, ""));
  if (!isReferenceCertain || hasForeignDigits(past) || hasForeignDigits(current)) {
    return { entry, kind: "UNREADABLE_REFERENCE" };
  }
  const isNear =
    isWithinOneEdit(past, current) ||
    isOneSwapApart(past, current) ||
    withoutZeros(past) === withoutZeros(current);
  if (isNear) {
    return { entry, kind: "NEAR" };
  }
  return null;
}

// Compares normalized references ignoring every zero, so padding never hides a copy, however it is
// written: "FAC-00102" vs "FAC-102", "INV-2026-007" vs "INV-2026-7", zeros split by invisible
// characters or spaces. Broader than leading zeros only ("FAC-120" vs "FAC-12" also match), which is
// the safe direction: it only applies to the same payee, amount and currency, and only escalates.
function withoutZeros(normalizedReference: string): string {
  return normalizedReference.replaceAll("0", "");
}
