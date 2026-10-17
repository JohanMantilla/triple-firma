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

  const unreadable = [
    (payee.value === null || payee.isUncertain) && MESSAGES.fieldLabels.payee,
    (amountMinor.value === null || amountMinor.isUncertain) && MESSAGES.fieldLabels.amountMinor,
    (currency.value === null || currency.isUncertain) && MESSAGES.fieldLabels.currency,
  ].filter((label): label is string => typeof label === "string");
  // payee.value === null is already in `unreadable`; repeating it lets TypeScript narrow payee.value.
  if (unreadable.length > 0 || payee.value === null) {
    return result("ESCALATE", MESSAGES.duplicate.unreadable(unreadable.join(", ")), "UNREADABLE");
  }

  const invoiceReference = reference.isUncertain ? null : reference.value;
  const invoicePayee = normalizePayee(payee.value);
  const matches = others
    .map((entry) => {
      const isSamePayee = entry.payee !== null && normalizePayee(entry.payee) === invoicePayee;
      // A past invoice whose amount or currency could not be read (kept so a resubmitted copy is
      // caught) is compared on payee and reference only; it can never be proven identical.
      if (entry.amountMinor === null || entry.currency === null) {
        const byReference = isSamePayee ? classify(entry, invoiceReference) : null;
        const isReferenceMatch =
          byReference !== null && byReference.kind !== "UNREADABLE_REFERENCE";
        return isReferenceMatch ? { entry, kind: "UNREADABLE_AMOUNT" as const } : null;
      }
      const isSameMoney =
        entry.amountMinor === amountMinor.value && entry.currency === currency.value;
      return (isSamePayee || entry.payee === null) && isSameMoney
        ? classify(entry, invoiceReference)
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

  const review = matches[0];
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
          formatMoney(amountMinor.value ?? 0, currency.value ?? ""),
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

  return result("PASS", MESSAGES.duplicate.none, "NONE");
}

// Same payee, amount and currency are already known; the reference decides how close the match is.
// A missing payee or reference on either side cannot rule a duplicate out, so it needs review.
function classify(entry: HistoryEntry, invoiceReference: string | null): Match | null {
  if (entry.reference === null || invoiceReference === null) {
    return { entry, kind: "UNREADABLE_REFERENCE" };
  }
  const past = normalizeReference(entry.reference);
  const current = normalizeReference(invoiceReference);
  if (past === current) return { entry, kind: entry.payee === null ? "NEAR" : "EXACT" };
  const isNear =
    isWithinOneEdit(past, current) ||
    isOneSwapApart(past, current) ||
    normalizeReference(stripLeadingZeros(entry.reference)) ===
      normalizeReference(stripLeadingZeros(invoiceReference));
  if (isNear) {
    return { entry, kind: "NEAR" };
  }
  return null;
}

// "FAC-00102" -> "FAC-102", "INV-2026-007" -> "INV-2026-7": leading zeros of every run of digits are
// dropped. It runs on the reference as written, before normalizeReference joins its digit groups.
function stripLeadingZeros(reference: string): string {
  return reference.replace(/(?<!\d)0+(?=\d)/g, "");
}
