import { z } from "zod";
import { IsoDateSchema } from "./dates";
import { CurrencyCodeSchema, MinorAmountSchema, PositiveMinorAmountSchema } from "./money";
import { PayeeNameSchema } from "./payee";
import { ReferenceSchema } from "./reference";

// Every extracted field keeps what the document said, where it said it and whether the reader was sure.
export function extractedFieldSchema<T extends z.ZodType>(value: T) {
  return z.object({
    raw: z.string().nullable(),
    value: value.nullable(),
    evidence: z.string().nullable(),
    isUncertain: z.boolean(),
  });
}

// A zero or negative amount is not a valid value: the reader leaves it null and uncertain, so R1 escalates.
// issueDate is when the invoice was issued: R4 checks the agreement was in force on that date.
// lineItemsSumMinor is the sum of the line items before tax and taxMinor the tax printed on the invoice,
// copied and never computed; R10 checks that together they equal the amount. taxMinor may be absent
// while the reader does not extract it yet: absent or null means no tax was read.
export const ExtractionSchema = z.object({
  payee: extractedFieldSchema(PayeeNameSchema),
  amountMinor: extractedFieldSchema(PositiveMinorAmountSchema),
  currency: extractedFieldSchema(CurrencyCodeSchema),
  issueDate: extractedFieldSchema(IsoDateSchema),
  dueDate: extractedFieldSchema(IsoDateSchema),
  reference: extractedFieldSchema(ReferenceSchema),
  lineItemsSumMinor: MinorAmountSchema.nullable(),
  taxMinor: MinorAmountSchema.nullable().optional(),
  suspiciousText: z.array(z.string()),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
