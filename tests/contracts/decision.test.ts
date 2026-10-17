import { describe, expect, it } from "vitest";
import { combineRuleOutcomes, type Decision, DecisionSchema } from "@/contracts/decision";
import { buildRuleResults } from "./fixtures";

function buildDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "dec-1",
    invoiceId: "inv-1",
    outcome: "PAY",
    ruleResults: buildRuleResults(),
    amountMinor: 150_000,
    currency: "USD",
    baseAmountMinor: 150_000,
    exchangeRate: "1",
    explanation: "Pagada: todas las reglas pasaron.",
    configVersion: 1,
    decidedAt: "2026-10-17T14:00:00Z",
    ...overrides,
  };
}

describe("combineRuleOutcomes", () => {
  it("pays only when every rule passed", () => {
    expect(combineRuleOutcomes(["PASS", "PASS"])).toBe("PAY");
  });

  it("escalates when any rule escalates", () => {
    expect(combineRuleOutcomes(["PASS", "ESCALATE", "PASS"])).toBe("ESCALATE");
  });

  it("blocks when any rule blocks, even if others escalate", () => {
    expect(combineRuleOutcomes(["ESCALATE", "BLOCK", "PASS"])).toBe("BLOCK");
  });

  it("escalates when no rule was evaluated", () => {
    expect(combineRuleOutcomes([])).toBe("ESCALATE");
  });
});

describe("DecisionSchema", () => {
  it("accepts a PAY decision where every rule passed", () => {
    expect(DecisionSchema.safeParse(buildDecision()).success).toBe(true);
  });

  it("accepts a BLOCK decision with a blocking rule", () => {
    const decision = buildDecision({
      outcome: "BLOCK",
      ruleResults: buildRuleResults({ R2: "BLOCK", R5: "ESCALATE" }),
    });
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
  });

  it("rejects PAY when a rule escalated", () => {
    const decision = buildDecision({ ruleResults: buildRuleResults({ R5: "ESCALATE" }) });
    expect(DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("rejects ESCALATE when a rule blocked", () => {
    const decision = buildDecision({
      outcome: "ESCALATE",
      ruleResults: buildRuleResults({ R6: "BLOCK" }),
    });
    expect(DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("rejects a decision that skipped a rule", () => {
    const decision = buildDecision({ ruleResults: buildRuleResults().slice(0, 9) });
    expect(DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("rejects a decision that evaluated a rule twice", () => {
    const results = buildRuleResults();
    const decision = buildDecision({ ruleResults: [...results.slice(0, 9), results[0]] });
    expect(DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it.each(["amountMinor", "currency", "baseAmountMinor", "exchangeRate"] as const)(
    "rejects PAY without %s",
    (field) => {
      expect(DecisionSchema.safeParse(buildDecision({ [field]: null })).success).toBe(false);
    },
  );

  it("rejects PAY in a currency outside the supported list", () => {
    expect(DecisionSchema.safeParse(buildDecision({ currency: "EUR" })).success).toBe(false);
  });

  it("rejects an ESCALATE decision that could be converted but has no base amount", () => {
    const decision = buildDecision({
      outcome: "ESCALATE",
      ruleResults: buildRuleResults({ R5: "ESCALATE" }),
      baseAmountMinor: null,
    });
    expect(DecisionSchema.safeParse(decision).success).toBe(false);
  });

  it("accepts ESCALATE without base amount when the currency is unknown", () => {
    const decision = buildDecision({
      outcome: "ESCALATE",
      ruleResults: buildRuleResults({ R8: "ESCALATE" }),
      currency: "EUR",
      baseAmountMinor: null,
      exchangeRate: null,
    });
    expect(DecisionSchema.safeParse(decision).success).toBe(true);
  });
});
