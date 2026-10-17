import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { RuleResultSchema } from "./decision";

export const ApprovalActionSchema = z.enum(["APPROVE", "REJECT"]);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

// Body of POST /api/approvals/[decisionId]. The comment is mandatory so every resolution is explained.
export const ApprovalRequestSchema = z.object({
  action: ApprovalActionSchema,
  approver: z.string().trim().min(1).max(100),
  comment: z.string().trim().min(1).max(1000),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// A rejection is final. An approval pays only if duplicates (R2) and budget (R6) still pass right now.
export const ApprovalSchema = ApprovalRequestSchema.extend({
  decisionId: z.string().min(1),
  resultingOutcome: z.enum(["PAY", "BLOCK"]),
  revalidationResults: z.array(RuleResultSchema),
  resolvedAt: IsoDateTimeSchema,
}).superRefine((approval, ctx) => {
  if (approval.action === "REJECT" && approval.resultingOutcome !== "BLOCK") {
    ctx.addIssue({
      code: "custom",
      message: "A rejected escalation must end in BLOCK",
      path: ["resultingOutcome"],
    });
  }

  const hasFailedRevalidation = approval.revalidationResults.some(
    (result) => result.outcome !== "PASS",
  );
  if (
    approval.resultingOutcome === "PAY" &&
    (approval.revalidationResults.length === 0 || hasFailedRevalidation)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "An approval can only pay when every revalidated rule passed",
      path: ["resultingOutcome"],
    });
  }
});
export type Approval = z.infer<typeof ApprovalSchema>;
