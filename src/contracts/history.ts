import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { CurrencyCodeSchema, ExchangeRateSchema, MinorAmountSchema } from "./money";

// PAYABLE: paid automatically or approved by a person. PENDING_APPROVAL: escalated, still reserving budget.
export const HistoryEntryStatusSchema = z.enum(["PAYABLE", "PENDING_APPROVAL"]);
export type HistoryEntryStatus = z.infer<typeof HistoryEntryStatusSchema>;

// One past invoice the engine needs for duplicates (R2), budget (R6) and split payments (R7).
// It keeps the rate used at decision time, so later rate changes never alter past amounts.
export const HistoryEntrySchema = z.object({
  invoiceId: z.string().min(1),
  payee: z.string().trim().min(1),
  reference: z.string().trim().min(1),
  amountMinor: MinorAmountSchema,
  currency: CurrencyCodeSchema,
  exchangeRate: ExchangeRateSchema,
  baseAmountMinor: MinorAmountSchema,
  status: HistoryEntryStatusSchema,
  decidedAt: IsoDateTimeSchema,
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
