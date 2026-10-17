import {
  combineRuleOutcomes,
  type Decision,
  DecisionSchema,
  RULE_IDS,
  type RuleId,
  type RuleResult,
  RuleResultSchema,
} from "@/contracts/decision";
import { explainDecision } from "./explain-decision";
import { MESSAGES } from "./messages";
import { buildRuleContext, type RuleContext, type RuleContextInput } from "./rule-context";

export type RuleEvaluator = (ctx: RuleContext) => RuleResult;

// One evaluator per rule. A record keyed by RuleId makes TypeScript refuse a missing rule.
// Each placeholder is replaced by its real rule in its own PR; until then it escalates (fail-safe).
const RULES: Record<RuleId, RuleEvaluator> = {
  R1: notImplemented("R1"),
  R2: notImplemented("R2"),
  R3: notImplemented("R3"),
  R4: notImplemented("R4"),
  R5: notImplemented("R5"),
  R6: notImplemented("R6"),
  R7: notImplemented("R7"),
  R8: notImplemented("R8"),
  R9: notImplemented("R9"),
  R10: notImplemented("R10"),
};

export type EvaluateRulesInput = RuleContextInput & { configVersion: number };

export function evaluateRules(input: EvaluateRulesInput): Decision {
  return evaluateRulesWith(input, RULES);
}

// Same as evaluateRules with explicit evaluators, so the runner can be tested with stub rules.
export function evaluateRulesWith(
  input: EvaluateRulesInput,
  rules: Record<RuleId, RuleEvaluator>,
): Decision {
  const ctx = buildRuleContext(input);
  const ruleResults = RULE_IDS.map((ruleId) => runRule(ruleId, rules[ruleId], ctx));
  const outcome = combineRuleOutcomes(ruleResults.map((result) => result.outcome));

  // Parsing again is a second barrier: an inconsistent decision throws instead of being stored.
  return DecisionSchema.parse({
    id: `decision-${input.invoice.id}`,
    invoiceId: input.invoice.id,
    outcome,
    ruleResults,
    amountMinor: ctx.amountMinor,
    currency: ctx.currency,
    exchangeRate: ctx.exchangeRate,
    baseAmountMinor: ctx.baseAmountMinor,
    explanation: explainDecision(outcome, ruleResults),
    configVersion: input.configVersion,
    decidedAt: ctx.now,
  });
}

// A rule that throws, returns an invalid result or answers for another rule escalates, with the
// failure recorded in its message: it can never make the invoice pass.
function runRule(ruleId: RuleId, evaluate: RuleEvaluator, ctx: RuleContext): RuleResult {
  try {
    const parsed = RuleResultSchema.safeParse(evaluate(ctx));
    if (parsed.success && parsed.data.ruleId === ruleId) return parsed.data;
    return failedRule(ruleId, "invalid rule result");
  } catch (error) {
    return failedRule(ruleId, error instanceof Error ? error.message : String(error));
  }
}

function failedRule(ruleId: RuleId, reason: string): RuleResult {
  return {
    ruleId,
    outcome: "ESCALATE",
    message: MESSAGES.ruleFailed(ruleId),
    compared: { error: reason },
  };
}

function notImplemented(ruleId: RuleId): RuleEvaluator {
  return () => ({
    ruleId,
    outcome: "ESCALATE",
    message: MESSAGES.ruleNotImplemented(ruleId),
    compared: {},
  });
}
