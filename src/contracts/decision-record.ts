import { z } from "zod";
import { type Approval, ApprovalSchema } from "./approval";
import { type DecisionOutcome, DecisionSchema } from "./decision";
import { type HistoryEntryStatus, HistoryEntryStatusSchema } from "./history";
import { InvoiceSchema } from "./invoice";

// The status of a decision once its approval (if any) is applied. It is the status the engine sees in
// history, so the API and the rules never disagree on what is pending, payable or rejected.
export function deriveHistoryStatus(
  outcome: DecisionOutcome,
  approval: Pick<Approval, "action" | "resultingOutcome"> | null,
): HistoryEntryStatus {
  if (outcome === "PAY") return "PAYABLE";
  if (outcome === "BLOCK") return "BLOCKED";
  if (approval === null) return "PENDING_APPROVAL";
  if (approval.action === "REJECT") return "REJECTED";
  return approval.resultingOutcome === "PAY" ? "PAYABLE" : "BLOCKED";
}

// One invoice as the API returns it: its decision, the human resolution if any, and the resulting
// status. fileName is the name the file arrived with; for the dataset it is "<set>/<name>", the key of
// data/expected.csv.
export const DecisionRecordSchema = z
  .object({
    fileName: z.string().min(1),
    status: HistoryEntryStatusSchema,
    invoice: InvoiceSchema,
    decision: DecisionSchema,
    approval: ApprovalSchema.nullable(),
    extractionFailure: z.string().nullable(),
  })
  .superRefine((record, ctx) => {
    if (record.decision.invoiceId !== record.invoice.id) {
      ctx.addIssue({
        code: "custom",
        message: "The decision must belong to the invoice",
        path: ["decision", "invoiceId"],
      });
    }
    if (record.approval !== null && record.decision.outcome !== "ESCALATE") {
      ctx.addIssue({
        code: "custom",
        message: "Only an escalated decision can have an approval",
        path: ["approval"],
      });
    }
    if (record.approval !== null && record.approval.decisionId !== record.decision.id) {
      ctx.addIssue({
        code: "custom",
        message: "The approval must belong to the decision",
        path: ["approval", "decisionId"],
      });
    }
    const expected = deriveHistoryStatus(record.decision.outcome, record.approval);
    if (record.status !== expected) {
      ctx.addIssue({ code: "custom", message: `Status must be ${expected}`, path: ["status"] });
    }
  });
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
