import { RULE_IDS, type RuleResult } from "@/contracts/decision";
import type { Extraction } from "@/contracts/extraction";
import type { RulesConfig } from "@/contracts/rules-config";

export const VALID_HASH = "a".repeat(64);

export function buildRulesConfig(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return {
    baseCurrency: "USD",
    timezone: "America/New_York",
    exchangeRates: { USD: "1", COP: "4000", MXN: "18.50", ARS: "1000" },
    approvalThresholdMinor: 200_000,
    hardCapMinor: 1_000_000,
    monthlyBudgetMinor: 2_000_000,
    allowedPayees: ["Café Andino SAS", "Dev Partners SAS"],
    blockedPayees: ["Old Vendor LLC"],
    agreements: [
      {
        payee: "Dev Partners SAS",
        amountMinor: 250_000,
        currency: "USD",
        validFrom: "2026-01-01",
        validUntil: null,
      },
    ],
    toleranceMinor: 0,
    splitPaymentWindowDays: 7,
    dueDatePolicy: { maxDaysOverdue: 30, maxDaysAhead: 90 },
    ...overrides,
  };
}

export function buildExtraction(): Extraction {
  return {
    payee: {
      raw: "Dev Partners SAS",
      value: "Dev Partners SAS",
      evidence: "From: Dev Partners SAS",
      isUncertain: false,
    },
    amountMinor: {
      raw: "USD 2,500.00",
      value: 250_000,
      evidence: "Total: USD 2,500.00",
      isUncertain: false,
    },
    currency: { raw: "USD", value: "USD", evidence: "Total: USD 2,500.00", isUncertain: false },
    issueDate: {
      raw: "Oct 1, 2026",
      value: "2026-10-01",
      evidence: "Date: Oct 1, 2026",
      isUncertain: false,
    },
    dueDate: {
      raw: "Oct 30, 2026",
      value: "2026-10-30",
      evidence: "Due: Oct 30, 2026",
      isUncertain: false,
    },
    reference: {
      raw: "INV-102",
      value: "INV-102",
      evidence: "Invoice INV-102",
      isUncertain: false,
    },
    lineItemsSumMinor: 250_000,
    suspiciousText: [],
  };
}

export function buildRuleResults(
  outcomes: Partial<Record<(typeof RULE_IDS)[number], RuleResult["outcome"]>> = {},
) {
  return RULE_IDS.map((ruleId): RuleResult => ({
    ruleId,
    outcome: outcomes[ruleId] ?? "PASS",
    message: `${ruleId} result`,
    compared: {},
  }));
}
