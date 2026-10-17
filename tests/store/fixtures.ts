import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { Decision } from "@/contracts/decision";
import type { Invoice } from "@/contracts/invoice";
import { type Executor, openDb, withWriteTransaction } from "@/store/db";
import { insertDecision } from "@/store/decision-repository";
import { insertInvoice } from "@/store/invoice-repository";
import { buildInvoice } from "../engine/fixtures";

export function openMemoryDb(): Promise<Client> {
  return openDb(":memory:");
}

// A real file, for tests that need two connections at once (concurrent requests).
export function openTempFileDb(): Promise<Client> {
  const directory = mkdtempSync(path.join(tmpdir(), "triple-firma-"));
  return openDb(`file:${path.join(directory, "test.db")}`);
}

// An invoice with its own id and file hash, so several can be stored side by side.
export function buildStoredInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  const fileHash = createHash("sha256").update(id).digest("hex");
  return buildInvoice({ id, fileHash, ...overrides });
}

// Stores an invoice and its decision directly, without the engine, so tests control every outcome.
export async function storeDecision(
  db: Client,
  invoice: Invoice,
  decision: Decision,
  period = "2026-10",
): Promise<void> {
  await withWriteTransaction(db, async (tx) => {
    await insertInvoice(tx, {
      invoice,
      fileName: `dev/${invoice.id}.pdf`,
      fileBytes: new Uint8Array([37, 80, 68, 70]),
      extractionFailure: null,
    });
    await insertDecision(tx, decision, period);
  });
}

export async function countAuditEntries(db: Executor): Promise<number> {
  const { rows } = await db.execute("SELECT count(*) AS n FROM audit_entries");
  return Number(rows[0]?.n);
}
