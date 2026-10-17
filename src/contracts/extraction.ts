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
// lineItemsSumMinor is the subtotal of the line items as printed and taxMinor the tax printed on the
// invoice, both copied and never computed. taxMinor may be absent while the reader does not extract it
// yet: absent or null means no tax was read.
// lineItemAmountsMinor is the amount of each line item exactly as printed, copied and never summed by
// the reader: R10 adds them up in code. A line whose amount cannot be read stays as null in its place,
// so one unreadable line never hides the breakdown; R10 escalates it. Absent or null: no lines read.
export const ExtractionSchema = z.object({
  payee: extractedFieldSchema(PayeeNameSchema),
  amountMinor: extractedFieldSchema(PositiveMinorAmountSchema),
  currency: extractedFieldSchema(CurrencyCodeSchema),
  issueDate: extractedFieldSchema(IsoDateSchema),
  dueDate: extractedFieldSchema(IsoDateSchema),
  reference: extractedFieldSchema(ReferenceSchema),
  lineItemsSumMinor: MinorAmountSchema.nullable(),
  taxMinor: MinorAmountSchema.nullable().optional(),
  lineItemAmountsMinor: z.array(MinorAmountSchema.nullable()).max(500).nullable().optional(),
  suspiciousText: z.array(z.string()),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
