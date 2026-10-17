import { describe, expect, it } from "vitest";
import { RULE_IDS } from "@/contracts/decision";
import { evaluateRules, evaluateRulesWith, type RuleEvaluator } from "@/engine/evaluate-rules";
import { buildInvoice, buildRulesConfig, NOW, stubRules } from "./fixtures";

const input = {
  invoice: buildInvoice(),
  config: buildRulesConfig(),
  configVersion: 1,
  history: [],
  now: NOW,
};

describe("evaluateRules", () => {
  it("escalates while rules are still placeholders, so nothing is ever paid by default", () => {
    const decision = evaluateRules(input);
    expect(decision.outcome).toBe("ESCALATE");
    expect(decision.ruleResults.every((result) => result.outcome === "ESCALATE")).toBe(true);
  });
});

describe("evaluateRulesWith", () => {
  it("pays only when every rule passes", () => {
    const decision = evaluateRulesWith(input, stubRules());
    expect(decision.outcome).toBe("PAY");
    expect(decision.explanation).toBe("Pagada: todas las reglas pasaron.");
  });

  it("evaluates all ten rules, in order, even when one escalates", () => {
    const decision = evaluateRulesWith(input, stubRules({ R1: "ESCALATE" }));
    expect(decision.ruleResults.map((result) => result.ruleId)).toEqual([...RULE_IDS]);
  });

  it("escalates when any rule escalates", () => {
    expect(evaluateRulesWith(input, stubRules({ R5: "ESCALATE" })).outcome).toBe("ESCALATE");
  });

  it("blocks when any rule blocks, even if others escalate", () => {
    const decision = evaluateRulesWith(input, stubRules({ R3: "ESCALATE", R6: "BLOCK" }));
    expect(decision.outcome).toBe("BLOCK");
    expect(decision.explanation).toBe("Frenada: R3: resultado de prueba. R6: resultado de prueba.");
  });

  it("escalates a rule that throws and records why", () => {
    const rules = stubRules();
    rules.R4 = () => {
      throw new Error("boom");
    };
    const decision = evaluateRulesWith(input, rules);
    const r4 = decision.ruleResults.find((result) => result.ruleId === "R4");
    expect(decision.outcome).toBe("ESCALATE");
    expect(r4?.outcome).toBe("ESCALATE");
    expect(r4?.compared).toEqual({ error: "boom" });
  });

  it("escalates a rule that answers for another rule id", () => {
    const rules = stubRules();
    rules.R2 = stubRules().R7;
    const decision = evaluateRulesWith(input, rules);
    expect(decision.outcome).toBe("ESCALATE");
    expect(decision.ruleResults.find((result) => result.ruleId === "R2")?.outcome).toBe("ESCALATE");
  });

  it("escalates a rule that returns an invalid result", () => {
    const rules = stubRules();
    rules.R9 = (() => ({ ruleId: "R9", outcome: "MAYBE" })) as unknown as RuleEvaluator;
    expect(evaluateRulesWith(input, rules).outcome).toBe("ESCALATE");
  });

  it("records the invoice money converted once to the base currency", () => {
    const decision = evaluateRulesWith(input, stubRules());
    expect(decision).toMatchObject({
      amountMinor: 250_000,
      currency: "USD",
      exchangeRate: "1",
      baseAmountMinor: 250_000,
    });
  });

  it("is deterministic: the same input gives the same decision", () => {
    expect(evaluateRulesWith(input, stubRules())).toEqual(evaluateRulesWith(input, stubRules()));
  });

  it("uses the injected time as the decision time", () => {
    expect(evaluateRulesWith(input, stubRules()).decidedAt).toBe(NOW);
  });

  it("rejects a now that is not a UTC timestamp", () => {
    expect(() =>
      evaluateRulesWith({ ...input, now: "2026-10-17T10:00:00-04:00" }, stubRules()),
    ).toThrow();
  });
});
