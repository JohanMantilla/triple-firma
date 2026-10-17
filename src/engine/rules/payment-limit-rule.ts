import type { RuleResult } from "@/contracts/decision";
import { formatMoney } from "../format-money";
import { MESSAGES } from "../messages";
import type { RuleContext } from "../rule-context";

// R5: the amount in the base currency is compared with the per-payment limits. Above the hard cap
// (when it is on) the payment is blocked; strictly above the approval threshold a person must approve.
// Without a base amount there is nothing to compare, so the rule escalates instead of passing.
export function evaluatePaymentLimitRule(ctx: RuleContext): RuleResult {
  const { baseAmountMinor, config } = ctx;
  const { approvalThresholdMinor, hardCapMinor, baseCurrency } = config;
  const compared = { baseAmountMinor, approvalThresholdMinor, hardCapMinor };

  if (baseAmountMinor === null) {
    return {
      ruleId: "R5",
      outcome: "ESCALATE",
      message: MESSAGES.paymentLimit.missingBaseAmount,
      compared,
    };
  }

  const amount = formatMoney(baseAmountMinor, baseCurrency);
  if (hardCapMinor !== null && baseAmountMinor > hardCapMinor) {
    return {
      ruleId: "R5",
      outcome: "BLOCK",
      message: MESSAGES.paymentLimit.overHardCap(amount, formatMoney(hardCapMinor, baseCurrency)),
      compared,
    };
  }

  const threshold = formatMoney(approvalThresholdMinor, baseCurrency);
  if (baseAmountMinor > approvalThresholdMinor) {
    return {
      ruleId: "R5",
      outcome: "ESCALATE",
      message: MESSAGES.paymentLimit.overThreshold(amount, threshold),
      compared,
    };
  }

  return {
    ruleId: "R5",
    outcome: "PASS",
    message: MESSAGES.paymentLimit.withinThreshold(amount, threshold),
    compared,
  };
}
