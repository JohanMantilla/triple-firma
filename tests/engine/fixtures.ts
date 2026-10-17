import { RULE_IDS, type RuleId, type RuleOutcome } from "@/contracts/decision";
import type { Invoice } from "@/contracts/invoice";
import type { RuleEvaluator } from "@/engine/evaluate-rules";
import { buildExtraction, buildRulesConfig, VALID_HASH } from "../contracts/fixtures";

export { buildRulesConfig };

export const NOW = "2026-10-17T14:00:00Z";

export function buildInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    fileHash: VALID_HASH,
    sourceFormat: "PDF",
    sourceText: null,
    receivedAt: NOW,
    extraction: buildExtraction(),
    ...overrides,
  };
}

// Stub evaluators: every rule returns the given outcome (PASS by default).
export function stubRules(
  outcomes: Partial<Record<RuleId, RuleOutcome>> = {},
): Record<RuleId, RuleEvaluator> {
  const rules = {} as Record<RuleId, RuleEvaluator>;
  for (const ruleId of RULE_IDS) {
    rules[ruleId] = () => ({
      ruleId,
      outcome: outcomes[ruleId] ?? "PASS",
      message: `${ruleId}: resultado de prueba.`,
      compared: {},
    });
  }
  return rules;
}
