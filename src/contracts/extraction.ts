import { z } from "zod";
import { IsoDateSchema } from "./dates";
import { CurrencyCodeSchema } from "./money";

// Every extracted field keeps what the document said, where it said it and whether the reader was sure.
export function extractedFieldSchema<T extends z.ZodType>(value: T) {
  return z.object({
    raw: z.string().nullable(),
    value: value.nullable(),
    evidence: z.string().nullable(),
    isUncertain: z.boolean(),
  });
}

export const ExtractionSchema = z.object({
  payee: extractedFieldSchema(z.string().trim().min(1)),
  amountMinor: extractedFieldSchema(z.int()),
  currency: extractedFieldSchema(CurrencyCodeSchema),
  dueDate: extractedFieldSchema(IsoDateSchema),
  reference: extractedFieldSchema(z.string().trim().min(1)),
  lineItemsSumMinor: z.int().nullable(),
  suspiciousText: z.array(z.string()),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
