import { type Approval, ApprovalSchema } from "@/contracts/approval";
import { type Period, PeriodSchema } from "@/contracts/dates";
import type { Executor } from "./db";

// period is the budget period of the approval (configured time zone), fixed when it is resolved.
// The primary key on decision_id refuses a second resolution of the same decision.
export async function insertApproval(
  db: Executor,
  approval: Approval,
  period: Period,
): Promise<void> {
  const valid = ApprovalSchema.parse(approval);
  await db.execute({
    sql: "INSERT INTO approvals (decision_id, period, approval_json) VALUES (?, ?, ?)",
    args: [valid.decisionId, PeriodSchema.parse(period), JSON.stringify(valid)],
  });
}
