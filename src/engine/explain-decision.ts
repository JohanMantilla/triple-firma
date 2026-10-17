import type { DecisionOutcome, RuleResult } from "@/contracts/decision";
import { MESSAGES } from "./messages";

// The explanation is derived from the rule results, never written freely: it repeats the message of
// every rule that did not pass, so the log says exactly why the invoice was blocked or escalated.
export function explainDecision(
  outcome: DecisionOutcome,
  ruleResults: readonly RuleResult[],
): string {
  if (outcome === "PAY") return MESSAGES.allRulesPassed;

  const prefix = outcome === "BLOCK" ? MESSAGES.blockedPrefix : MESSAGES.escalatedPrefix;
  const reasons = ruleResults
    .filter((result) => result.outcome !== "PASS")
    .map((result) => result.message);
  return [prefix, ...reasons].join(" ");
}
