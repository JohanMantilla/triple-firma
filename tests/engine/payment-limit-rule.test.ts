import { describe, expect, it } from "vitest";
import type { RulesConfig } from "@/contracts/rules-config";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluatePaymentLimitRule } from "@/engine/rules/payment-limit-rule";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

// The fixture config: approval threshold USD 2,000.00, hard cap USD 10,000.00.
function evaluate(amountMinor: number | null, config: Partial<RulesConfig> = {}, currency = "USD") {
  const invoice = buildInvoice();
  invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: amountMinor };
  invoice.extraction.currency = { ...invoice.extraction.currency, value: currency };
  return evaluatePaymentLimitRule(
    buildRuleContext({ invoice, config: buildRulesConfig(config), history: [], now: NOW }),
  );
}

describe("evaluatePaymentLimitRule (R5)", () => {
  it.each([
    ["one cent below the threshold", 199_999],
    ["exactly the threshold", 200_000],
  ])("passes %s", (_case, amountMinor) => {
    expect(evaluate(amountMinor).outcome).toBe("PASS");
  });

  it("explains a passing amount with both values", () => {
    expect(evaluate(200_000).message).toBe(
      "R5: USD 2.000,00 no supera el umbral de aprobación de USD 2.000,00.",
    );
  });

  it("escalates one cent above the threshold", () => {
    expect(evaluate(200_001)).toMatchObject({
      outcome: "ESCALATE",
      message: "R5: USD 2.000,01 supera el umbral de aprobación de USD 2.000,00.",
      compared: { baseAmountMinor: 200_001, approvalThresholdMinor: 200_000 },
    });
  });

  it.each([
    ["exactly the hard cap", 1_000_000],
    ["one cent below the hard cap", 999_999],
  ])("escalates %s, which only needs approval", (_case, amountMinor) => {
    expect(evaluate(amountMinor).outcome).toBe("ESCALATE");
  });

  it("blocks one cent above the hard cap, even though it is also above the threshold", () => {
    expect(evaluate(1_000_001)).toMatchObject({
      outcome: "BLOCK",
      message: "R5: USD 10.000,01 supera el tope absoluto de USD 10.000,00; no se puede aprobar.",
      compared: { hardCapMinor: 1_000_000 },
    });
  });

  it("passes exactly the threshold when the hard cap is off", () => {
    expect(evaluate(200_000, { hardCapMinor: null }).outcome).toBe("PASS");
  });

  it("passes an amount that converts to zero, which is negligible by decision 3", () => {
    expect(evaluate(1, {}, "COP")).toMatchObject({
      outcome: "PASS",
      compared: { baseAmountMinor: 0 },
      message: "R5: USD 0,00 no supera el umbral de aprobación de USD 2.000,00.",
    });
  });

  it("names the configured base currency in its messages", () => {
    const config = {
      baseCurrency: "COP" as const,
      exchangeRates: { COP: "1" },
      agreements: [],
      approvalThresholdMinor: 800_000_000,
      hardCapMinor: null,
    };
    expect(evaluate(800_000_001, config, "COP").message).toBe(
      "R5: COP 8.000.000,01 supera el umbral de aprobación de COP 8.000.000,00.",
    );
    expect(evaluate(null, config, "COP").message).toBe(
      "R5: no se pudo calcular el monto en COP para compararlo con los límites; se escala por seguridad.",
    );
  });

  it("only escalates a huge amount when the hard cap is off", () => {
    expect(evaluate(50_000_000, { hardCapMinor: null }).outcome).toBe("ESCALATE");
  });

  it("compares the converted amount: COP 8,000,000.00 is exactly the USD 2,000.00 threshold", () => {
    expect(evaluate(800_000_000, {}, "COP").outcome).toBe("PASS");
    expect(evaluate(800_002_000, {}, "COP").outcome).toBe("ESCALATE");
  });

  it("escalates when there is no base amount to compare", () => {
    expect(evaluate(null)).toMatchObject({
      outcome: "ESCALATE",
      compared: { baseAmountMinor: null },
    });
    expect(evaluate(100_000, {}, "EUR").outcome).toBe("ESCALATE");
  });
});
