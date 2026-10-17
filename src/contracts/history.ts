import { z } from "zod";
import { IsoDateTimeSchema, PeriodSchema } from "./dates";
import { Sha256Schema } from "./invoice";
import {
  CurrencyCodeSchema,
  ExchangeRateSchema,
  MinorAmountSchema,
  PositiveMinorAmountSchema,
} from "./money";
import { PayeeNameSchema } from "./payee";

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
    payee: PayeeNameSchema,
    reference: z.string().trim().min(1),
    amountMinor: PositiveMinorAmountSchema,
    currency: CurrencyCodeSchema,
    exchangeRate: ExchangeRateSchema.nullable(),
    baseAmountMinor: MinorAmountSchema.nullable(),
    status: HistoryEntryStatusSchema,
    // Budget period in the configured time zone. For an approved escalation it is the period of the
    // approval, fixed when it becomes PAYABLE, so it counts against the month in which it was committed.
    period: PeriodSchema,
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
