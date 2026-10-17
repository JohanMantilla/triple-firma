import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { findInvoiceFile, insertInvoice } from "@/store/invoice-repository";
import { buildStoredInvoice, openMemoryDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("invoice files", () => {
  it("returns the original bytes, name and format of a stored invoice", async () => {
    const invoice = buildStoredInvoice("inv-1");
    const fileBytes = Buffer.from("%PDF-1.4 factura");
    await insertInvoice(db, {
      invoice,
      fileName: "dev/01.pdf",
      fileBytes,
      extractionFailure: null,
    });
    const file = await findInvoiceFile(db, "inv-1");
    expect(file?.fileName).toBe("dev/01.pdf");
    expect(file?.sourceFormat).toBe("PDF");
    expect(Buffer.from(file?.fileBytes ?? []).toString()).toBe("%PDF-1.4 factura");
  });

  it("returns null for an unknown invoice", async () => {
    expect(await findInvoiceFile(db, "inv-missing")).toBeNull();
  });

  it("rejects a second invoice with the same file hash", async () => {
    const stored = {
      fileName: "dev/01.pdf",
      fileBytes: new Uint8Array([1]),
      extractionFailure: null,
    };
    await insertInvoice(db, { ...stored, invoice: buildStoredInvoice("inv-1") });
    const copy = buildStoredInvoice("inv-2", { fileHash: buildStoredInvoice("inv-1").fileHash });
    await expect(insertInvoice(db, { ...stored, invoice: copy })).rejects.toThrow();
  });
});
