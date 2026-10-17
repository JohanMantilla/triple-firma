import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/contracts/history";
import { formatPeriod } from "@/engine/messages";
import { buildRuleContext } from "@/engine/rule-context";
import { checkBudget, evaluateBudgetRule } from "@/engine/rules/budget-rule";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW } from "./fixtures";

// The fixture config: monthly budget USD 20,000.00, time zone America/New_York; NOW is in 2026-10.
function buildContext(amountMinor: number | null, history: HistoryEntry[], now = NOW) {
  const invoice = buildInvoice();
  invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: amountMinor };
  return buildRuleContext({ invoice, config: buildRulesConfig(), history, now });
}

function evaluate(amountMinor: number | null, history: HistoryEntry[] = [], now = NOW) {
  return evaluateBudgetRule(buildContext(amountMinor, history, now));
}

function payable(invoiceId: string, baseAmountMinor: number, period = "2026-10") {
  return buildHistoryEntry({
    invoiceId,
    amountMinor: baseAmountMinor,
    baseAmountMinor,
    status: "PAYABLE",
    period,
  });
}

function pending(invoiceId: string, baseAmountMinor: number, period = "2026-10") {
  return buildHistoryEntry({
    invoiceId,
    amountMinor: baseAmountMinor,
    baseAmountMinor,
    status: "PENDING_APPROVAL",
    period,
  });
}

type ExtractionEdit = {
  currency?: string;
  isAmountUncertain?: boolean;
  isCurrencyUncertain?: boolean;
};

// An invoice of amountMinor in the given currency, against USD 18,000.00 already committed.
function evaluateWith(amountMinor: number, edit: ExtractionEdit, config = buildRulesConfig()) {
  const invoice = buildInvoice();
  const { extraction } = invoice;
  extraction.amountMinor = {
    ...extraction.amountMinor,
    value: amountMinor,
    isUncertain: edit.isAmountUncertain ?? false,
  };
  extraction.currency = {
    ...extraction.currency,
    value: edit.currency ?? "USD",
    isUncertain: edit.isCurrencyUncertain ?? false,
  };
  const history = [payable("inv-a", 1_000_000), payable("inv-b", 800_000)];
  return evaluateBudgetRule(buildRuleContext({ invoice, config, history, now: NOW }));
}

const COMMITTED_18_000 = [payable("inv-a", 1_000_000), payable("inv-b", 800_000)];

describe("evaluateBudgetRule (R6)", () => {
  describe("against the committed budget", () => {
    it.each([
      ["one cent below the budget", 199_999],
      ["exactly the budget", 200_000],
    ])("passes a payment that leaves the period %s", (_case, amountMinor) => {
      expect(evaluate(amountMinor, COMMITTED_18_000).outcome).toBe("PASS");
    });

    it("blocks a payment one cent above the budget", () => {
      expect(evaluate(200_001, COMMITTED_18_000)).toMatchObject({
        outcome: "BLOCK",
        message:
          "R6: presupuesto de octubre de 2026: USD 18.000,00 comprometidos de USD 20.000,00; este pago (USD 2.000,01) lo excede.",
        compared: { committedMinor: 1_800_000, monthlyBudgetMinor: 2_000_000 },
      });
    });

    it("explains a passing payment with the running total", () => {
      expect(evaluate(250_000, [payable("inv-a", 1_400_000)]).message).toBe(
        "R6: presupuesto de octubre de 2026: USD 14.000,00 comprometidos + este pago (USD 2.500,00) = USD 16.500,00 de USD 20.000,00.",
      );
    });

    it("passes with an empty history", () => {
      expect(evaluate(2_000_000).outcome).toBe("PASS");
      expect(evaluate(2_000_001).outcome).toBe("BLOCK");
    });
  });

  describe("with reservations from pending escalations", () => {
    // USD 16,000.00 committed + USD 2,000.00 reserved: USD 2,000.00 left.
    const history = [payable("inv-a", 1_600_000), pending("inv-p", 200_000)];

    it.each([
      ["one cent below the budget", 199_999],
      ["exactly the budget", 200_000],
    ])("passes a payment that leaves the period %s", (_case, amountMinor) => {
      expect(evaluate(amountMinor, history).outcome).toBe("PASS");
    });

    it("escalates one cent above, since it fits the committed budget alone", () => {
      expect(evaluate(200_001, history)).toMatchObject({
        outcome: "ESCALATE",
        message:
          "R6: presupuesto de octubre de 2026: USD 16.000,00 comprometidos + USD 2.000,00 reservados por escaladas pendientes + este pago (USD 2.000,01) = USD 20.000,01, excede USD 20.000,00; requiere revisión humana.",
        compared: { committedMinor: 1_600_000, reservedMinor: 200_000 },
      });
    });

    it("still blocks when the committed budget alone is exceeded", () => {
      expect(evaluate(400_001, history).outcome).toBe("BLOCK");
    });

    it("names the reservations when the payment passes", () => {
      expect(evaluate(100_000, history).message).toBe(
        "R6: presupuesto de octubre de 2026: USD 16.000,00 comprometidos + USD 2.000,00 reservados + este pago (USD 1.000,00) = USD 19.000,00 de USD 20.000,00.",
      );
    });

    it("escalates the step 0 case: USD 17,000 paid, USD 2,500 pending, USD 1,500 new", () => {
      const step0 = [payable("inv-a", 1_700_000), pending("inv-p", 250_000)];
      expect(evaluate(150_000, step0)).toMatchObject({
        outcome: "ESCALATE",
        compared: { committedMinor: 1_700_000, reservedMinor: 250_000 },
      });
    });

    it("reserves for a pending escalation from an earlier period, which would be committed now", () => {
      const step0 = [payable("inv-a", 1_700_000), pending("inv-p", 250_000, "2026-09")];
      expect(evaluate(150_000, step0)).toMatchObject({
        outcome: "ESCALATE",
        compared: { reservedMinor: 250_000 },
      });
    });
  });

  describe("what counts", () => {
    it("ignores payable entries from another period", () => {
      expect(evaluate(200_000, [payable("inv-a", 1_900_000, "2026-09")]).outcome).toBe("PASS");
    });

    it.each(["REJECTED", "BLOCKED"] as const)("ignores %s entries", (status) => {
      const entry = buildHistoryEntry({ invoiceId: "inv-a", baseAmountMinor: 1_900_000, status });
      entry.amountMinor = 1_900_000;
      expect(evaluate(200_000, [entry])).toMatchObject({
        outcome: "PASS",
        compared: { committedMinor: 0, reservedMinor: 0 },
      });
    });

    it("does not reserve for a pending entry without a base amount", () => {
      const unreadable = buildHistoryEntry({
        invoiceId: "inv-p",
        amountMinor: null,
        exchangeRate: null,
        baseAmountMinor: null,
        status: "PENDING_APPROVAL",
      });
      expect(evaluate(200_000, [...COMMITTED_18_000, unreadable])).toMatchObject({
        outcome: "PASS",
        compared: { reservedMinor: 0 },
      });
    });

    it("never counts the invoice being decided, which is already pending at approval", () => {
      const self = buildHistoryEntry({
        invoiceId: "inv-1",
        amountMinor: 200_000,
        baseAmountMinor: 200_000,
        status: "PENDING_APPROVAL",
      });
      expect(evaluate(200_000, [...COMMITTED_18_000, self])).toMatchObject({
        outcome: "PASS",
        compared: { reservedMinor: 0 },
      });
    });

    it("still counts a payable entry that shares the invoice's id", () => {
      const sameId = payable("inv-1", 1_900_000);
      expect(evaluate(200_000, [sameId])).toMatchObject({
        outcome: "BLOCK",
        compared: { committedMinor: 1_900_000 },
      });
    });

    it("blocks any payment when the committed amount already exceeds the budget", () => {
      expect(evaluate(1, [payable("inv-a", 2_000_001)]).outcome).toBe("BLOCK");
    });

    it("uses the period in the configured time zone: Nov 1 03:00 UTC is still October in New York", () => {
      const result = evaluate(200_001, COMMITTED_18_000, "2026-11-01T03:00:00Z");
      expect(result).toMatchObject({ outcome: "BLOCK", compared: { period: "2026-10" } });
      expect(evaluate(200_001, COMMITTED_18_000, "2026-11-01T05:00:00Z")).toMatchObject({
        outcome: "PASS",
        compared: { period: "2026-11", committedMinor: 0 },
      });
    });
  });

  it("escalates when there is no base amount to compare", () => {
    expect(evaluate(null)).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R6: no se pudo calcular el monto en USD para compararlo con el presupuesto; se escala por seguridad.",
      compared: { baseAmountMinor: null },
    });
  });

  it.each([
    ["an uncertain amount", { isAmountUncertain: true }],
    ["an uncertain currency", { isCurrencyUncertain: true }],
    ["an unsupported currency", { currency: "EUR" }],
  ])("escalates %s, which has no base amount", (_case, edit) => {
    expect(evaluateWith(100_000, edit)).toMatchObject({
      outcome: "ESCALATE",
      compared: { baseAmountMinor: null },
    });
  });

  it("escalates a supported currency without a configured rate", () => {
    const config = buildRulesConfig({ exchangeRates: { USD: "1" } });
    expect(evaluateWith(100_000, { currency: "COP" }, config).outcome).toBe("ESCALATE");
  });

  // COP at 4000 per USD, rounded half up once: the converted amount is what meets the budget.
  it.each([
    ["COP 7.999.999,99 → USD 2.000,00", 799_999_999, "PASS", 200_000],
    ["COP 8.000.019,99 → USD 2.000,00", 800_001_999, "PASS", 200_000],
    ["COP 8.000.020,00 → USD 2.000,01 (half up)", 800_002_000, "BLOCK", 200_001],
  ])("compares the converted amount: %s", (_case, amountMinor, outcome, baseAmountMinor) => {
    expect(evaluateWith(amountMinor, { currency: "COP" })).toMatchObject({
      outcome,
      compared: { baseAmountMinor },
    });
  });

  it("throws on a sum beyond safe integers, so the runner escalates it", () => {
    const huge = [payable("inv-a", Number.MAX_SAFE_INTEGER), payable("inv-b", 1)];
    expect(() => evaluate(100, huge)).toThrow();
  });
});

describe("checkBudget without reserving pending escalations (approval revalidation)", () => {
  const history = [payable("inv-a", 1_600_000), pending("inv-p", 300_000)];

  it("lets two pending escalations not block each other", () => {
    const ctx = buildContext(400_000, history);
    expect(evaluateBudgetRule(ctx).outcome).toBe("ESCALATE");
    expect(checkBudget(ctx, { isReservingPending: false })).toMatchObject({
      outcome: "PASS",
      compared: { reservedMinor: 0 },
    });
  });

  it.each([
    ["one cent below the committed budget", 399_999, "PASS"],
    ["exactly the committed budget", 400_000, "PASS"],
    ["one cent above the committed budget", 400_001, "BLOCK"],
  ])("compares %s", (_case, amountMinor, outcome) => {
    const ctx = buildContext(amountMinor, history);
    expect(checkBudget(ctx, { isReservingPending: false }).outcome).toBe(outcome);
  });
});

describe("formatPeriod", () => {
  it.each([
    ["2026-01", "enero de 2026"],
    ["2026-10", "octubre de 2026"],
    ["2026-12", "diciembre de 2026"],
  ])("formats %s as %s", (period, expected) => {
    expect(formatPeriod(period)).toBe(expected);
  });
});
