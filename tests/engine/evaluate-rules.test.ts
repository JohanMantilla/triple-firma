import { describe, expect, it } from "vitest";
import { RULE_IDS } from "@/contracts/decision";
import { evaluateRules, evaluateRulesWith, type RuleEvaluator } from "@/engine/evaluate-rules";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW, stubRules } from "./fixtures";

const input = {
  invoice: buildInvoice(),
  config: buildRulesConfig(),
  configVersion: 1,
  history: [],
  now: NOW,
};

describe("evaluateRules", () => {
  it("escalates while some rules are still placeholders, so nothing is ever paid by default", () => {
    const decision = evaluateRules(input);
    const placeholders = decision.ruleResults.filter((result) =>
      result.message.includes("aún no está implementada"),
    );
    expect(decision.outcome).toBe("ESCALATE");
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.every((result) => result.outcome === "ESCALATE")).toBe(true);
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

  const throwingMessage = new Error("hidden");
  Object.defineProperty(throwingMessage, "message", {
    get() {
      throw new Error("getter");
    },
  });

  it.each([
    ["a string", "plain string", "plain string"],
    ["an object without prototype", Object.create(null), "unreadable error"],
    [
      "an object whose toString throws",
      {
        toString() {
          throw new Error("nope");
        },
      },
      "unreadable error",
    ],
    ["an Error whose message getter throws", throwingMessage, "unreadable error"],
    ["an Error with a very long message", new Error("x".repeat(2_000)), "x".repeat(500)],
  ])("escalates a rule that throws %s, without the runner throwing", (_case, thrown, reason) => {
    const rules = stubRules();
    rules.R4 = () => {
      throw thrown;
    };
    const decision = evaluateRulesWith(input, rules);
    const r4 = decision.ruleResults.find((result) => result.ruleId === "R4");
    expect(decision.outcome).toBe("ESCALATE");
    expect(r4?.compared).toEqual({ error: reason });
  });

  it.each([
    [
      "a Promise",
      () => Promise.resolve({ ruleId: "R4", outcome: "PASS", message: "ok", compared: {} }),
    ],
    ["null", () => null],
    ["undefined", () => undefined],
  ])("escalates a rule that returns %s", (_case, evaluator) => {
    const rules = stubRules();
    rules.R4 = evaluator as unknown as RuleEvaluator;
    expect(evaluateRulesWith(input, rules).outcome).toBe("ESCALATE");
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

  it("records a valid decision without base amount when the amount is uncertain", () => {
    const invoice = buildInvoice();
    invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, isUncertain: true };
    const decision = evaluateRulesWith({ ...input, invoice }, stubRules({ R1: "ESCALATE" }));
    expect(decision).toMatchObject({
      outcome: "ESCALATE",
      amountMinor: 250_000,
      exchangeRate: null,
      baseAmountMinor: null,
    });
  });

  it("is deterministic: the same input gives the same decision", () => {
    expect(evaluateRulesWith(input, stubRules())).toEqual(evaluateRulesWith(input, stubRules()));
  });

  it("uses the injected time as the decision time", () => {
    expect(evaluateRulesWith(input, stubRules()).decidedAt).toBe(NOW);
  });

  it("throws on a config with a missing limit instead of letting a rule compare against undefined", () => {
    const { approvalThresholdMinor: _omitted, ...incomplete } = buildRulesConfig();
    expect(() =>
      evaluateRulesWith({ ...input, config: incomplete as never }, stubRules()),
    ).toThrow();
  });

  it("throws on a history entry with a string amount", () => {
    const entry = { ...buildHistoryEntry(), baseAmountMinor: "50000" };
    expect(() => evaluateRulesWith({ ...input, history: [entry as never] }, stubRules())).toThrow();
  });

  it("throws on an invoice that breaks its contract", () => {
    const invoice = { ...buildInvoice(), sourceFormat: "EMAIL" as const, sourceText: null };
    expect(() => evaluateRulesWith({ ...input, invoice }, stubRules())).toThrow();
  });

  it("escalates a rule that tries to change the shared context, and later rules see the original", () => {
    const rules = stubRules();
    rules.R3 = (ctx) => {
      (ctx as { baseAmountMinor: number | null }).baseAmountMinor = 0;
      return stubRules().R3(ctx);
    };
    rules.R5 = (ctx) => ({
      ruleId: "R5",
      outcome: ctx.baseAmountMinor === 250_000 ? "PASS" : "BLOCK",
      message: "R5: lee el monto original.",
      compared: { baseAmountMinor: ctx.baseAmountMinor },
    });
    const decision = evaluateRulesWith(input, rules);
    expect(decision.ruleResults.find((result) => result.ruleId === "R3")?.outcome).toBe("ESCALATE");
    expect(decision.ruleResults.find((result) => result.ruleId === "R5")?.outcome).toBe("PASS");
    expect(decision.baseAmountMinor).toBe(250_000);
  });

  it("escalates a rule that tries to change nested data such as the config", () => {
    const rules = stubRules();
    rules.R6 = (ctx) => {
      (ctx.config as { monthlyBudgetMinor: number }).monthlyBudgetMinor = 1;
      return stubRules().R6(ctx);
    };
    expect(evaluateRulesWith(input, rules).outcome).toBe("ESCALATE");
  });

  it("does not freeze the caller's objects", () => {
    const callerInput = { ...input, invoice: buildInvoice(), config: buildRulesConfig() };
    evaluateRulesWith(callerInput, stubRules());
    expect(Object.isFrozen(callerInput.invoice)).toBe(false);
    expect(Object.isFrozen(callerInput.config)).toBe(false);
  });

  it("rejects a now that is not a UTC timestamp", () => {
    expect(() =>
      evaluateRulesWith({ ...input, now: "2026-10-17T10:00:00-04:00" }, stubRules()),
    ).toThrow();
  });
});
