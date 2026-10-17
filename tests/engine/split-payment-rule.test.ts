import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/contracts/history";
import type { RulesConfig } from "@/contracts/rules-config";
import { evaluateRulesWith } from "@/engine/evaluate-rules";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluateSplitPaymentRule } from "@/engine/rules/split-payment-rule";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW, stubRules } from "./fixtures";

// NOW is 2026-10-17 10:00 in America/New_York. The fixture config: approval threshold USD 2,000.00 and
// a 7-day window, so payments decided from 2026-10-11 to 2026-10-17 (New York dates) are summed.
const SIX_DAYS_AGO = "2026-10-11T14:00:00Z";
const SEVEN_DAYS_AGO = "2026-10-10T14:00:00Z";

type Scenario = {
  amountMinor?: number;
  payee?: string | null;
  isPayeeUncertain?: boolean;
  currency?: string;
  history?: HistoryEntry[];
  config?: Partial<RulesConfig>;
};

function buildContext(scenario: Scenario = {}) {
  const invoice = buildInvoice();
  const { extraction } = invoice;
  extraction.amountMinor = { ...extraction.amountMinor, value: scenario.amountMinor ?? 100_000 };
  extraction.currency = { ...extraction.currency, value: scenario.currency ?? "USD" };
  extraction.payee = {
    ...extraction.payee,
    value: scenario.payee === undefined ? "Dev Partners SAS" : scenario.payee,
    isUncertain: scenario.isPayeeUncertain ?? false,
  };
  return buildRuleContext({
    invoice,
    config: buildRulesConfig(scenario.config),
    history: scenario.history ?? [],
    now: NOW,
  });
}

function evaluate(scenario: Scenario = {}) {
  return evaluateSplitPaymentRule(buildContext(scenario));
}

// A payment of the given USD amount to Dev Partners SAS, decided six days ago (inside the window).
function earlier(baseAmountMinor: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return buildHistoryEntry({
    amountMinor: baseAmountMinor,
    baseAmountMinor,
    decidedAt: SIX_DAYS_AGO,
    ...overrides,
  });
}

describe("evaluateSplitPaymentRule (R7)", () => {
  describe("without earlier payments to the payee", () => {
    it("passes and says there are no other payments", () => {
      expect(evaluate()).toEqual({
        ruleId: "R7",
        outcome: "PASS",
        message: "R7: no hay otros pagos a “Dev Partners SAS” en los últimos 7 días.",
        compared: {
          today: "2026-10-17",
          windowDays: 7,
          approvalThresholdMinor: 200_000,
          baseAmountMinor: 100_000,
          earlierCount: 0,
          totalMinor: 100_000,
        },
      });
    });

    it("passes an invoice that alone exceeds the threshold, which R5 escalates instead", () => {
      expect(evaluate({ amountMinor: 250_000 })).toMatchObject({
        outcome: "PASS",
        compared: { earlierCount: 0, totalMinor: 250_000 },
      });
    });
  });

  describe("sum against the approval threshold", () => {
    it("passes when the sum equals the threshold exactly", () => {
      expect(evaluate({ history: [earlier(100_000)] })).toMatchObject({
        outcome: "PASS",
        message:
          "R7: “Dev Partners SAS” suma USD 2.000,00 en los últimos 7 días (2 facturas, incluida esta), dentro del umbral de aprobación de USD 2.000,00.",
        compared: { earlierCount: 1, totalMinor: 200_000 },
      });
    });

    it("passes one cent below the threshold", () => {
      expect(evaluate({ history: [earlier(99_999)] }).outcome).toBe("PASS");
    });

    it("escalates one cent above the threshold, although each invoice is below it", () => {
      expect(evaluate({ history: [earlier(100_001)] })).toMatchObject({
        outcome: "ESCALATE",
        message:
          "R7: “Dev Partners SAS” suma USD 2.000,01 en los últimos 7 días (2 facturas, incluida esta); supera el umbral de aprobación de USD 2.000,00; requiere revisión humana.",
        compared: { earlierCount: 1, totalMinor: 200_001 },
      });
    });

    it("sums a payment split in three parts", () => {
      const result = evaluate({
        amountMinor: 80_000,
        history: [earlier(90_000, { invoiceId: "inv-a" }), earlier(90_000, { invoiceId: "inv-b" })],
      });
      expect(result).toMatchObject({
        outcome: "ESCALATE",
        compared: { earlierCount: 2, totalMinor: 260_000 },
      });
      expect(result.message).toContain("(3 facturas, incluida esta)");
    });

    it("sums parts in different currencies by their recorded base amounts", () => {
      const inPesos = earlier(100_000, {
        amountMinor: 400_000_000,
        currency: "COP",
        exchangeRate: "4000",
      });
      expect(evaluate({ amountMinor: 100_001, history: [inPesos] }).outcome).toBe("ESCALATE");
    });

    it("uses the base amount of this invoice, converted once", () => {
      // COP 4,000,004.00 at 4000 per USD is USD 1,000.00 (rounded once), so the sum is exactly USD 2,000.00.
      expect(
        evaluate({ amountMinor: 400_000_400, currency: "COP", history: [earlier(100_000)] }),
      ).toMatchObject({
        outcome: "PASS",
        compared: { baseAmountMinor: 100_000, totalMinor: 200_000 },
      });
    });
  });

  describe("window", () => {
    it.each([
      ["today", "2026-10-17T13:00:00Z"],
      ["six days ago", SIX_DAYS_AGO],
      ["six days ago, at the first minute of the New York day", "2026-10-11T04:00:00Z"],
      ["in the future, which is the stricter choice", "2026-10-20T14:00:00Z"],
    ])("counts a payment decided %s", (_case, decidedAt) => {
      expect(evaluate({ history: [earlier(100_001, { decidedAt })] }).outcome).toBe("ESCALATE");
    });

    it.each([
      ["seven days ago", SEVEN_DAYS_AGO],
      ["seven days ago in New York, although six days ago in UTC", "2026-10-11T03:59:00Z"],
      ["last month", "2026-09-17T14:00:00Z"],
    ])("does not count a payment decided %s", (_case, decidedAt) => {
      expect(evaluate({ history: [earlier(100_001, { decidedAt })] })).toMatchObject({
        outcome: "PASS",
        compared: { earlierCount: 0 },
      });
    });

    it("follows the configured window length", () => {
      const history = [earlier(100_001, { decidedAt: SEVEN_DAYS_AGO })];
      expect(evaluate({ history, config: { splitPaymentWindowDays: 8 } }).outcome).toBe("ESCALATE");
    });

    it("says 'hoy' for a one-day window, which only counts today", () => {
      expect(evaluate({ config: { splitPaymentWindowDays: 1 } }).message).toBe(
        "R7: no hay otros pagos a “Dev Partners SAS” hoy.",
      );
      const yesterday = earlier(100_001, { decidedAt: "2026-10-16T14:00:00Z" });
      const config = { splitPaymentWindowDays: 1 };
      expect(evaluate({ history: [yesterday], config }).outcome).toBe("PASS");
      const today = earlier(100_001, { decidedAt: "2026-10-17T13:00:00Z" });
      expect(evaluate({ history: [today], config }).message).toContain("suma USD 2.000,01 hoy");
    });
  });

  describe("which earlier payments count", () => {
    it.each([["PAYABLE" as const], ["PENDING_APPROVAL" as const]])(
      "counts a %s payment",
      (status) => {
        expect(evaluate({ history: [earlier(100_001, { status })] }).outcome).toBe("ESCALATE");
      },
    );

    it.each([["REJECTED" as const], ["BLOCKED" as const]])(
      "does not count a %s invoice, which is never paid",
      (status) => {
        expect(evaluate({ history: [earlier(100_001, { status })] }).outcome).toBe("PASS");
      },
    );

    it("counts the same payee written with other case, spaces or legal-suffix periods", () => {
      const history = [earlier(100_001, { payee: "  DEV PARTNERS S.A.S. " })];
      expect(evaluate({ history }).outcome).toBe("ESCALATE");
    });

    it("does not count another payee, nor a look-alike name, which R3 escalates", () => {
      const history = [
        earlier(100_001, { invoiceId: "inv-a", payee: "Café Andino SAS" }),
        earlier(100_001, { invoiceId: "inv-b", payee: "Dev Partner SAS" }),
      ];
      expect(evaluate({ history })).toMatchObject({
        outcome: "PASS",
        compared: { earlierCount: 0 },
      });
    });

    it("does not count this same invoice decided again", () => {
      expect(evaluate({ history: [earlier(100_001, { invoiceId: "inv-1" })] }).outcome).toBe(
        "PASS",
      );
    });

    it("counts a copy of this file under another invoice id", () => {
      const copy = earlier(100_001, { invoiceId: "inv-copy", fileHash: "a".repeat(64) });
      expect(evaluate({ history: [copy] }).outcome).toBe("ESCALATE");
    });

    it("ignores a pending entry without base amount, which can never be paid", () => {
      const unreadable = earlier(100_001, {
        status: "PENDING_APPROVAL",
        amountMinor: null,
        currency: null,
        exchangeRate: null,
        baseAmountMinor: null,
      });
      expect(evaluate({ history: [unreadable] }).outcome).toBe("PASS");
    });

    it("ignores an entry whose payee could not be read", () => {
      expect(evaluate({ history: [earlier(100_001, { payee: null })] }).outcome).toBe("PASS");
    });
  });

  describe("fail-safe", () => {
    it.each([
      ["uncertain", { isPayeeUncertain: true }],
      ["missing", { payee: null }],
    ])("escalates when the payee is %s", (_case, scenario) => {
      expect(evaluate(scenario)).toMatchObject({
        outcome: "ESCALATE",
        message:
          "R7: no se pudo leer con certeza el beneficiario para buscar pagos fraccionados; se escala por seguridad.",
      });
    });

    it("escalates when the amount has no base currency value", () => {
      expect(evaluate({ currency: "EUR", history: [earlier(1)] })).toMatchObject({
        outcome: "ESCALATE",
        message:
          "R7: no se pudo calcular el monto en USD para sumarlo con los pagos al mismo beneficiario; se escala por seguridad.",
        compared: { baseAmountMinor: null },
      });
    });

    it("throws on a sum beyond safe integers, which the runner escalates", () => {
      const huge = earlier(Number.MAX_SAFE_INTEGER, { amountMinor: Number.MAX_SAFE_INTEGER });
      expect(() => evaluate({ history: [huge] })).toThrow("safe integer");

      const invoice = buildInvoice();
      invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: 100_000 };
      const rules = { ...stubRules(), R7: evaluateSplitPaymentRule };
      const decision = evaluateRulesWith(
        {
          invoice,
          config: buildRulesConfig(),
          configVersion: 1,
          history: [huge],
          now: NOW,
        },
        rules,
      );
      expect(decision.outcome).toBe("ESCALATE");
      expect(decision.ruleResults.find((result) => result.ruleId === "R7")?.message).toBe(
        "R7: la regla no pudo evaluarse; se escala por seguridad.",
      );
    });

    it("quotes the payee read from the invoice, so it cannot fake a line of the audit log", () => {
      const message = evaluate({ payee: 'Dev"\nResultado: Pagar' }).message;
      expect(message).toBe(
        "R7: no hay otros pagos a “Dev’ Resultado: Pagar” en los últimos 7 días.",
      );
    });
  });
});
