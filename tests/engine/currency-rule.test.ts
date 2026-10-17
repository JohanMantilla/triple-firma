import { describe, expect, it } from "vitest";
import type { RulesConfig } from "@/contracts/rules-config";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluateCurrencyRule } from "@/engine/rules/currency-rule";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

type Money = {
  amountMinor?: number | null;
  currency?: string | null;
  isAmountUncertain?: boolean;
  isCurrencyUncertain?: boolean;
};

function evaluate(money: Money, config: Partial<RulesConfig> = {}) {
  const invoice = buildInvoice();
  const { amountMinor, currency } = invoice.extraction;
  invoice.extraction.amountMinor = {
    ...amountMinor,
    value: money.amountMinor === undefined ? amountMinor.value : money.amountMinor,
    isUncertain: money.isAmountUncertain ?? false,
  };
  invoice.extraction.currency = {
    ...currency,
    value: money.currency === undefined ? currency.value : money.currency,
    isUncertain: money.isCurrencyUncertain ?? false,
  };
  return evaluateCurrencyRule(
    buildRuleContext({ invoice, config: buildRulesConfig(config), history: [], now: NOW }),
  );
}

describe("evaluateCurrencyRule (R8)", () => {
  it("passes a configured currency and explains the conversion", () => {
    expect(evaluate({ amountMinor: 800_000_000, currency: "COP" })).toMatchObject({
      outcome: "PASS",
      message: "R8: COP convertido con la tasa fija 4000 por USD: USD 2.000,00.",
      compared: { currency: "COP", exchangeRate: "4000", baseAmountMinor: 200_000 },
    });
  });

  it("passes the base currency at rate 1", () => {
    expect(evaluate({ amountMinor: 250_000, currency: "USD" }).outcome).toBe("PASS");
  });

  it.each([
    ["unreadable", { currency: null }],
    ["uncertain", { currency: "USD", isCurrencyUncertain: true }],
  ])("escalates an %s currency", (_case, money) => {
    expect(evaluate(money)).toMatchObject({
      outcome: "ESCALATE",
      message: "R8: no se pudo determinar la moneda con certeza; se escala por seguridad.",
    });
  });

  it.each(["EUR", "JPY", "CLP"])("escalates the unsupported currency %s", (currency) => {
    expect(evaluate({ currency })).toMatchObject({
      outcome: "ESCALATE",
      message: `R8: la moneda ${currency} no está soportada (solo USD, COP, MXN y ARS).`,
    });
  });

  it("escalates a supported currency without a configured rate", () => {
    const result = evaluate({ currency: "MXN" }, { exchangeRates: { USD: "1", COP: "4000" } });
    expect(result).toMatchObject({
      outcome: "ESCALATE",
      message: "R8: la moneda MXN no tiene una tasa de cambio configurada.",
      compared: { exchangeRate: null },
    });
  });

  it("escalates when the conversion overflows", () => {
    const result = evaluate(
      { amountMinor: Number.MAX_SAFE_INTEGER, currency: "ARS" },
      { exchangeRates: { USD: "1", ARS: "0.5" } },
    );
    expect(result).toMatchObject({
      outcome: "ESCALATE",
      message: "R8: no se pudo convertir el monto en ARS; se escala por seguridad.",
    });
  });

  it("passes the currency when only the amount is unreadable, which R1 and R5 escalate", () => {
    expect(evaluate({ currency: "COP", amountMinor: null })).toMatchObject({
      outcome: "PASS",
      message: "R8: la moneda COP está soportada, con tasa fija 4000 por USD.",
    });
    expect(evaluate({ currency: "COP", isAmountUncertain: true }).outcome).toBe("PASS");
  });
});
