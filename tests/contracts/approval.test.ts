import { describe, expect, it } from "vitest";
import { type Approval, ApprovalRequestSchema, ApprovalSchema } from "@/contracts/approval";
import type { RuleResult } from "@/contracts/decision";

const PASSED_REVALIDATION: RuleResult[] = [
  { ruleId: "R2", outcome: "PASS", message: "Sin duplicados.", compared: {} },
  { ruleId: "R6", outcome: "PASS", message: "Cabe en el presupuesto.", compared: {} },
];

function buildApproval(overrides: Partial<Approval> = {}): Approval {
  return {
    decisionId: "dec-1",
    action: "APPROVE",
    approver: "Laura",
    comment: "Pago recurrente revisado.",
    resultingOutcome: "PAY",
    revalidationResults: PASSED_REVALIDATION,
    resolvedAt: "2026-10-17T11:00:00-04:00",
    ...overrides,
  };
}

describe("ApprovalRequestSchema", () => {
  it("accepts an approval with a comment", () => {
    const request = { action: "APPROVE", approver: "Laura", comment: "Revisado." };
    expect(ApprovalRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each(["", "   "])("rejects the comment %j", (comment) => {
    const request = { action: "REJECT", approver: "Laura", comment };
    expect(ApprovalRequestSchema.safeParse(request).success).toBe(false);
  });

  it("rejects a request without approver", () => {
    expect(
      ApprovalRequestSchema.safeParse({ action: "APPROVE", approver: " ", comment: "Ok" }).success,
    ).toBe(false);
  });
});

describe("ApprovalSchema", () => {
  it("accepts an approval that pays after passing revalidation", () => {
    expect(ApprovalSchema.safeParse(buildApproval()).success).toBe(true);
  });

  it("accepts an approval blocked by revalidation", () => {
    const revalidationResults: RuleResult[] = [
      PASSED_REVALIDATION[0],
      { ruleId: "R6", outcome: "BLOCK", message: "Ya no cabe en el presupuesto.", compared: {} },
    ];
    expect(
      ApprovalSchema.safeParse(buildApproval({ resultingOutcome: "BLOCK", revalidationResults }))
        .success,
    ).toBe(true);
  });

  it("rejects paying when revalidation failed", () => {
    const revalidationResults: RuleResult[] = [
      { ruleId: "R6", outcome: "BLOCK", message: "Ya no cabe en el presupuesto.", compared: {} },
    ];
    expect(ApprovalSchema.safeParse(buildApproval({ revalidationResults })).success).toBe(false);
  });

  it("rejects paying without any revalidation", () => {
    expect(ApprovalSchema.safeParse(buildApproval({ revalidationResults: [] })).success).toBe(
      false,
    );
  });

  it("rejects a rejection that pays", () => {
    expect(ApprovalSchema.safeParse(buildApproval({ action: "REJECT" })).success).toBe(false);
  });

  it("accepts a rejection that blocks", () => {
    const approval = buildApproval({
      action: "REJECT",
      resultingOutcome: "BLOCK",
      revalidationResults: [],
    });
    expect(ApprovalSchema.safeParse(approval).success).toBe(true);
  });
});
