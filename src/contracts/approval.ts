import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { type RuleId, RuleResultSchema } from "./decision";

export const REVALIDATED_RULE_IDS: readonly RuleId[] = ["R2", "R6"];

export const ApprovalActionSchema = z.enum(["APPROVE", "REJECT"]);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

// Body of POST /api/approvals/[decisionId]. The comment is mandatory so every resolution is explained.
export const ApprovalRequestSchema = z.object({
  action: ApprovalActionSchema,
  approver: z.string().trim().min(1).max(100),
  comment: z.string().trim().min(1).max(1000),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

// A rejection is final and revalidates nothing. An approval revalidates exactly duplicates (R2) and
// budget (R6) at that moment, and pays only if both pass.
export const ApprovalSchema = ApprovalRequestSchema.extend({
  decisionId: z.string().min(1),
  resultingOutcome: z.enum(["PAY", "BLOCK"]),
  revalidationResults: z.array(RuleResultSchema),
  resolvedAt: IsoDateTimeSchema,
}).superRefine((approval, ctx) => {
  if (approval.action === "REJECT") {
    if (approval.resultingOutcome !== "BLOCK") {
      ctx.addIssue({
        code: "custom",
        message: "A rejected escalation must end in BLOCK",
        path: ["resultingOutcome"],
      });
    }
    if (approval.revalidationResults.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "A rejection does not revalidate rules",
        path: ["revalidationResults"],
      });
    }
    return;
  }

  const revalidated = approval.revalidationResults.map((result) => result.ruleId);
  const isExactlyR2AndR6 =
    revalidated.length === REVALIDATED_RULE_IDS.length &&
    REVALIDATED_RULE_IDS.every((ruleId) => revalidated.includes(ruleId));
  if (!isExactlyR2AndR6) {
    ctx.addIssue({
      code: "custom",
      message: "An approval must revalidate exactly R2 and R6",
      path: ["revalidationResults"],
    });
  }

  const hasPassedRevalidation = approval.revalidationResults.every(
    (result) => result.outcome === "PASS",
  );
  const expected = isExactlyR2AndR6 && hasPassedRevalidation ? "PAY" : "BLOCK";
  if (approval.resultingOutcome !== expected) {
    ctx.addIssue({
      code: "custom",
      message: `An approval must end in ${expected} given its revalidation results`,
      path: ["resultingOutcome"],
    });
  }
});
export type Approval = z.infer<typeof ApprovalSchema>;
