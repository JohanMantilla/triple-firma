import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { extractInvoice } from "@/extraction/extract-invoice";
import { processInvoiceSet, readCompanyConfig } from "@/pipeline/dataset";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { listDecisionRecords } from "@/store/decision-repository";
import { buildExtraction, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb } from "../store/fixtures";

vi.mock("@/extraction/extract-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/extraction/extract-invoice")>()),
  extractInvoice: vi.fn(),
}));

const extractMock = vi.mocked(extractInvoice);

// A data directory like data/ with one invoice set holding the given files.
function buildDataDir(files: Record<string, string>): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
  const setDir = path.join(dataDir, "invoices", "dev");
  mkdirSync(setDir, { recursive: true });
  for (const [name, content] of Object.entries(files))
    writeFileSync(path.join(setDir, name), content);
  return dataDir;
}

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

describe("processInvoiceSet", () => {
  it("processes a set in file name order, one file at a time, skipping other files", async () => {
    const dataDir = buildDataDir({
      "b-second.txt": "chat b",
      "a-first.txt": "chat a",
      ".gitkeep": "",
      "notes.md": "not an invoice",
    });

    const results = await processInvoiceSet(db, "dev", NOW, dataDir);

    expect(results.map((item) => item.fileName)).toEqual(["dev/a-first.txt", "dev/b-second.txt"]);
    expect(extractMock.mock.calls.map(([input]) => input.sourceText)).toEqual(["chat a", "chat b"]);
  });

  it("returns the first file's record for a byte-identical copy in the set", async () => {
    const dataDir = buildDataDir({ "a-original.txt": "same bytes", "b-copy.txt": "same bytes" });

    const [original, copy] = await processInvoiceSet(db, "dev", NOW, dataDir);

    expect(original?.result).toMatchObject({ ok: true, isResubmission: false });
    expect(copy?.result).toMatchObject({
      ok: true,
      isResubmission: true,
      record: { fileName: "dev/a-original.txt" },
    });
    expect(await listDecisionRecords(db)).toHaveLength(1);
  });
});

describe("readCompanyConfig", () => {
  it("reads and validates data/config/company.json", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
    mkdirSync(path.join(dataDir, "config"));
    writeFileSync(path.join(dataDir, "config", "company.json"), JSON.stringify(buildRulesConfig()));
    expect(await readCompanyConfig(dataDir)).toEqual(buildRulesConfig());
  });

  it("rejects an invalid company config", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
    mkdirSync(path.join(dataDir, "config"));
    writeFileSync(
      path.join(dataDir, "config", "company.json"),
      JSON.stringify({ baseCurrency: "USD" }),
    );
    await expect(readCompanyConfig(dataDir)).rejects.toThrow();
  });
});
