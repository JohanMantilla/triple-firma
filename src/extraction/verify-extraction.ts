import type { Extraction } from "@/contracts/extraction";
import { normalizePayee } from "@/contracts/payee";
import { normalizeReference } from "@/contracts/reference";
import { VERIFIER_MODEL, type AnthropicClient } from "./anthropic-client";
import type { ExtractInvoiceInput } from "./extract-invoice";
import { normalizeExtraction } from "./normalize-extraction";
import { VERIFIER_SYSTEM_PROMPT_V1 } from "./prompts/verifier-v1";
import { readDocument } from "./reader";

// The fields the rules engine decides on. If the second read disagrees on any of them, the field is
// marked uncertain and R1 escalates the invoice to a person.
export const VERIFIED_FIELDS = [
  "payee",
  "amountMinor",
  "currency",
  "issueDate",
  "dueDate",
  "reference",
] as const;
export type VerifiedField = (typeof VERIFIED_FIELDS)[number];

export type VerificationResult = {
  extraction: Extraction;
  mismatchedFields: VerifiedField[];
  // Set when the second read failed. Every verified field is then uncertain: unchecked is not trusted.
  verifierError: string | null;
};

// Fields are compared the way the engine compares them, so "Corp." and "Corp" agree.
const COMPARE_KEY: Record<VerifiedField, (value: string | number) => string | number> = {
  payee: (value) => normalizePayee(String(value)),
  reference: (value) => normalizeReference(String(value)),
  amountMinor: (value) => value,
  currency: (value) => value,
  issueDate: (value) => value,
  dueDate: (value) => value,
};

function agrees(field: VerifiedField, first: Extraction, second: Extraction): boolean {
  const a = first[field].value;
  const b = second[field].value;
  if (a === null || b === null) return a === b;
  return COMPARE_KEY[field](a) === COMPARE_KEY[field](b);
}

function markUncertain(extraction: Extraction, fields: readonly VerifiedField[]): Extraction {
  const flag = <T extends { isUncertain: boolean }>(field: T, name: VerifiedField): T =>
    fields.includes(name) ? { ...field, isUncertain: true } : field;
  return {
    ...extraction,
    payee: flag(extraction.payee, "payee"),
    amountMinor: flag(extraction.amountMinor, "amountMinor"),
    currency: flag(extraction.currency, "currency"),
    issueDate: flag(extraction.issueDate, "issueDate"),
    dueDate: flag(extraction.dueDate, "dueDate"),
    reference: flag(extraction.reference, "reference"),
  };
}

// Reads the document again with the verifier model and prompt, without showing it the first reading,
// and compares the two. Never throws: a failed second read makes every verified field uncertain.
export async function verifyExtraction(
  client: AnthropicClient,
  input: ExtractInvoiceInput,
  extraction: Extraction,
): Promise<VerificationResult> {
  const config = { model: VERIFIER_MODEL, systemPrompt: VERIFIER_SYSTEM_PROMPT_V1 };
  const read = await readDocument(
    client,
    config,
    input.fileBuffer,
    input.sourceFormat,
    input.sourceText,
  );
  if (!read.ok) {
    return {
      extraction: markUncertain(extraction, VERIFIED_FIELDS),
      mismatchedFields: [],
      verifierError: read.reason,
    };
  }

  const second = normalizeExtraction(read.response);
  const mismatchedFields = VERIFIED_FIELDS.filter((field) => !agrees(field, extraction, second));
  return {
    extraction: markUncertain(extraction, mismatchedFields),
    mismatchedFields,
    verifierError: null,
  };
}
