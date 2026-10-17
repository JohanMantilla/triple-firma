import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractionSchema } from "@/contracts/extraction";
import type { AnthropicClient } from "@/extraction/anthropic-client";
import {
  extractInvoice,
  makeUncertainExtraction,
  type ExtractInvoiceInput,
} from "@/extraction/extract-invoice";
import type { ReaderField, ReaderResponse } from "@/extraction/reader";

function field(raw: string, value: string = raw): ReaderField {
  return { raw, value, evidence: raw, isUncertain: false };
}

const READER_RESPONSE: ReaderResponse = {
  payee: field("Dev Partners SAS"),
  amountString: field("USD 2,500.00", "2500.00"),
  currencyRaw: field("USD"),
  dueDateString: field("Oct 30, 2026", "2026-10-30"),
  reference: field("INV-102"),
  lineItemsSumString: null,
  suspiciousText: [],
};

const INPUT: ExtractInvoiceInput = {
  fileHash: "a".repeat(64),
  fileBuffer: Buffer.from("%PDF-1.4 fake content"),
  sourceFormat: "PDF",
  sourceText: null,
};

function textResponse(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}

function makeClient(create: ReturnType<typeof vi.fn>): AnthropicClient {
  return { messages: { create } } as unknown as AnthropicClient;
}

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "extract-invoice-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("extractInvoice — success", () => {
  it("reads, normalizes and caches a new invoice", async () => {
    const create = vi.fn().mockResolvedValue(textResponse(JSON.stringify(READER_RESPONSE)));
    const result = await extractInvoice(INPUT, { client: makeClient(create), cacheDir });

    expect(result).toMatchObject({ ok: true, cached: false });
    expect(result.extraction.amountMinor.value).toBe(250000);
    expect(result.extraction.dueDate.value).toBe("2026-10-30");
    expect(await readdir(cacheDir)).toEqual([`${INPUT.fileHash}.json`]);
  });

  it("serves the same file from the cache without calling the API again", async () => {
    const create = vi.fn().mockResolvedValue(textResponse(JSON.stringify(READER_RESPONSE)));
    const client = makeClient(create);
    const first = await extractInvoice(INPUT, { client, cacheDir });
    const second = await extractInvoice(INPUT, { client, cacheDir });

    expect(second).toMatchObject({ ok: true, cached: true });
    expect(second.extraction).toEqual(first.extraction);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("needs no client at all when the file is cached", async () => {
    const create = vi.fn().mockResolvedValue(textResponse(JSON.stringify(READER_RESPONSE)));
    await extractInvoice(INPUT, { client: makeClient(create), cacheDir });
    const result = await extractInvoice(INPUT, { cacheDir });
    expect(result).toMatchObject({ ok: true, cached: true });
  });

  it("retries once when the first read fails", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("API timeout"))
      .mockResolvedValueOnce(textResponse(JSON.stringify(READER_RESPONSE)));
    const result = await extractInvoice(INPUT, { client: makeClient(create), cacheDir });

    expect(result).toMatchObject({ ok: true, cached: false });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps uncertain fields from the normalizer and caches them", async () => {
    const response = { ...READER_RESPONSE, currencyRaw: field("$") };
    const create = vi.fn().mockResolvedValue(textResponse(JSON.stringify(response)));
    const result = await extractInvoice(INPUT, { client: makeClient(create), cacheDir });

    expect(result.ok).toBe(true);
    expect(result.extraction.currency).toMatchObject({ value: null, isUncertain: true });
    expect(await readdir(cacheDir)).toHaveLength(1);
  });
});

describe("extractInvoice — fail-safe", () => {
  it("returns an all-uncertain extraction when the API keeps failing", async () => {
    const create = vi.fn().mockRejectedValue(new Error("API timeout"));
    const result = await extractInvoice(INPUT, { client: makeClient(create), cacheDir });

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining("API timeout") });
    expect(result.extraction).toEqual(makeUncertainExtraction());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns an all-uncertain extraction when the output is invalid twice", async () => {
    const create = vi.fn().mockResolvedValue(textResponse("not valid json {{{"));
    const result = await extractInvoice(INPUT, { client: makeClient(create), cacheDir });

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/Reader error/) });
    expect(result.extraction).toEqual(makeUncertainExtraction());
  });

  it("does not cache a failed extraction", async () => {
    const create = vi.fn().mockRejectedValue(new Error("API timeout"));
    await extractInvoice(INPUT, { client: makeClient(create), cacheDir });
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it("returns an uncertain extraction instead of throwing on an invalid file hash", async () => {
    const create = vi.fn();
    const result = await extractInvoice(
      { ...INPUT, fileHash: "../secret" },
      { client: makeClient(create), cacheDir },
    );

    expect(result.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns an uncertain extraction when the cache cannot be written", async () => {
    const blockedDir = path.join(cacheDir, "blocked");
    await writeFile(blockedDir, "a file where the directory should be");
    const create = vi.fn().mockResolvedValue(textResponse(JSON.stringify(READER_RESPONSE)));
    const result = await extractInvoice(INPUT, {
      client: makeClient(create),
      cacheDir: blockedDir,
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/Extraction error/) });
  });
});

describe("makeUncertainExtraction", () => {
  it("is a valid Extraction with every field null and uncertain", () => {
    const extraction = makeUncertainExtraction();
    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    for (const key of ["payee", "amountMinor", "currency", "dueDate", "reference"] as const) {
      expect(extraction[key]).toEqual({
        raw: null,
        value: null,
        evidence: null,
        isUncertain: true,
      });
    }
  });
});
