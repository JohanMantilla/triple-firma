import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { ExtractionSchema } from "./extraction";

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Must be a lowercase SHA-256 hex digest");

export const SourceFormatSchema = z.enum(["PDF", "IMAGE", "EMAIL", "CHAT"]);
export type SourceFormat = z.infer<typeof SourceFormatSchema>;

const TEXT_SOURCE_FORMATS: readonly SourceFormat[] = ["EMAIL", "CHAT"];

// sourceText is the original text read straight from the file, never written by the LLM, so R10 can
// scan it deterministically even if a prompt injection hides itself from the reader's suspiciousText.
// It is mandatory for emails and chats; PDFs and images may leave it null.
export const InvoiceSchema = z
  .object({
    id: z.string().min(1),
    fileHash: Sha256Schema,
    sourceFormat: SourceFormatSchema,
    sourceText: z.string().max(200_000).nullable(),
    receivedAt: IsoDateTimeSchema,
    extraction: ExtractionSchema,
  })
  .refine(
    (invoice) => !TEXT_SOURCE_FORMATS.includes(invoice.sourceFormat) || invoice.sourceText !== null,
    { message: "Emails and chats must include their source text", path: ["sourceText"] },
  );
export type Invoice = z.infer<typeof InvoiceSchema>;
