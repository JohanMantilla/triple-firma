import type { RuleResult } from "@/contracts/decision";
import { type HistoryEntry, isCountedInBudget } from "@/contracts/history";
import { normalizePayee } from "@/contracts/payee";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import { daysBetween, type RuleContext, toLocalDate } from "../rule-context";
import { isNearPayee } from "./payee-similarity";

// R7: a payment split into smaller invoices must not slip under the approval threshold. This invoice
// plus the earlier payments to the same payee within the window are summed in the base currency;
// strictly above approvalThresholdMinor a person must approve. The window is splitPaymentWindowDays
// calendar days in the company's time zone, today included, by the date each entry was decided.
//
// Earlier payments are PAYABLE and PENDING_APPROVAL entries (the parts of a split usually arrive
// together, so the first ones may still be pending) with a known base amount; REJECTED and BLOCKED
// are never paid. The window applies to PAYABLE entries only: a pending escalation, if it is ever paid,
// is paid when approved, today or later, so it counts whatever date it was escalated on. The payee
// matches through normalizePayee or, as in R3, as a look-alike name: R3 escalates the look-alike
// invoice itself, but once a person approved it, the next invoice with the exact name must still add it.
// An entry with this invoice's id counts too, as in R6: ids are assigned outside the engine, and
// deciding an invoice again can then escalate it but never pay it twice (R7 is not revalidated at
// approval). Without earlier payments there is no split, and an invoice that alone exceeds the
// threshold is R5's job.
export function evaluateSplitPaymentRule(ctx: RuleContext): RuleResult {
  const { invoice, config, baseAmountMinor } = ctx;
  const { value: payee, isUncertain } = invoice.extraction.payee;
  const { splitPaymentWindowDays: windowDays, approvalThresholdMinor, baseCurrency } = config;
  const today = toLocalDate(ctx.now, config.timezone);
  const result = (outcome: RuleResult["outcome"], message: string, details = {}): RuleResult => ({
    ruleId: "R7",
    outcome,
    message,
    compared: { today, windowDays, approvalThresholdMinor, baseAmountMinor, ...details },
  });

  if (payee === null || isUncertain) {
    return result("ESCALATE", MESSAGES.splitPayment.unreadablePayee);
  }
  if (baseAmountMinor === null) {
    return result("ESCALATE", MESSAGES.splitPayment.missingBaseAmount(baseCurrency));
  }

  const earlier = ctx.history.filter((entry) => isEarlierPart(entry, ctx, payee, today));
  if (earlier.length === 0) {
    return result("PASS", MESSAGES.splitPayment.noEarlierPayments(payee, windowDays), {
      earlierCount: 0,
      pendingCount: 0,
      earlierInvoiceIds: "",
      earlierSumMinor: 0,
      totalMinor: baseAmountMinor,
    });
  }

  const earlierSumMinor = sumMinor(earlier.map((entry) => entry.baseAmountMinor));
  const totalMinor = sumMinor([earlierSumMinor, baseAmountMinor]);
  const money = (amountMinor: number) => formatMoney(amountMinor, baseCurrency);
  const pendingCount = earlier.filter((entry) => entry.status === "PENDING_APPROVAL").length;
  const parts = { windowDays, paymentCount: earlier.length - pendingCount, pendingCount };
  // The approver can see which invoices were summed.
  const details = {
    earlierCount: earlier.length,
    pendingCount,
    earlierInvoiceIds: earlier.map((entry) => entry.invoiceId).join(","),
    earlierSumMinor,
    totalMinor,
  };
  const threshold = money(approvalThresholdMinor);
  if (totalMinor > approvalThresholdMinor) {
    return result(
      "ESCALATE",
      MESSAGES.splitPayment.overThreshold(payee, money(totalMinor), parts, threshold),
      details,
    );
  }
  return result(
    "PASS",
    MESSAGES.splitPayment.withinThreshold(payee, money(totalMinor), parts, threshold),
    details,
  );
}

// A PAYABLE entry decided in the future (a clock skew or a replay) still counts: the stricter choice.
function isEarlierPart(
  entry: HistoryEntry,
  ctx: RuleContext,
  payee: string,
  today: string,
): entry is HistoryEntry & { baseAmountMinor: number } {
  if (!isCountedInBudget(entry.status)) return false;
  if (entry.baseAmountMinor === null || entry.payee === null) return false;
  if (!isSamePayee(entry.payee, payee)) return false;
  if (entry.status === "PENDING_APPROVAL") return true;
  const decidedOn = toLocalDate(entry.decidedAt, ctx.config.timezone);
  return daysBetween(decidedOn, today) < ctx.config.splitPaymentWindowDays;
}

// Counting a look-alike name can only add parts, so it never makes the rule pass.
function isSamePayee(entryPayee: string, payee: string): boolean {
  return normalizePayee(entryPayee) === normalizePayee(payee) || isNearPayee(entryPayee, payee);
}

// Sums stay exact: a total beyond safe integers throws, and the runner escalates the rule.
function sumMinor(amounts: readonly number[]): number {
  const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Split payment sum exceeds safe integer range");
  }
  return Number(total);
}
