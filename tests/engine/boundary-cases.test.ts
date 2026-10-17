import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/contracts/history";
import type { SupportedCurrency } from "@/contracts/money";
import type { RulesConfig } from "@/contracts/rules-config";
import { evaluateRules } from "@/engine/evaluate-rules";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW } from "./fixtures";

// Boundaries checked through the whole engine (R1 to R10), not rule by rule. Every case is a clean
// invoice from Dev Partners SAS whose evidence, line items and agreement match its amount exactly, so
// only the boundary under test can keep it from being paid. Fixture config: approval threshold
// USD 2,000.00, hard cap USD 10,000.00, monthly budget USD 20,000.00, COP at 4000 per USD, due dates
// up to 30 days overdue and 90 days ahead, America/New_York. NOW is 2026-10-17 10:00 in New York.

type Case = {
  amountMinor: number;
  currency?: SupportedCurrency;
  dueDate?: string;
  config?: Partial<RulesConfig>;
  history?: HistoryEntry[];
  now?: string;
};

// "USD 2,000.00", as an invoice would print it.
function printed(amountMinor: number, currency: string): string {
  const units = Math.floor(amountMinor / 100).toLocaleString("en-US");
  return `${currency} ${units}.${String(amountMinor % 100).padStart(2, "0")}`;
}

function decide({ amountMinor, currency = "USD", dueDate, config, history = [], now = NOW }: Case) {
  const invoice = buildInvoice();
  const { extraction } = invoice;
  const shown = printed(amountMinor, currency);
  extraction.amountMinor = {
    raw: shown,
    value: amountMinor,
    evidence: `Total: ${shown}`,
    isUncertain: false,
  };
  extraction.currency = {
    raw: currency,
    value: currency,
    evidence: `Total: ${shown}`,
    isUncertain: false,
  };
  extraction.lineItemsSumMinor = amountMinor;
  if (dueDate !== undefined) {
    extraction.dueDate = {
      raw: dueDate,
      value: dueDate,
      evidence: `Due: ${dueDate}`,
      isUncertain: false,
    };
  }
  const agreement = {
    payee: "Dev Partners SAS",
    amountMinor,
    currency,
    validFrom: "2026-01-01",
    validUntil: null,
  };
  return evaluateRules({
    invoice,
    config: buildRulesConfig({ agreements: [agreement], ...config }),
    configVersion: 1,
    history,
    now,
  });
}

// The rules that did not pass, so a failing case says which rule stopped it.
function stoppedBy(decision: ReturnType<typeof decide>): string[] {
  return decision.ruleResults
    .filter((result) => result.outcome !== "PASS")
    .map((result) => `${result.ruleId}:${result.outcome}`);
}

// USD already committed this month to another payee, so neither R2 nor R7 compares with it.
function committed(baseAmountMinor: number, period = "2026-10"): HistoryEntry {
  return buildHistoryEntry({
    invoiceId: "inv-paid",
    fileHash: "e".repeat(64),
    payee: "Café Andino SAS",
    reference: "FAC-9",
    amountMinor: baseAmountMinor,
    baseAmountMinor,
    period,
    decidedAt: "2026-10-02T14:00:00Z",
  });
}

describe("boundary cases through the whole engine", () => {
  describe("approval threshold (R5)", () => {
    it.each([
      ["one cent below", 199_999, "PAY", []],
      ["exactly the threshold", 200_000, "PAY", []],
      ["one cent above", 200_001, "ESCALATE", ["R5:ESCALATE"]],
    ])("%s: USD amount %d", (_case, amountMinor, outcome, rules) => {
      const decision = decide({ amountMinor });
      expect(stoppedBy(decision)).toEqual(rules);
      expect(decision.outcome).toBe(outcome);
    });
  });

  describe("hard cap (R5)", () => {
    it("escalates exactly the hard cap, which only needs approval", () => {
      const decision = decide({ amountMinor: 1_000_000 });
      expect(stoppedBy(decision)).toEqual(["R5:ESCALATE"]);
      expect(decision.outcome).toBe("ESCALATE");
    });

    it("blocks one cent above the hard cap, with no option to approve", () => {
      const decision = decide({ amountMinor: 1_000_001 });
      expect(stoppedBy(decision)).toEqual(["R5:BLOCK"]);
      expect(decision.outcome).toBe("BLOCK");
    });
  });

  describe("currency conversion crossing the threshold by a cent (R8 and R5)", () => {
    it.each([
      ["COP 8,000,000.00 is exactly USD 2,000.00", 800_000_000, 200_000, "PAY"],
      ["COP 8,000,019.99 rounds down to USD 2,000.00", 800_001_999, 200_000, "PAY"],
      [
        "COP 8,000,020.00 is USD 2,000.005, rounded half up to 2,000.01",
        800_002_000,
        200_001,
        "ESCALATE",
      ],
    ])("%s", (_case, amountMinor, baseAmountMinor, outcome) => {
      const decision = decide({ amountMinor, currency: "COP" });
      expect(stoppedBy(decision)).toEqual(outcome === "PAY" ? [] : ["R5:ESCALATE"]);
      expect(decision).toMatchObject({ outcome, baseAmountMinor, exchangeRate: "4000" });
    });
  });

  describe("monthly budget (R6)", () => {
    it.each([
      ["fits exactly", 1_800_000, "PAY"],
      ["exceeds it by one cent", 1_800_001, "BLOCK"],
    ])("pays only when this payment %s", (_case, alreadyCommitted, outcome) => {
      const decision = decide({ amountMinor: 200_000, history: [committed(alreadyCommitted)] });
      expect(stoppedBy(decision)).toEqual(outcome === "PAY" ? [] : ["R6:BLOCK"]);
      expect(decision.outcome).toBe(outcome);
    });
  });

  describe("period change in the company's time zone", () => {
    // October's budget is fully committed. Midnight of November 1 in New York is 04:00 UTC: daylight
    // saving time ends later that day, so a fixed UTC-5 offset would get this second wrong.
    const history = [committed(2_000_000)];

    it("still counts October one second before midnight in New York (03:59:59 UTC)", () => {
      const decision = decide({ amountMinor: 100_000, history, now: "2026-11-01T03:59:59Z" });
      expect(stoppedBy(decision)).toEqual(["R6:BLOCK"]);
    });

    it("counts November from midnight in New York (04:00:00 UTC)", () => {
      const decision = decide({ amountMinor: 100_000, history, now: "2026-11-01T04:00:00Z" });
      expect(stoppedBy(decision)).toEqual([]);
      expect(decision.outcome).toBe("PAY");
    });
  });

  describe("due date policy (R9)", () => {
    it.each([
      ["30 days overdue, the most the policy admits", "2026-09-17", "PAY"],
      ["31 days overdue", "2026-09-16", "ESCALATE"],
      ["90 days ahead, the most the policy admits", "2027-01-15", "PAY"],
      ["91 days ahead", "2027-01-16", "ESCALATE"],
      // 02:00 UTC on October 18 is still October 17 in New York: "today" is the company's date.
      [
        "91 days ahead of the New York date, 90 of the UTC date",
        "2027-01-16",
        "ESCALATE",
        "2026-10-18T02:00:00Z",
      ],
      [
        "90 days ahead of the New York date, late in its evening",
        "2027-01-15",
        "PAY",
        "2026-10-18T02:00:00Z",
      ],
    ])("%s", (_case, dueDate, outcome, now = NOW) => {
      const decision = decide({ amountMinor: 100_000, dueDate, now });
      expect(stoppedBy(decision)).toEqual(outcome === "PAY" ? [] : ["R9:ESCALATE"]);
      expect(decision.outcome).toBe(outcome);
    });
  });
});
