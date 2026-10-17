import { z } from "zod";
import type { SourceFormat } from "@/contracts/invoice";
import type { AnthropicClient } from "./anthropic-client";
import { READER_MODEL } from "./anthropic-client";
import { READER_SYSTEM_PROMPT_V1, READER_RESPONSE_JSON_SCHEMA } from "./prompts/reader-v1";

// ── Schema for the raw LLM response ─────────────────────────────────────────
// Values are strings here; the normalizer (normalize-extraction.ts) converts them to the
// typed values required by ExtractionSchema (minor units, ISO dates, etc.).

const ReaderFieldSchema = z.object({
  raw: z.string().nullable(),
  value: z.string().nullable(),
  evidence: z.string().nullable(),
  isUncertain: z.boolean(),
});
export type ReaderField = z.infer<typeof ReaderFieldSchema>;

export const ReaderResponseSchema = z.object({
  payee: ReaderFieldSchema,
  amountString: ReaderFieldSchema,
  currencyRaw: ReaderFieldSchema,
  issueDateString: ReaderFieldSchema,
  dueDateString: ReaderFieldSchema,
  reference: ReaderFieldSchema,
  lineItemsSumString: ReaderFieldSchema.nullable(),
  suspiciousText: z.array(z.string()),
});
export type ReaderResponse = z.infer<typeof ReaderResponseSchema>;

export type ReadResult = { ok: true; response: ReaderResponse } | { ok: false; reason: string };

// ── Content builder ──────────────────────────────────────────────────────────

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function detectImageMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  // WebP: "RIFF" at 0 + "WEBP" at 8
  if (buffer[0] === 0x52 && buffer[8] === 0x57) return "image/webp";
  return "image/jpeg"; // safe default
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

function buildContent(
  fileBuffer: Buffer,
  sourceFormat: SourceFormat,
  sourceText: string | null,
): ContentBlock[] {
  const instruction: ContentBlock = {
    type: "text",
    text: "Extract all invoice fields from the document and return the JSON object.",
  };

  if (sourceFormat === "PDF") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: fileBuffer.toString("base64"),
        },
      },
      instruction,
    ];
  }

  if (sourceFormat === "IMAGE") {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: detectImageMediaType(fileBuffer),
          data: fileBuffer.toString("base64"),
        },
      },
      instruction,
    ];
  }

  // EMAIL or CHAT: contracts guarantee sourceText is non-null and non-empty.
  return [{ type: "text", text: `Invoice content:\n\n${sourceText ?? ""}` }, instruction];
}

// ── Reader ───────────────────────────────────────────────────────────────────

export async function readInvoice(
  client: AnthropicClient,
  fileBuffer: Buffer,
  sourceFormat: SourceFormat,
  sourceText: string | null,
): Promise<ReadResult> {
  try {
    const message = await client.messages.create({
      model: READER_MODEL,
      max_tokens: 2048,
      system: READER_SYSTEM_PROMPT_V1,
      // Structured output guarantees a valid JSON object matching the schema.
      output_config: { format: { type: "json_schema", schema: READER_RESPONSE_JSON_SCHEMA } },
      messages: [{ role: "user", content: buildContent(fileBuffer, sourceFormat, sourceText) }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ok: false, reason: "LLM returned no text block" };
    }

    const parsed = ReaderResponseSchema.safeParse(JSON.parse(textBlock.text));
    if (!parsed.success) {
      return {
        ok: false,
        reason: `Reader response failed schema validation: ${parsed.error.message}`,
      };
    }

    return { ok: true, response: parsed.data };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Reader error: ${reason}` };
  }
}
