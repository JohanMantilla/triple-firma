import type { Approval } from "@/contracts/approval";
import {
  type Decision,
  type DecisionOutcome,
  RULE_IDS,
  type RuleId,
  type RuleOutcome,
  type RuleResult,
} from "@/contracts/decision";
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
    taxMinor: null,
    lineItemAmountsMinor: null,
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

const OUTCOME_RULES: Record<DecisionOutcome, Partial<Record<RuleId, RuleOutcome>>> = {
  PAY: {},
  ESCALATE: { R5: "ESCALATE" },
  BLOCK: { R2: "BLOCK" },
};

// A decision that satisfies DecisionSchema for the given outcome (USD 2,500.00), for tests that store
// or compare decisions without running the engine.
export function buildDecision(
  invoiceId: string,
  outcome: DecisionOutcome = "PAY",
  overrides: Partial<Decision> = {},
): Decision {
  const ruleResults = buildRuleResults(OUTCOME_RULES[outcome]);
  const failed = ruleResults.filter((result) => result.outcome !== "PASS");
  return {
    id: `decision-${invoiceId}`,
    invoiceId,
    outcome,
    ruleResults,
    amountMinor: 250_000,
    currency: "USD",
    baseAmountMinor: 250_000,
    exchangeRate: "1",
    explanation:
      failed.length === 0
        ? "Pagada: todas las reglas pasaron."
        : failed.map((result) => result.message).join(" "),
    configVersion: 1,
    decidedAt: "2026-10-17T14:00:00Z",
    ...overrides,
  };
}

export type ApprovalKind = "APPROVED" | "APPROVED_BUT_BLOCKED" | "REJECTED";

// A resolution of the given decision that satisfies ApprovalSchema, carrying the decision's money.
export function buildApproval(
  decision: Decision,
  kind: ApprovalKind,
  resolvedAt = "2026-10-17T15:00:00Z",
): Approval {
  const resolution = {
    decisionId: decision.id,
    approver: "Ana Pérez",
    comment: "Revisado con el acuerdo.",
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    resolvedAt,
  };
  if (kind === "REJECTED") {
    return { ...resolution, action: "REJECT", resultingOutcome: "BLOCK", revalidationResults: [] };
  }
  const budgetOutcome = kind === "APPROVED" ? "PASS" : "BLOCK";
  return {
    ...resolution,
    action: "APPROVE",
    resultingOutcome: kind === "APPROVED" ? "PAY" : "BLOCK",
    revalidationResults: [
      { ruleId: "R2", outcome: "PASS", message: "R2 result", compared: {} },
      { ruleId: "R6", outcome: budgetOutcome, message: "R6 result", compared: {} },
    ],
  };
}
