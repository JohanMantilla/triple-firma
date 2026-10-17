import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { extractInvoice, makeUncertainExtraction } from "@/extraction/extract-invoice";
import { detectSourceFormat, processInvoice } from "@/pipeline/process-invoice";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { insertApproval } from "@/store/approval-repository";
import { listDecisionRecords } from "@/store/decision-repository";
import { buildApproval, buildExtraction, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb, openTempFileDb } from "../store/fixtures";

vi.mock("@/extraction/extract-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/extraction/extract-invoice")>()),
  extractInvoice: vi.fn(),
}));

const extractMock = vi.mocked(extractInvoice);
const PDF = {
  fileName: "dev/01-invoice.pdf",
  fileBuffer: Buffer.from("%PDF-1.4 factura 01"),
  sourceFormat: "PDF" as const,
};

let db: Client;
beforeEach(async () => {
  extractMock.mockReset();
  extractMock.mockResolvedValue({
    ok: true,
    extraction: buildExtraction(),
    cached: true,
    verification: null,
  });
  db = await openMemoryDb();
  await saveRulesConfig(db, buildRulesConfig(), NOW);
});

describe("processInvoice", () => {
  it("decides a new invoice and records it with one audit entry", async () => {
    const result = await processInvoice(db, PDF, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.isResubmission).toBe(false);
    expect(result.record).toMatchObject({
      fileName: "dev/01-invoice.pdf",
      approval: null,
      extractionFailure: null,
    });
    expect(result.record.invoice.receivedAt).toBe(NOW);
    expect(result.record.decision.ruleResults).toHaveLength(10);
    expect(await countAuditEntries(db)).toBe(2); // the rules config, then the decision
  });

  it("returns the same record for the same file without deciding again", async () => {
    const first = await processInvoice(db, PDF, NOW);
    const second = await processInvoice(db, { ...PDF, fileName: "dev/02-resend.pdf" }, NOW);

    if (!first.ok || !second.ok) throw new Error("both uploads should succeed");
    expect(second.isResubmission).toBe(true);
    expect(second.record.decision.id).toBe(first.record.decision.id);
    expect(second.record.fileName).toBe("dev/01-invoice.pdf");
    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(await countAuditEntries(db)).toBe(2);
  });

  it("stores the extraction failure and never pays an unreadable invoice", async () => {
    extractMock.mockResolvedValue({
      ok: false,
      extraction: makeUncertainExtraction(),
      reason: "Reader error: timeout",
    });
    const result = await processInvoice(db, PDF, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.extractionFailure).toBe("Reader error: timeout");
    expect(result.record.decision.outcome).not.toBe("PAY");
  });

  it("refuses to decide without a rules config and stores nothing", async () => {
    const empty = await openMemoryDb();
    expect(await processInvoice(empty, PDF, NOW)).toEqual({ ok: false, reason: "NO_RULES_CONFIG" });
    expect(await listDecisionRecords(empty)).toEqual([]);
    expect(await countAuditEntries(empty)).toBe(0);
  });

  it("passes the original text of emails and chats to the reader", async () => {
    const chat = {
      fileName: "dev/03-chat.txt",
      fileBuffer: Buffer.from("[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00"),
      sourceFormat: "CHAT" as const,
    };
    const result = await processInvoice(db, chat, NOW);

    expect(extractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFormat: "CHAT",
        sourceText: "[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00",
      }),
    );
    expect(result.ok && result.record.invoice.sourceText).toBe(
      "[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00",
    );
  });

  it("rejects an empty email or chat before calling the reader", async () => {
    const blank = {
      fileName: "dev/04.txt",
      fileBuffer: Buffer.from(" \n "),
      sourceFormat: "CHAT" as const,
    };
    expect(await processInvoice(db, blank, NOW)).toEqual({
      ok: false,
      reason: "EMPTY_SOURCE_TEXT",
    });
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects a text longer than the invoice contract allows", async () => {
    const long = {
      fileName: "dev/05.txt",
      fileBuffer: Buffer.from("a".repeat(200_001)),
      sourceFormat: "CHAT" as const,
    };
    expect(await processInvoice(db, long, NOW)).toEqual({
      ok: false,
      reason: "SOURCE_TEXT_TOO_LONG",
    });
  });

  it("still catches a clean copy of an approved invoice whose payee and reference were uncertain", async () => {
    const uncertain = buildExtraction();
    uncertain.payee.isUncertain = true;
    uncertain.reference.isUncertain = true;
    extractMock.mockResolvedValueOnce({
      ok: true,
      extraction: uncertain,
      cached: true,
      verification: null,
    });
    const first = await processInvoice(db, PDF, NOW);
    if (!first.ok) throw new Error(first.reason);
    expect(first.record.status).toBe("PENDING_APPROVAL");
    await insertApproval(db, buildApproval(first.record.decision, "APPROVED"), "2026-10");

    const copy = { ...PDF, fileBuffer: Buffer.from("%PDF-1.4 clean copy") };
    const second = await processInvoice(db, copy, NOW);
    if (!second.ok) throw new Error(second.reason);
    const duplicate = second.record.decision.ruleResults.find(({ ruleId }) => ruleId === "R2");
    expect(duplicate?.outcome).not.toBe("PASS");
  });

  it("decides a file uploaded twice at the same time only once", async () => {
    const fileDb = await openTempFileDb();
    await saveRulesConfig(fileDb, buildRulesConfig(), NOW);

    const results = await Promise.all([
      processInvoice(fileDb, PDF, NOW),
      processInvoice(fileDb, PDF, NOW),
    ]);

    expect(results.map((result) => result.ok && result.isResubmission).sort()).toEqual([
      false,
      true,
    ]);
    expect(await listDecisionRecords(fileDb)).toHaveLength(1);
  });
});

describe("detectSourceFormat", () => {
  it.each([
    ["factura.pdf", "PDF"],
    ["SCAN.PDF", "PDF"],
    ["foto.jpeg", "IMAGE"],
    ["foto.PNG", "IMAGE"],
    ["correo.eml", "EMAIL"],
    ["chat.txt", "CHAT"],
    ["notas.md", null],
    ["README", null],
    [".gitkeep", null],
    ["x.constructor", null],
  ])("%s is %s", (fileName, sourceFormat) => {
    expect(detectSourceFormat(fileName)).toBe(sourceFormat);
  });
});
