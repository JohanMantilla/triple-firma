import type { InArgs, Row } from "@libsql/client";
import { ApprovalSchema } from "@/contracts/approval";
import { type Period, PeriodSchema } from "@/contracts/dates";
import { type Decision, DecisionSchema } from "@/contracts/decision";
import {
  type DecisionRecord,
  DecisionRecordSchema,
  deriveHistoryStatus,
} from "@/contracts/decision-record";
import {
  type HistoryEntry,
  HistoryEntrySchema,
  type HistoryEntryStatus,
} from "@/contracts/history";
import type { Executor } from "./db";

type StoredDecision = {
  record: DecisionRecord;
  decisionPeriod: Period;
  approvalPeriod: Period | null;
};

const SELECT_STORED_DECISIONS = `
SELECT i.file_name, i.invoice_json, i.extraction_failure,
       d.decision_json, d.period AS decision_period,
       a.approval_json, a.period AS approval_period
FROM decisions d
JOIN invoices i ON i.id = d.invoice_id
LEFT JOIN approvals a ON a.decision_id = d.id`;

// period is the budget period of the decision, in the configured time zone (toPeriod in the engine).
export async function insertDecision(
  db: Executor,
  decision: Decision,
  period: Period,
): Promise<void> {
  const valid = DecisionSchema.parse(decision);
  await db.execute({
    sql: "INSERT INTO decisions (id, invoice_id, period, decision_json) VALUES (?, ?, ?, ?)",
    args: [valid.id, valid.invoiceId, PeriodSchema.parse(period), JSON.stringify(valid)],
  });
}

// Idempotency: a file already processed returns its record instead of being decided again.
export async function findDecisionByFileHash(
  db: Executor,
  fileHash: string,
): Promise<DecisionRecord | null> {
  const [stored] = await selectStoredDecisions(db, "WHERE i.file_hash = ?", [fileHash]);
  return stored?.record ?? null;
}

export async function findDecisionRecord(
  db: Executor,
  decisionId: string,
): Promise<DecisionRecord | null> {
  const [stored] = await selectStoredDecisions(db, "WHERE d.id = ?", [decisionId]);
  return stored?.record ?? null;
}

// Newest first, optionally only one resulting status (the inbox asks for PENDING_APPROVAL).
// ponytail: reads every decision and filters here; add indexed columns past a few thousand invoices.
export async function listDecisionRecords(
  db: Executor,
  status?: HistoryEntryStatus,
): Promise<DecisionRecord[]> {
  const stored = await selectStoredDecisions(db, "ORDER BY d.rowid DESC", []);
  return stored
    .map(({ record }) => record)
    .filter((record) => status === undefined || record.status === status);
}

// Every past invoice the engine compares against, from every period: R2 also needs earlier months.
export async function listHistoryEntries(db: Executor): Promise<HistoryEntry[]> {
  const stored = await selectStoredDecisions(db, "ORDER BY d.rowid", []);
  return stored.map(toHistoryEntry);
}

async function selectStoredDecisions(
  db: Executor,
  clause: string,
  args: InArgs,
): Promise<StoredDecision[]> {
  const { rows } = await db.execute({ sql: `${SELECT_STORED_DECISIONS} ${clause}`, args });
  return rows.map(toStoredDecision);
}

function toStoredDecision(row: Row): StoredDecision {
  const decision = DecisionSchema.parse(JSON.parse(String(row.decision_json)));
  const approval =
    row.approval_json === null ? null : ApprovalSchema.parse(JSON.parse(String(row.approval_json)));
  const record = DecisionRecordSchema.parse({
    fileName: row.file_name,
    status: deriveHistoryStatus(decision.outcome, approval),
    invoice: JSON.parse(String(row.invoice_json)),
    decision,
    approval,
    extractionFailure: row.extraction_failure,
  });
  return {
    record,
    decisionPeriod: PeriodSchema.parse(row.decision_period),
    approvalPeriod: row.approval_period === null ? null : PeriodSchema.parse(row.approval_period),
  };
}

// An approved escalation counts in the period and at the time of its approval (HistoryEntry contract).
// Money is always the decision's, never recomputed. An uncertain payee or reference is null, the same
// way rule-context.ts treats uncertain money, so R2 compares only on what was read with certainty.
function toHistoryEntry({ record, decisionPeriod, approvalPeriod }: StoredDecision): HistoryEntry {
  const { invoice, decision, approval, status } = record;
  const { payee, reference } = invoice.extraction;
  const approvedPayment = approval?.resultingOutcome === "PAY" ? approval : null;
  return HistoryEntrySchema.parse({
    invoiceId: invoice.id,
    fileHash: invoice.fileHash,
    payee: payee.isUncertain ? null : payee.value,
    reference: reference.isUncertain ? null : reference.value,
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    status,
    period: approvedPayment === null ? decisionPeriod : approvalPeriod,
    decidedAt: approvedPayment === null ? decision.decidedAt : approvedPayment.resolvedAt,
  });
}
