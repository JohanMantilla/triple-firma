/**
 * npm run compare:prompts
 *
 * Reads every dev and adversarial invoice with four configurations and scores each against
 * data/extraction-truth.json, field by field: reader prompt v1, v2, and each of them followed by the
 * independent verifier. It calls the extraction modules directly (not extractInvoice) because
 * extractInvoice has no prompt version option and its cache would hide the differences.
 *
 * Needs ANTHROPIC_API_KEY (npm run compare:prompts loads .env.local). Responses are kept in a temp
 * directory keyed by the exact request, so a second run costs nothing unless a prompt or file changed.
 *
 * Options:
 *   --partition dev,adversarial   (default). holdout is sealed and is rejected.
 *   --only dev/dev-01.pdf,...     only these files
 *   --fresh                       ignore the stored responses and call the API again
 *   --out <path>                  also write the Markdown report to this file
 *
 * Exit code: 0 = done, 2 = bad usage or missing key.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Extraction } from "@/contracts/extraction";
import type { SourceFormat } from "@/contracts/invoice";
import { makeAnthropicClient, type AnthropicClient } from "@/extraction/anthropic-client";
import { makeUncertainExtraction } from "@/extraction/extract-invoice";
import type { ExtractInvoiceInput } from "@/extraction/extract-invoice-input";
import { normalizeExtraction } from "@/extraction/normalize-extraction";
import { readInvoice, type ReaderPromptVersion } from "@/extraction/reader";
import { verifyExtraction } from "@/extraction/verify-extraction";
import { detectSourceFormat } from "@/pipeline/process-invoice";
import {
  renderMarkdown,
  scoreExtraction,
  summarizeVariant,
  type FileScore,
  type TruthEntry,
} from "./compare-prompts-lib";

const DATA_DIR = resolve("data");
const ALLOWED_PARTITIONS = ["dev", "adversarial"] as const;
const VARIANTS = ["v1", "v2", "v1+verify", "v2+verify"] as const;
type Variant = (typeof VARIANTS)[number];
const CONCURRENCY = 4;
const TEXT_FORMATS: readonly SourceFormat[] = ["EMAIL", "CHAT"];

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(token.slice(2), next);
      i++;
    } else {
      flags.add(token.slice(2));
    }
  }
  const partitions = (values.get("partition") ?? ALLOWED_PARTITIONS.join(",")).split(",");
  for (const partition of partitions) {
    if (!(ALLOWED_PARTITIONS as readonly string[]).includes(partition)) {
      fail(`Partition "${partition}" is not allowed. holdout is sealed; use dev and adversarial.`);
    }
  }
  return {
    partitions,
    only: values.get("only")?.split(",") ?? null,
    fresh: flags.has("fresh"),
    out: values.get("out") ?? null,
  };
}

// Stores each successful response under the hash of the request, so reruns are free.
function withDiskCache(client: AnthropicClient, dir: string, isFresh: boolean): AnthropicClient {
  mkdirSync(dir, { recursive: true });
  const create = async (params: unknown) => {
    const file = join(
      dir,
      `${createHash("sha256").update(JSON.stringify(params)).digest("hex")}.json`,
    );
    if (!isFresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as unknown;
    const response = await client.messages.create(params as never);
    // A response cut short would only fail the same way on a rerun, so it is not stored.
    if ("stop_reason" in response && response.stop_reason === "end_turn") {
      writeFileSync(file, JSON.stringify(response));
    }
    return response;
  };
  return { messages: { create } } as unknown as AnthropicClient;
}

type FileRun = Record<
  Variant,
  { extraction: Extraction; readFailed: boolean; verifierFailed: boolean }
>;

// One retry on a failed read, like extractInvoice does.
async function readExtraction(
  client: AnthropicClient,
  input: ExtractInvoiceInput,
  version: ReaderPromptVersion,
): Promise<Extraction | null> {
  const read = async () =>
    readInvoice(client, input.fileBuffer, input.sourceFormat, input.sourceText, version);
  const first = await read();
  const result = first.ok ? first : await read();
  if (!result.ok) console.error(`  read failed (${version}): ${result.reason}`);
  return result.ok ? normalizeExtraction(result.response) : null;
}

async function runFile(client: AnthropicClient, entry: TruthEntry): Promise<FileRun> {
  const fileBuffer = readFileSync(join(DATA_DIR, "invoices", entry.file));
  const sourceFormat = detectSourceFormat(entry.file);
  if (sourceFormat === null) fail(`Unknown file type: ${entry.file}`);
  const input: ExtractInvoiceInput = {
    fileHash: createHash("sha256").update(fileBuffer).digest("hex"),
    fileBuffer,
    sourceFormat,
    sourceText: TEXT_FORMATS.includes(sourceFormat) ? fileBuffer.toString("utf8") : null,
  };

  const run = {} as FileRun;
  for (const version of ["v1", "v2"] as const) {
    const read = await readExtraction(client, input, version);
    run[version] = {
      extraction: read ?? makeUncertainExtraction(),
      readFailed: read === null,
      verifierFailed: false,
    };
    const verified =
      read === null
        ? { extraction: makeUncertainExtraction(), verifierError: null }
        : await verifyExtraction(client, input, read);
    run[`${version}+verify`] = {
      extraction: verified.extraction,
      readFailed: read === null,
      verifierFailed: verified.verifierError !== null,
    };
  }
  return run;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) fail("ANTHROPIC_API_KEY is not set (see .env.local).");

  const truth = JSON.parse(
    readFileSync(join(DATA_DIR, "extraction-truth.json"), "utf8"),
  ) as TruthEntry[];
  const entries = truth.filter(
    (entry) =>
      args.partitions.some((partition) => entry.file.startsWith(`${partition}/`)) &&
      (args.only === null || args.only.includes(entry.file)),
  );
  if (entries.length === 0) fail("No invoice matches --partition / --only.");

  const client = withDiskCache(
    makeAnthropicClient(),
    join(tmpdir(), "compare-prompts-cache"),
    args.fresh,
  );
  let done = 0;
  const runs = await mapWithConcurrency(entries, CONCURRENCY, async (entry) => {
    const run = await runFile(client, entry);
    console.error(`[${++done}/${entries.length}] ${entry.file}`);
    return run;
  });

  const summaries = VARIANTS.map((variant) => {
    const scores: FileScore[] = entries.map((entry, i) =>
      scoreExtraction(entry, (runs[i] as FileRun)[variant].extraction),
    );
    return summarizeVariant(variant, scores, {
      readFailures: runs.filter((run) => run[variant].readFailed).length,
      verifierFailures: runs.filter((run) => run[variant].verifierFailed).length,
    });
  });

  const failedReads = summaries.reduce((sum, s) => sum + s.readFailures + s.verifierFailures, 0);
  if (failedReads > 0) {
    console.error(
      `\nWARNING: ${failedReads} reads failed. They count as uncertain fields, so do not trust this report.`,
    );
  }

  const report = renderMarkdown(summaries);
  console.log(report);
  if (args.out !== null) writeFileSync(resolve(args.out), `${report}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(2);
});
