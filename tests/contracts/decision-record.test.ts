import { describe, expect, it } from "vitest";
import {
  type DecisionRecord,
  DecisionRecordSchema,
  deriveHistoryStatus,
} from "@/contracts/decision-record";
import { buildApproval, buildDecision } from "./fixtures";
import { buildInvoice } from "../engine/fixtures";

function buildRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const invoice = buildInvoice();
  return {
    fileName: "dev/01-invoice.pdf",
    status: "PENDING_APPROVAL",
    invoice,
    decision: buildDecision(invoice.id, "ESCALATE"),
    approval: null,
    extractionFailure: null,
    ...overrides,
  };
}

describe("deriveHistoryStatus", () => {
  it.each([
    ["PAY", null, "PAYABLE"],
    ["BLOCK", null, "BLOCKED"],
    ["ESCALATE", null, "PENDING_APPROVAL"],
    ["ESCALATE", { action: "REJECT", resultingOutcome: "BLOCK" }, "REJECTED"],
    ["ESCALATE", { action: "APPROVE", resultingOutcome: "PAY" }, "PAYABLE"],
    ["ESCALATE", { action: "APPROVE", resultingOutcome: "BLOCK" }, "BLOCKED"],
  ] as const)("%s with approval %o is %s", (outcome, approval, status) => {
    expect(deriveHistoryStatus(outcome, approval)).toBe(status);
  });
});

describe("DecisionRecordSchema", () => {
  it("accepts a pending escalation", () => {
    expect(DecisionRecordSchema.safeParse(buildRecord()).success).toBe(true);
  });

  it("accepts an approved escalation as PAYABLE", () => {
    const record = buildRecord();
    const approval = buildApproval(record.decision, "APPROVED");
    const parsed = DecisionRecordSchema.safeParse({ ...record, approval, status: "PAYABLE" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a status that does not follow from the decision and its approval", () => {
    expect(DecisionRecordSchema.safeParse(buildRecord({ status: "PAYABLE" })).success).toBe(false);
  });

  it("rejects an approval on a decision that was not escalated", () => {
    const invoice = buildInvoice();
    const decision = buildDecision(invoice.id, "PAY");
    const record = buildRecord({ decision, status: "PAYABLE" });
    const approval = buildApproval(decision, "APPROVED");
    expect(DecisionRecordSchema.safeParse({ ...record, approval }).success).toBe(false);
  });

  it("rejects a decision of another invoice", () => {
    const record = buildRecord({ decision: buildDecision("inv-other", "ESCALATE") });
    expect(DecisionRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects an approval of another decision", () => {
    const record = buildRecord();
    const approval = buildApproval(buildDecision("inv-other", "ESCALATE"), "REJECTED");
    const parsed = DecisionRecordSchema.safeParse({ ...record, approval, status: "REJECTED" });
    expect(parsed.success).toBe(false);
  });
});
