import {
  type Invoice,
  InvoiceSchema,
  type SourceFormat,
  SourceFormatSchema,
} from "@/contracts/invoice";
import type { Executor } from "./db";

export type StoredInvoiceFile = {
  fileName: string;
  sourceFormat: SourceFormat;
  fileBytes: Uint8Array<ArrayBuffer>;
};

export async function insertInvoice(
  db: Executor,
  stored: {
    invoice: Invoice;
    fileName: string;
    fileBytes: Uint8Array;
    extractionFailure: string | null;
  },
): Promise<void> {
  const invoice = InvoiceSchema.parse(stored.invoice);
  await db.execute({
    sql: `INSERT INTO invoices (id, file_hash, file_name, file_bytes, invoice_json, extraction_failure)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      invoice.id,
      invoice.fileHash,
      stored.fileName,
      stored.fileBytes,
      JSON.stringify(invoice),
      stored.extractionFailure,
    ],
  });
}

// The original file, for the document viewer.
export async function findInvoiceFile(
  db: Executor,
  invoiceId: string,
): Promise<StoredInvoiceFile | null> {
  const { rows } = await db.execute({
    sql: `SELECT file_name, file_bytes, json_extract(invoice_json, '$.sourceFormat') AS source_format
          FROM invoices WHERE id = ?`,
    args: [invoiceId],
  });
  const row = rows[0];
  if (row === undefined) return null;
  if (!(row.file_bytes instanceof ArrayBuffer)) {
    throw new Error(`Invoice ${invoiceId} has no stored file`);
  }
  return {
    fileName: String(row.file_name),
    sourceFormat: SourceFormatSchema.parse(row.source_format),
    fileBytes: new Uint8Array(row.file_bytes),
  };
}
