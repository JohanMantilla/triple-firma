import type { Extraction } from "@/contracts/extraction";
import type { SourceFormat } from "@/contracts/invoice";
import { makeAnthropicClient, type AnthropicClient } from "./anthropic-client";
import { readCachedExtraction, writeCachedExtraction } from "./cache";
import { normalizeExtraction } from "./normalize-extraction";
import { readInvoice, type ReadResult } from "./reader";
import { verifyExtraction } from "./verify-extraction";

export type ExtractInvoiceInput = {
  fileHash: string;
  fileBuffer: Buffer;
  sourceFormat: SourceFormat;
  sourceText: string | null;
};

export type ExtractInvoiceOptions = {
  client?: AnthropicClient;
  cacheDir?: string;
  // Second, independent read with the verifier model; a disagreement makes the field uncertain.
  verify?: boolean;
};

// A failed result still carries an extraction, with every field uncertain, so the invoice always
// reaches the rules engine and R1 escalates it. `reason` is for the audit log.
export type ExtractionResult =
  | { ok: true; extraction: Extraction; cached: boolean }
  | { ok: false; extraction: Extraction; reason: string };

const UNCERTAIN_FIELD = { raw: null, value: null, evidence: null, isUncertain: true } as const;

export function makeUncertainExtraction(): Extraction {
  return {
    payee: UNCERTAIN_FIELD,
    amountMinor: UNCERTAIN_FIELD,
    currency: UNCERTAIN_FIELD,
    issueDate: UNCERTAIN_FIELD,
    dueDate: UNCERTAIN_FIELD,
    reference: UNCERTAIN_FIELD,
    lineItemsSumMinor: null,
    suspiciousText: [],
  };
}

// One retry on any failed read (invalid JSON, schema mismatch or API error). The SDK already retries
// rate limits and 5xx responses on its own.
async function readWithRetry(
  client: AnthropicClient,
  input: ExtractInvoiceInput,
): Promise<ReadResult> {
  const first = await readInvoice(client, input.fileBuffer, input.sourceFormat, input.sourceText);
  if (first.ok) return first;
  return readInvoice(client, input.fileBuffer, input.sourceFormat, input.sourceText);
}

// Cache first, so the demo runs offline. The client is created only on a cache miss, so a missing API
// key makes a new invoice uncertain instead of breaking cached ones. Nothing here throws: any failure
// is an uncertain extraction, and failures are never cached.
export async function extractInvoice(
  input: ExtractInvoiceInput,
  options: ExtractInvoiceOptions = {},
): Promise<ExtractionResult> {
  try {
    const cachedExtraction = await readCachedExtraction(input.fileHash, options.cacheDir);
    if (cachedExtraction) return { ok: true, extraction: cachedExtraction, cached: true };

    const client = options.client ?? makeAnthropicClient();
    const read = await readWithRetry(client, input);
    if (!read.ok) return { ok: false, extraction: makeUncertainExtraction(), reason: read.reason };

    const normalized = normalizeExtraction(read.response);
    const extraction = options.verify
      ? (await verifyExtraction(client, input, normalized)).extraction
      : normalized;
    await writeCachedExtraction(input.fileHash, extraction, options.cacheDir);
    return { ok: true, extraction, cached: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      extraction: makeUncertainExtraction(),
      reason: `Extraction error: ${reason}`,
    };
  }
}
