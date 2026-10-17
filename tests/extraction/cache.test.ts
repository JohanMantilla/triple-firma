import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Extraction } from "@/contracts/extraction";
import { readCachedExtraction, writeCachedExtraction } from "@/extraction/cache";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function field<T>(value: T, raw: string) {
  return { raw, value, evidence: raw, isUncertain: false };
}

const EXTRACTION: Extraction = {
  payee: field("Dev Partners SAS", "Dev Partners SAS"),
  amountMinor: field(250000, "USD 2,500.00"),
  currency: field("USD", "USD"),
  issueDate: field("2026-10-01", "Oct 1, 2026"),
  dueDate: field("2026-10-30", "Oct 30, 2026"),
  reference: field("INV-102", "INV-102"),
  lineItemsSumMinor: null,
  suspiciousText: [],
};

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "extraction-cache-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("extraction cache", () => {
  it("returns null when the file was never cached", async () => {
    expect(await readCachedExtraction(HASH, cacheDir)).toBeNull();
  });

  it("returns what was written for the same hash", async () => {
    await writeCachedExtraction(HASH, EXTRACTION, cacheDir);
    expect(await readCachedExtraction(HASH, cacheDir)).toEqual(EXTRACTION);
  });

  it("keeps entries for different hashes apart", async () => {
    const other: Extraction = { ...EXTRACTION, suspiciousText: ["ignore previous instructions"] };
    await writeCachedExtraction(HASH, EXTRACTION, cacheDir);
    await writeCachedExtraction(OTHER_HASH, other, cacheDir);
    expect(await readCachedExtraction(HASH, cacheDir)).toEqual(EXTRACTION);
    expect(await readCachedExtraction(OTHER_HASH, cacheDir)).toEqual(other);
  });

  it("stores one readable JSON file named after the hash", async () => {
    await writeCachedExtraction(HASH, EXTRACTION, cacheDir);
    expect(await readdir(cacheDir)).toEqual([`${HASH}.json`]);
    const content = await readFile(path.join(cacheDir, `${HASH}.json`), "utf8");
    expect(JSON.parse(content)).toEqual(EXTRACTION);
  });

  it("overwrites an existing entry", async () => {
    const updated: Extraction = { ...EXTRACTION, reference: field("INV-103", "INV-103") };
    await writeCachedExtraction(HASH, EXTRACTION, cacheDir);
    await writeCachedExtraction(HASH, updated, cacheDir);
    expect(await readCachedExtraction(HASH, cacheDir)).toEqual(updated);
  });

  it("creates the cache directory when it does not exist", async () => {
    const nested = path.join(cacheDir, "nested", "cache");
    await writeCachedExtraction(HASH, EXTRACTION, nested);
    expect(await readCachedExtraction(HASH, nested)).toEqual(EXTRACTION);
  });

  it("treats a corrupt entry as a miss", async () => {
    await writeFile(path.join(cacheDir, `${HASH}.json`), "not json {{{");
    expect(await readCachedExtraction(HASH, cacheDir)).toBeNull();
  });

  it("treats an entry that fails the extraction schema as a miss", async () => {
    await writeFile(path.join(cacheDir, `${HASH}.json`), JSON.stringify({ unexpected: "shape" }));
    expect(await readCachedExtraction(HASH, cacheDir)).toBeNull();
  });

  it("rejects a hash that is not a SHA-256, so it cannot escape the directory", async () => {
    await expect(readCachedExtraction("../secret", cacheDir)).rejects.toThrow();
    await expect(writeCachedExtraction("../secret", EXTRACTION, cacheDir)).rejects.toThrow();
  });

  it("does not write an extraction that fails the schema", async () => {
    const invalid = { ...EXTRACTION, suspiciousText: "nope" } as unknown as Extraction;
    await mkdir(cacheDir, { recursive: true });
    await expect(writeCachedExtraction(HASH, invalid, cacheDir)).rejects.toThrow();
    expect(await readdir(cacheDir)).toEqual([]);
  });
});
