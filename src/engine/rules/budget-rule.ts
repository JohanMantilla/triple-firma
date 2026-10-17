import type { RuleResult } from "@/contracts/decision";
import { isCountedInBudget } from "@/contracts/history";
import { formatMoney } from "../format-money";
import { formatPeriod, MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";

export type BudgetCheckOptions = {
  // R6 reserves budget for pending escalations. Approval revalidation does not: the approver is
  // choosing among them, so two pending escalations must not block each other (invariant 8).
  isReservingPending: boolean;
};

// R6: the payment must fit in the monthly budget of the current period. PAYABLE entries of the period
// are committed; PENDING_APPROVAL entries with a known base amount are reserved. Over the committed budget the payment
// is blocked; fitting only without the reservations, a person must choose. "Exceeds" is strictly greater.
export function evaluateBudgetRule(ctx: RuleContext): RuleResult {
  return checkBudget(ctx, { isReservingPending: true });
}

export function checkBudget(ctx: RuleContext, options: BudgetCheckOptions): RuleResult {
  const { baseAmountMinor, config, period } = ctx;
  const { monthlyBudgetMinor, baseCurrency } = config;
  const { committedMinor, reservedMinor } = sumPeriodUsage(ctx, options);
  const compared = { period, baseAmountMinor, monthlyBudgetMinor, committedMinor, reservedMinor };

  if (baseAmountMinor === null) {
    return {
      ruleId: "R6",
      outcome: "ESCALATE",
      message: MESSAGES.budget.missingBaseAmount(baseCurrency),
      compared,
    };
  }

  const money = (amountMinor: number) => formatMoney(amountMinor, baseCurrency);
  const periodName = formatPeriod(period);
  const committedTotalMinor = addMinor(committedMinor, baseAmountMinor);
  if (committedTotalMinor > monthlyBudgetMinor) {
    return {
      ruleId: "R6",
      outcome: "BLOCK",
      message: MESSAGES.budget.overBudget(
        periodName,
        money(committedMinor),
        money(monthlyBudgetMinor),
        money(baseAmountMinor),
      ),
      compared,
    };
  }

  const totalMinor = addMinor(committedTotalMinor, reservedMinor);
  if (totalMinor > monthlyBudgetMinor) {
    return {
      ruleId: "R6",
      outcome: "ESCALATE",
      message: MESSAGES.budget.overWithReserved(
        periodName,
        money(committedMinor),
        money(reservedMinor),
        money(baseAmountMinor),
        money(totalMinor),
        money(monthlyBudgetMinor),
      ),
      compared,
    };
  }

  return {
    ruleId: "R6",
    outcome: "PASS",
    message: MESSAGES.budget.withinBudget(
      periodName,
      money(committedMinor),
      reservedMinor > 0 ? money(reservedMinor) : null,
      money(baseAmountMinor),
      money(totalMinor),
      money(monthlyBudgetMinor),
    ),
    compared,
  };
}

// PAYABLE entries count only in their own period, even one with this invoice's id (counting it is the
// stricter choice). Pending entries reserve whatever their period: an approved escalation is committed
// in the period of the approval, the current one or later. The invoice's own pending entry never
// reserves, because at approval its escalation is already in history. A pending entry without a base
// amount reserves nothing, because it can never be paid (approval revalidation BLOCKs it).
function sumPeriodUsage(ctx: RuleContext, options: BudgetCheckOptions) {
  let committedMinor = 0;
  let reservedMinor = 0;
  for (const entry of ctx.history) {
    if (!isCountedInBudget(entry.status) || entry.baseAmountMinor === null) continue;
    if (entry.status === "PAYABLE") {
      if (entry.period === ctx.period) {
        committedMinor = addMinor(committedMinor, entry.baseAmountMinor);
      }
    } else if (options.isReservingPending && entry.invoiceId !== ctx.invoice.id) {
      reservedMinor = addMinor(reservedMinor, entry.baseAmountMinor);
    }
  }
  return { committedMinor, reservedMinor };
}

// Sums stay exact: a total beyond safe integers throws, and the runner escalates the rule.
function addMinor(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new Error("Budget sum exceeds safe integer range");
  return sum;
}
