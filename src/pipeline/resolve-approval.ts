import type { ApprovalRequest } from "@/contracts/approval";
import type { DecisionRecord } from "@/contracts/decision-record";
import { revalidateApproval } from "@/engine/revalidate-approval";
import { toPeriod } from "@/engine/rule-context";
import { insertApproval } from "@/store/approval-repository";
import { appendAuditEntry } from "@/store/audit-log";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";
import { findDecisionRecord, listHistoryEntries } from "@/store/decision-repository";
import type { Client } from "@libsql/client";

export type ResolveApprovalResult =
  | { ok: true; record: DecisionRecord }
  | { ok: false; reason: "NOT_FOUND" | "NOT_ESCALATED" | "ALREADY_RESOLVED" | "NO_RULES_CONFIG" };

// A person resolves an escalation. The engine revalidates duplicates and budget with the history of
// this moment; everything is read and stored in one write transaction, so two approvals at once cannot
// both spend the same budget. A throw stores nothing. An approval that ends in BLOCK is a success: the
// record carries the revalidation results that explain it.
export function resolveApproval(
  db: Client,
  decisionId: string,
  request: ApprovalRequest,
  now: string,
): Promise<ResolveApprovalResult> {
  return withWriteTransaction<ResolveApprovalResult>(db, async (tx) => {
    const record = await findDecisionRecord(tx, decisionId);
    if (record === null) return { ok: false, reason: "NOT_FOUND" };
    if (record.approval !== null) return { ok: false, reason: "ALREADY_RESOLVED" };
    if (record.decision.outcome !== "ESCALATE") return { ok: false, reason: "NOT_ESCALATED" };
    const current = await findCurrentRulesConfig(tx);
    if (current === null) return { ok: false, reason: "NO_RULES_CONFIG" };

    const approval = revalidateApproval({
      request,
      decision: record.decision,
      invoice: record.invoice,
      config: current.config,
      history: await listHistoryEntries(tx),
      now,
    });
    await insertApproval(tx, approval, toPeriod(now, current.config.timezone));
    await appendAuditEntry(
      tx,
      "APPROVAL",
      { invoiceId: record.invoice.id, fileName: record.fileName, approval },
      now,
    );

    const resolved = await findDecisionRecord(tx, decisionId);
    if (resolved === null) throw new Error(`Decision ${decisionId} disappeared while resolving`);
    return { ok: true, record: resolved };
  });
}
