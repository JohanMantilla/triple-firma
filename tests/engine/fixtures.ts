import { RULE_IDS, type RuleId, type RuleOutcome } from "@/contracts/decision";
import type { HistoryEntry } from "@/contracts/history";
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

export function buildHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    invoiceId: "inv-0",
    fileHash: "b".repeat(64),
    payee: "Dev Partners SAS",
    reference: "INV-101",
    amountMinor: 150_000,
    currency: "USD",
    exchangeRate: "1",
    baseAmountMinor: 150_000,
    status: "PAYABLE",
    period: "2026-10",
    decidedAt: "2026-10-03T14:00:00Z",
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
