import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { ExpectedDecision } from "@/contracts/metrics";
import { type RulesConfig, RulesConfigSchema } from "@/contracts/rules-config";
import { parseExpectedCsv } from "./compute-metrics";
import { detectSourceFormat, processInvoice, type ProcessInvoiceResult } from "./process-invoice";

// The dataset's fixed clock, agreed with C. Demo, eval and CI decide every dataset invoice at this
// instant, so results never depend on the day they run. UI uploads use the real clock; keep this in
// the month of the presentation so both share one budget period.
export const DATASET_NOW = "2026-10-15T15:00:00Z";

export const INVOICE_SETS = ["dev", "adversarial", "holdout"] as const;
export type InvoiceSet = (typeof INVOICE_SETS)[number];

export const DATA_DIR = path.join(process.cwd(), "data");

export async function readCompanyConfig(dataDir = DATA_DIR): Promise<RulesConfig> {
  const text = await readFile(path.join(dataDir, "config", "company.json"), "utf8");
  return RulesConfigSchema.parse(JSON.parse(text));
}

// One file at a time, sorted by name: duplicates and the budget depend on the order. Files that are
// not invoices (.gitkeep, notes) are skipped.
export async function processInvoiceSet(
  db: Client,
  set: InvoiceSet,
  now: string,
  dataDir = DATA_DIR,
): Promise<{ fileName: string; result: ProcessInvoiceResult }[]> {
  const directory = path.join(dataDir, "invoices", set);
  const results: { fileName: string; result: ProcessInvoiceResult }[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const sourceFormat = detectSourceFormat(name);
    if (sourceFormat === null) continue;
    const fileName = `${set}/${name}`;
    const fileBuffer = await readFile(path.join(directory, name));
    results.push({
      fileName,
      result: await processInvoice(db, { fileName, fileBuffer, sourceFormat }, now),
    });
  }
  return results;
}

// data/expected.csv (C). A missing file only means there are no expected rows yet.
export async function readExpectedDecisions(dataDir = DATA_DIR): Promise<ExpectedDecision[]> {
  try {
    return parseExpectedCsv(await readFile(path.join(dataDir, "expected.csv"), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
