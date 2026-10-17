import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { Sha256Schema } from "./invoice";
import { CurrencyCodeSchema, ExchangeRateSchema, MinorAmountSchema } from "./money";

// PAYABLE: paid automatically or approved by a person. PENDING_APPROVAL: escalated, reserving budget.
// REJECTED and BLOCKED never count toward the budget, but they stay in history so a resubmitted copy
// (even a new scan with a different file hash) is caught by R2 instead of being paid.
export const HistoryEntryStatusSchema = z.enum([
  "PAYABLE",
  "PENDING_APPROVAL",
  "REJECTED",
  "BLOCKED",
]);
export type HistoryEntryStatus = z.infer<typeof HistoryEntryStatusSchema>;

const BUDGET_STATUSES: readonly HistoryEntryStatus[] = ["PAYABLE", "PENDING_APPROVAL"];

export function isCountedInBudget(status: HistoryEntryStatus): boolean {
  return BUDGET_STATUSES.includes(status);
}

// One past invoice the engine needs for duplicates (R2), budget (R6) and split payments (R7).
// It keeps the rate used at decision time, so later rate changes never alter past amounts.
export const HistoryEntrySchema = z
  .object({
    invoiceId: z.string().min(1),
    fileHash: Sha256Schema,
    payee: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    amountMinor: MinorAmountSchema,
    currency: CurrencyCodeSchema,
    exchangeRate: ExchangeRateSchema.nullable(),
    baseAmountMinor: MinorAmountSchema.nullable(),
    status: HistoryEntryStatusSchema,
    decidedAt: IsoDateTimeSchema,
  })
  .refine(
    (entry) =>
      !isCountedInBudget(entry.status) ||
      (entry.exchangeRate !== null && entry.baseAmountMinor !== null),
    {
      message: "Entries counted in the budget must record their exchange rate and base amount",
      path: ["baseAmountMinor"],
    },
  );
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
