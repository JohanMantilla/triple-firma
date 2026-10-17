import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { DecisionRecord } from "@/contracts/decision-record";
import { InvoiceSchema, type SourceFormat } from "@/contracts/invoice";
import { evaluateRules } from "@/engine/evaluate-rules";
import { toPeriod } from "@/engine/rule-context";
import { extractInvoice } from "@/extraction/extract-invoice";
import { appendAuditEntry } from "@/store/audit-log";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";
import {
  findDecisionByFileHash,
  findDecisionRecord,
  insertDecision,
  listHistoryEntries,
} from "@/store/decision-repository";
import { insertInvoice } from "@/store/invoice-repository";

export type InvoiceUpload = { fileName: string; fileBuffer: Buffer; sourceFormat: SourceFormat };

export type ProcessInvoiceResult =
  | { ok: true; record: DecisionRecord; isResubmission: boolean }
  | { ok: false; reason: "NO_RULES_CONFIG" | "EMPTY_SOURCE_TEXT" | "SOURCE_TEXT_TOO_LONG" };

const SOURCE_FORMATS_BY_EXTENSION = new Map<string, SourceFormat>([
  [".pdf", "PDF"],
  [".png", "IMAGE"],
  [".jpg", "IMAGE"],
  [".jpeg", "IMAGE"],
  [".webp", "IMAGE"],
  [".gif", "IMAGE"],
  [".eml", "EMAIL"],
  [".txt", "CHAT"],
]);
const TEXT_FORMATS: readonly SourceFormat[] = ["EMAIL", "CHAT"];
const MAX_SOURCE_TEXT_LENGTH = 200_000; // InvoiceSchema's limit for sourceText

// By extension only: emails are .eml and chats are .txt (agreed with C). A Map, so a name such as
// "x.constructor" can never match an Object prototype key.
export function detectSourceFormat(fileName: string): SourceFormat | null {
  return SOURCE_FORMATS_BY_EXTENSION.get(path.extname(fileName).toLowerCase()) ?? null;
}

// hash → extraction (B) → engine (A) → decision and audit entry. The same file twice returns its first
// record, so a resubmission can never become a second payment.
export async function processInvoice(
  db: Client,
  upload: InvoiceUpload,
  now: string,
): Promise<ProcessInvoiceResult> {
  const fileHash = createHash("sha256").update(upload.fileBuffer).digest("hex");
  const previous = await findDecisionByFileHash(db, fileHash);
  if (previous !== null) return { ok: true, record: previous, isResubmission: true };

  // ponytail: .eml is read as raw text, without MIME decoding; decode it if real emails arrive.
  const sourceText = TEXT_FORMATS.includes(upload.sourceFormat)
    ? upload.fileBuffer.toString("utf8")
    : null;
  if (sourceText !== null && sourceText.trim() === "")
    return { ok: false, reason: "EMPTY_SOURCE_TEXT" };
  if (sourceText !== null && sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    return { ok: false, reason: "SOURCE_TEXT_TOO_LONG" };
  }

  // The LLM call runs before the transaction: a slow read must never hold the database write lock.
  const extracted = await extractInvoice({
    fileHash,
    fileBuffer: upload.fileBuffer,
    sourceFormat: upload.sourceFormat,
    sourceText,
  });
  const invoice = InvoiceSchema.parse({
    id: randomUUID(),
    fileHash,
    sourceFormat: upload.sourceFormat,
    sourceText,
    receivedAt: now,
    extraction: extracted.extraction,
  });
  const extractionFailure = extracted.ok ? null : extracted.reason;

  return withWriteTransaction<ProcessInvoiceResult>(db, async (tx) => {
    // Checked again inside the lock: two uploads of the same file at once end with one decision.
    const concurrent = await findDecisionByFileHash(tx, fileHash);
    if (concurrent !== null) return { ok: true, record: concurrent, isResubmission: true };

    const current = await findCurrentRulesConfig(tx);
    if (current === null) return { ok: false, reason: "NO_RULES_CONFIG" };

    // Config and history are read in the same write transaction that stores the decision, so two
    // invoices processed at once can never both spend the same remaining budget.
    const history = await listHistoryEntries(tx);
    const decision = evaluateRules({
      invoice,
      config: current.config,
      history,
      now,
      configVersion: current.version,
    });
    await insertInvoice(tx, {
      invoice,
      fileName: upload.fileName,
      fileBytes: upload.fileBuffer,
      extractionFailure,
    });
    await insertDecision(tx, decision, toPeriod(now, current.config.timezone));
    await appendAuditEntry(
      tx,
      "DECISION",
      {
        invoiceId: invoice.id,
        fileHash,
        fileName: upload.fileName,
        sourceFormat: invoice.sourceFormat,
        extraction: invoice.extraction,
        extractionFailure,
        decision,
      },
      now,
    );

    const record = await findDecisionRecord(tx, decision.id);
    if (record === null) throw new Error(`Decision ${decision.id} was not stored`);
    return { ok: true, record, isResubmission: false };
  });
}
