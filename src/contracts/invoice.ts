import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { ExtractionSchema } from "./extraction";

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Must be a lowercase SHA-256 hex digest");

export const SourceFormatSchema = z.enum(["PDF", "IMAGE", "EMAIL", "CHAT"]);
export type SourceFormat = z.infer<typeof SourceFormatSchema>;

export const InvoiceSchema = z.object({
  id: z.string().min(1),
  fileHash: Sha256Schema,
  sourceFormat: SourceFormatSchema,
  receivedAt: IsoDateTimeSchema,
  extraction: ExtractionSchema,
});
export type Invoice = z.infer<typeof InvoiceSchema>;
