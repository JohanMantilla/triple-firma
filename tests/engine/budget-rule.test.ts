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

function pending(invoiceId: string, baseAmountMinor: number) {
  return buildHistoryEntry({
    invoiceId,
    amountMinor: baseAmountMinor,
    baseAmountMinor,
    status: "PENDING_APPROVAL",
  });
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
          "R6: con USD 2.000,00 reservados por escaladas pendientes, este pago excedería el presupuesto de octubre de 2026; requiere revisión humana.",
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
  });

  describe("what counts", () => {
    it("ignores entries from another period", () => {
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

  it("still blocks one cent above the committed budget", () => {
    const ctx = buildContext(400_001, history);
    expect(checkBudget(ctx, { isReservingPending: false }).outcome).toBe("BLOCK");
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
