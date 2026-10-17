import { describe, expect, it } from "vitest";
import type { ApprovalRequest } from "@/contracts/approval";
import type { Decision } from "@/contracts/decision";
import type { HistoryEntry } from "@/contracts/history";
import type { Invoice } from "@/contracts/invoice";
import type { RulesConfig } from "@/contracts/rules-config";
import { revalidateApproval } from "@/engine/revalidate-approval";
import { buildRuleResults } from "../contracts/fixtures";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW } from "./fixtures";

// NOW is in October 2026. The fixture config: monthly budget USD 20,000.00, COP at 4000 per USD.
const APPROVE: ApprovalRequest = {
  action: "APPROVE",
  approver: "ana@empresa.com",
  comment: "Revisado con el proveedor.",
};

// The fixture invoice inv-1 (Dev Partners SAS, INV-102, USD 2,500.00), escalated by R5.
function buildDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "decision-inv-1",
    invoiceId: "inv-1",
    outcome: "ESCALATE",
    ruleResults: buildRuleResults({ R5: "ESCALATE" }),
    amountMinor: 250_000,
    currency: "USD",
    exchangeRate: "1",
    baseAmountMinor: 250_000,
    explanation: "Escalada: R5 result",
    configVersion: 1,
    decidedAt: "2026-10-10T14:00:00Z",
    ...overrides,
  };
}

// The escalation being approved, as stored in history.
function pendingEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return buildHistoryEntry({
    invoiceId: "inv-1",
    fileHash: "a".repeat(64),
    reference: "INV-102",
    amountMinor: 250_000,
    baseAmountMinor: 250_000,
    status: "PENDING_APPROVAL",
    decidedAt: "2026-10-10T14:00:00Z",
    ...overrides,
  });
}

// Payments already committed in October, so the remaining budget is the given amount.
function committedLeaving(remainingMinor: number): HistoryEntry {
  const committed = 2_000_000 - remainingMinor;
  return buildHistoryEntry({
    invoiceId: "inv-paid",
    fileHash: "e".repeat(64),
    payee: "Café Andino SAS",
    reference: "FAC-9",
    amountMinor: committed,
    baseAmountMinor: committed,
  });
}

type Scenario = {
  request?: ApprovalRequest;
  decision?: Decision;
  invoice?: Invoice;
  config?: Partial<RulesConfig>;
  history?: HistoryEntry[];
  now?: string;
};

function resolve(scenario: Scenario = {}) {
  return revalidateApproval({
    request: scenario.request ?? APPROVE,
    decision: scenario.decision ?? buildDecision(),
    invoice: scenario.invoice ?? buildInvoice(),
    config: buildRulesConfig(scenario.config),
    history: scenario.history ?? [pendingEntry()],
    now: scenario.now ?? NOW,
  });
}

describe("revalidateApproval", () => {
  describe("rejection", () => {
    it("blocks without revalidating anything, recording who rejected it and why", () => {
      const request: ApprovalRequest = {
        action: "REJECT",
        approver: "ana@empresa.com",
        comment: "No corresponde.",
      };
      expect(resolve({ request })).toEqual({
        ...request,
        decisionId: "decision-inv-1",
        resultingOutcome: "BLOCK",
        revalidationResults: [],
        amountMinor: 250_000,
        currency: "USD",
        exchangeRate: "1",
        baseAmountMinor: 250_000,
        resolvedAt: NOW,
      });
    });
  });

  describe("approval", () => {
    it("pays when duplicates and budget pass again, recording the money it commits", () => {
      const approval = resolve();
      expect(approval).toMatchObject({
        ...APPROVE,
        decisionId: "decision-inv-1",
        resultingOutcome: "PAY",
        amountMinor: 250_000,
        currency: "USD",
        exchangeRate: "1",
        baseAmountMinor: 250_000,
        resolvedAt: NOW,
      });
      expect(approval.revalidationResults.map((result) => [result.ruleId, result.outcome])).toEqual(
        [
          ["R2", "PASS"],
          ["R6", "PASS"],
        ],
      );
    });

    it("blocks when a copy of the invoice was paid since it was escalated", () => {
      const paidCopy = buildHistoryEntry({
        invoiceId: "inv-0",
        reference: "INV-102",
        amountMinor: 250_000,
        baseAmountMinor: 250_000,
      });
      const approval = resolve({ history: [pendingEntry(), paidCopy] });
      expect(approval.resultingOutcome).toBe("BLOCK");
      expect(approval.revalidationResults[0]).toMatchObject({ ruleId: "R2", outcome: "BLOCK" });
    });

    it("blocks a copy already paid when the payee of the escalated invoice could not be read", () => {
      const invoice = buildInvoice();
      invoice.extraction.payee = { ...invoice.extraction.payee, value: null, isUncertain: true };
      const paidCopy = buildHistoryEntry({
        invoiceId: "inv-0",
        reference: "INV-102",
        amountMinor: 250_000,
        baseAmountMinor: 250_000,
      });
      const approval = resolve({ invoice, history: [pendingEntry({ payee: null }), paidCopy] });
      expect(approval.resultingOutcome).toBe("BLOCK");
      expect(approval.revalidationResults[0]).toMatchObject({
        ruleId: "R2",
        outcome: "BLOCK",
        compared: { matchType: "SAME_REFERENCE", matchedInvoiceId: "inv-0" },
      });
    });

    it.each([
      ["written with a leading zero", { reference: "INV-0102" }],
      ["whose payee could not be read", { reference: "INV-102", payee: null }],
    ])("blocks a copy with the same reference %s, paid while it waited", (_case, overrides) => {
      // Escalated on 2026-10-10; the copy was approved and paid on 2026-10-12.
      const paidLater = buildHistoryEntry({
        invoiceId: "inv-0",
        amountMinor: 250_000,
        baseAmountMinor: 250_000,
        decidedAt: "2026-10-12T14:00:00Z",
        ...overrides,
      });
      const approval = resolve({ history: [pendingEntry(), paidLater] });
      expect(approval.resultingOutcome).toBe("BLOCK");
      expect(approval.revalidationResults[0]).toMatchObject({
        ruleId: "R2",
        outcome: "BLOCK",
        compared: { matchType: "SAME_REFERENCE", matchedInvoiceId: "inv-0" },
      });
    });

    // FAC-102 (A) and FAC-103 (B), same payee and amount: R2 escalated them as near duplicates.
    const fee = (id: string, hash: string, reference: string) => {
      const invoice = buildInvoice({ id, fileHash: hash.repeat(64) });
      invoice.extraction.reference = {
        ...invoice.extraction.reference,
        raw: reference,
        value: reference,
        evidence: `Invoice ${reference}`,
      };
      return invoice;
    };
    const feeA = fee("inv-a", "c", "FAC-102");
    const feeB = fee("inv-b", "d", "FAC-103");
    const entryOf = (invoice: Invoice, status: "PAYABLE" | "PENDING_APPROVAL") =>
      pendingEntry({
        invoiceId: invoice.id,
        fileHash: invoice.fileHash,
        reference: invoice.extraction.reference.value,
        status,
        // E records an approved escalation with the date of its approval, after the other escalated.
        decidedAt: status === "PAYABLE" ? "2026-10-12T14:00:00Z" : "2026-10-10T14:00:00Z",
      });

    it.each([
      ["A first, then B", feeA, feeB],
      ["B first, then A", feeB, feeA],
    ])(
      "approves two monthly fees with near references in either order: %s",
      (_case, first, second) => {
        const history = [entryOf(first, "PAYABLE"), entryOf(second, "PENDING_APPROVAL")];
        const decision = buildDecision({ id: `decision-${second.id}`, invoiceId: second.id });
        expect(resolve({ invoice: second, decision, history }).resultingOutcome).toBe("PAY");
      },
    );

    it("does not let other pending escalations block it: the approver chooses among them", () => {
      const otherPending = buildHistoryEntry({
        invoiceId: "inv-p",
        fileHash: "f".repeat(64),
        reference: "INV-300",
        amountMinor: 1_900_000,
        baseAmountMinor: 1_900_000,
        status: "PENDING_APPROVAL",
      });
      expect(resolve({ history: [pendingEntry(), otherPending] }).resultingOutcome).toBe("PAY");
    });

    it.each([
      ["one cent below the remaining budget", 250_001, "PAY"],
      ["exactly the remaining budget", 250_000, "PAY"],
      ["one cent above the remaining budget", 249_999, "BLOCK"],
    ])("compares the payment with %s", (_case, remainingMinor, outcome) => {
      const history = [pendingEntry(), committedLeaving(remainingMinor)];
      expect(resolve({ history }).resultingOutcome).toBe(outcome);
    });

    it("counts the budget of the period of the approval, not of the escalation", () => {
      const history = [pendingEntry({ period: "2026-10" }), committedLeaving(0)];
      expect(resolve({ history }).resultingOutcome).toBe("BLOCK");
      expect(resolve({ history, now: "2026-11-02T14:00:00Z" }).resultingOutcome).toBe("PAY");
    });
  });

  describe("boundaries", () => {
    it("counts the budget of the approval's local month at a month change", () => {
      const history = [pendingEntry(), committedLeaving(0)];
      // 2026-11-01 03:30 UTC is still October 31 in New York; 05:00 UTC is November 1.
      expect(resolve({ history, now: "2026-11-01T03:30:00Z" }).resultingOutcome).toBe("BLOCK");
      expect(resolve({ history, now: "2026-11-01T05:00:00Z" }).resultingOutcome).toBe("PAY");
    });

    it("blocks an exact copy paid in an earlier period: duplicates are checked across all periods", () => {
      const paidInAugust = buildHistoryEntry({
        invoiceId: "inv-0",
        reference: "INV-102",
        amountMinor: 250_000,
        baseAmountMinor: 250_000,
        period: "2026-08",
        decidedAt: "2026-08-12T14:00:00Z",
      });
      expect(resolve({ history: [pendingEntry(), paidInAugust] }).resultingOutcome).toBe("BLOCK");
    });

    it("blocks an exact copy even when the escalated invoice was read with uncertain fields", () => {
      const invoice = buildInvoice();
      invoice.extraction.payee = { ...invoice.extraction.payee, isUncertain: true };
      invoice.extraction.reference = { ...invoice.extraction.reference, isUncertain: true };
      const paidCopy = buildHistoryEntry({
        invoiceId: "inv-0",
        reference: "INV-102",
        amountMinor: 250_000,
        baseAmountMinor: 250_000,
      });
      expect(resolve({ invoice, history: [pendingEntry(), paidCopy] })).toMatchObject({
        resultingOutcome: "BLOCK",
        revalidationResults: [{ ruleId: "R2", outcome: "BLOCK" }, { ruleId: "R6" }],
      });
    });

    it("uses the budget configured at approval, lowered since the escalation", () => {
      expect(resolve({ config: { monthlyBudgetMinor: 249_999 } }).resultingOutcome).toBe("BLOCK");
      expect(resolve({ config: { monthlyBudgetMinor: 250_000 } }).resultingOutcome).toBe("PAY");
    });
  });

  describe("money stored in the decision (task 1)", () => {
    // COP 4,000,000.00 escalated at 4000 COP per USD: USD 1,000.00. The rate is now 8000.
    const invoice = buildInvoice();
    invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: 400_000_000 };
    invoice.extraction.currency = { ...invoice.extraction.currency, value: "COP" };
    const decision = buildDecision({
      amountMinor: 400_000_000,
      currency: "COP",
      exchangeRate: "4000",
      baseAmountMinor: 100_000,
    });
    const config = { exchangeRates: { USD: "1", COP: "8000" } };
    const history = [
      pendingEntry({
        amountMinor: 400_000_000,
        currency: "COP",
        exchangeRate: "4000",
        baseAmountMinor: 100_000,
      }),
      committedLeaving(99_999),
    ];

    it("blocks with the stored USD 1,000.00, although today's rate would make it USD 500.00", () => {
      const approval = resolve({ invoice, decision, config, history });
      expect(approval).toMatchObject({
        resultingOutcome: "BLOCK",
        exchangeRate: "4000",
        baseAmountMinor: 100_000,
      });
      expect(approval.revalidationResults[1]).toMatchObject({
        ruleId: "R6",
        outcome: "BLOCK",
        compared: { baseAmountMinor: 100_000 },
      });
    });

    it("pays with the stored rate and base amount when the budget allows them", () => {
      const roomy = [history[0] as HistoryEntry, committedLeaving(100_000)];
      expect(resolve({ invoice, decision, config, history: roomy })).toMatchObject({
        resultingOutcome: "PAY",
        exchangeRate: "4000",
        baseAmountMinor: 100_000,
      });
    });
  });

  describe("approval without base amount (task 2)", () => {
    it("blocks with a message that matches the outcome, even if the invoice converts today", () => {
      const decision = buildDecision({
        ruleResults: buildRuleResults({ R8: "ESCALATE" }),
        exchangeRate: null,
        baseAmountMinor: null,
      });
      const history = [pendingEntry({ exchangeRate: null, baseAmountMinor: null })];
      const approval = resolve({ decision, history });
      expect(approval.resultingOutcome).toBe("BLOCK");
      expect(approval.revalidationResults[1]).toMatchObject({
        ruleId: "R6",
        outcome: "BLOCK",
        message:
          "R6: no se puede aprobar: la decisión no tiene monto en USD para compararlo con el presupuesto.",
      });
    });
  });

  describe("approving two escalations in sequence (task 3)", () => {
    // A (inv-1) and B (inv-2) are pending, USD 2,500.00 each; the budget leaves room for both exactly.
    const invoiceB = buildInvoice({ id: "inv-2", fileHash: "d".repeat(64) });
    invoiceB.extraction.reference = {
      ...invoiceB.extraction.reference,
      raw: "INV-200",
      value: "INV-200",
      evidence: "Invoice INV-200",
    };
    const pendingB = (baseAmountMinor: number) =>
      pendingEntry({
        invoiceId: "inv-2",
        fileHash: "d".repeat(64),
        reference: "INV-200",
        amountMinor: baseAmountMinor,
        baseAmountMinor,
      });
    const decisionB = (baseAmountMinor: number) =>
      buildDecision({
        id: "decision-inv-2",
        invoiceId: "inv-2",
        amountMinor: baseAmountMinor,
        baseAmountMinor,
      });

    it.each([
      ["fits exactly", 250_000, "PAY"],
      ["exceeds by one cent", 250_001, "BLOCK"],
    ])("approves A, then B %s", (_case, amountB, outcomeB) => {
      const before = [pendingEntry(), pendingB(amountB), committedLeaving(500_000)];
      expect(resolve({ history: before }).resultingOutcome).toBe("PAY");

      // E records A as PAYABLE in the period of the approval.
      const after = [
        pendingEntry({ status: "PAYABLE", period: "2026-10" }),
        pendingB(amountB),
        committedLeaving(500_000),
      ];
      const invoice = {
        ...invoiceB,
        extraction: {
          ...invoiceB.extraction,
          amountMinor: { ...invoiceB.extraction.amountMinor, value: amountB },
        },
      };
      expect(
        resolve({ invoice, decision: decisionB(amountB), history: after }).resultingOutcome,
      ).toBe(outcomeB);
    });
  });

  describe("two escalations of the same file (task 4)", () => {
    it("pays the first approval and blocks the second, so the file is never paid twice", () => {
      const retry = pendingEntry();
      expect(resolve({ history: [pendingEntry(), retry] }).resultingOutcome).toBe("PAY");

      const afterFirst = [pendingEntry({ status: "PAYABLE" }), retry];
      const second = resolve({
        decision: buildDecision({ id: "decision-inv-1-retry" }),
        history: afterFirst,
      });
      expect(second.resultingOutcome).toBe("BLOCK");
      expect(second.revalidationResults[0]).toMatchObject({
        ruleId: "R2",
        outcome: "BLOCK",
        compared: { matchType: "SAME_FILE" },
      });
    });
  });

  describe("fail-safe", () => {
    it("blocks and records the failure when a check throws", () => {
      const huge = buildHistoryEntry({
        invoiceId: "inv-huge",
        fileHash: "c".repeat(64),
        payee: "Café Andino SAS",
        reference: "FAC-1",
        amountMinor: Number.MAX_SAFE_INTEGER,
        baseAmountMinor: Number.MAX_SAFE_INTEGER,
      });
      const approval = resolve({ history: [pendingEntry(), huge] });
      expect(approval.resultingOutcome).toBe("BLOCK");
      expect(approval.revalidationResults[1]).toEqual({
        ruleId: "R6",
        outcome: "BLOCK",
        message: "R6: la regla no pudo revalidarse al aprobar; no se paga por seguridad.",
        compared: { error: "Budget sum exceeds safe integer range" },
      });
    });

    it.each([
      ["a paid decision", "PAY" as const],
      ["a blocked decision", "BLOCK" as const],
    ])("refuses to resolve %s", (_case, outcome) => {
      const ruleResults = buildRuleResults(outcome === "BLOCK" ? { R3: "BLOCK" } : {});
      const decision = buildDecision({ outcome, ruleResults });
      expect(() => resolve({ decision })).toThrow("Only an escalated decision can be resolved");
    });

    it.each([
      ["rejected", "REJECTED" as const],
      ["blocked at a previous approval", "BLOCKED" as const],
      ["already approved and paid", "PAYABLE" as const],
    ])("refuses to resolve again an escalation already %s", (_case, status) => {
      const history = [pendingEntry({ status })];
      expect(() => resolve({ history })).toThrow("is no longer pending approval");
      const reject = { ...APPROVE, action: "REJECT" as const };
      expect(() => resolve({ request: reject, history })).toThrow("is no longer pending approval");
    });

    it("refuses to approve next month, with a fresh budget, what was blocked this month", () => {
      const history = [pendingEntry(), committedLeaving(0)];
      expect(resolve({ history }).resultingOutcome).toBe("BLOCK");
      const afterBlock = [pendingEntry({ status: "BLOCKED" }), committedLeaving(0)];
      expect(() => resolve({ history: afterBlock, now: "2026-11-02T14:00:00Z" })).toThrow(
        "is no longer pending approval",
      );
    });

    it("refuses an escalation that is not in history", () => {
      expect(() => resolve({ history: [] })).toThrow("is no longer pending approval");
    });

    it("refuses a decision whose money differs from the invoice, so R2 and R6 see the same", () => {
      const invoice = buildInvoice();
      invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: 100_000 };
      expect(() => resolve({ invoice })).toThrow("records other money than invoice inv-1");
      const decision = buildDecision({
        currency: "MXN",
        exchangeRate: "18.50",
        baseAmountMinor: 13_514,
      });
      expect(() => resolve({ decision })).toThrow("records other money than invoice inv-1");
    });

    it("refuses a stored base amount that its own stored rate does not give", () => {
      const invoice = buildInvoice();
      invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: 8_000_000_000 };
      invoice.extraction.currency = { ...invoice.extraction.currency, value: "COP" };
      const tampered = buildDecision({
        amountMinor: 8_000_000_000,
        currency: "COP",
        exchangeRate: "4000",
        baseAmountMinor: 1,
      });
      const history = [
        pendingEntry({
          amountMinor: 8_000_000_000,
          currency: "COP",
          exchangeRate: "4000",
          baseAmountMinor: 1,
        }),
      ];
      expect(() => resolve({ invoice, decision: tampered, history })).toThrow(
        "records a base amount its exchange rate does not give",
      );
    });

    it("refuses a decision of another invoice", () => {
      const decision = buildDecision({ invoiceId: "inv-9" });
      expect(() => resolve({ decision })).toThrow("belongs to inv-9");
    });

    it("refuses a request without a comment", () => {
      expect(() => resolve({ request: { ...APPROVE, comment: "  " } })).toThrow();
    });
  });
});
