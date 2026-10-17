import { z } from "zod";
import { IsoDateTimeSchema, PeriodSchema } from "./dates";
import { Sha256Schema } from "./invoice";
import {
  CurrencyCodeSchema,
  ExchangeRateSchema,
  isSupportedCurrency,
  MinorAmountSchema,
  PositiveMinorAmountSchema,
} from "./money";
import { PayeeNameSchema } from "./payee";
import { ReferenceSchema } from "./reference";

// PAYABLE: paid automatically or approved by a person. PENDING_APPROVAL: escalated, still undecided.
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
//
// Every invoice is stored, even if some fields were unreadable, so R2 can always compare against it:
// - PAYABLE must carry all its money data, because it will be paid.
// - A PENDING_APPROVAL entry reserves budget only when its baseAmountMinor is known. When it is null
//   (unreadable amount or unsupported currency) it can never be paid, because R6 BLOCKs it at
//   approval, so reserving nothing is exact.
// - A null payee or reference only means R2 compares on the remaining fields (see docs, rule R2).
export const HistoryEntrySchema = z
  .object({
    invoiceId: z.string().min(1),
    fileHash: Sha256Schema,
    payee: PayeeNameSchema.nullable(),
    reference: ReferenceSchema.nullable(),
    amountMinor: PositiveMinorAmountSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    exchangeRate: ExchangeRateSchema.nullable(),
    baseAmountMinor: MinorAmountSchema.nullable(),
    status: HistoryEntryStatusSchema,
    // Budget period in the configured time zone. For an approved escalation it is the period of the
    // approval, fixed when it becomes PAYABLE, so it counts against the month in which it was committed.
    period: PeriodSchema,
    decidedAt: IsoDateTimeSchema,
  })
  .superRefine((entry, ctx) => {
    const hasCompleteMoneyData =
      entry.amountMinor !== null &&
      entry.currency !== null &&
      isSupportedCurrency(entry.currency) &&
      entry.exchangeRate !== null &&
      entry.baseAmountMinor !== null;

    if (entry.status === "PAYABLE" && !hasCompleteMoneyData) {
      ctx.addIssue({
        code: "custom",
        message:
          "A PAYABLE entry must record its amount, a supported currency, exchange rate and base amount",
        path: ["baseAmountMinor"],
      });
    }

    if (entry.baseAmountMinor !== null && !hasCompleteMoneyData) {
      ctx.addIssue({
        code: "custom",
        message:
          "A base amount requires the amount, a supported currency and the exchange rate it came from",
        path: ["baseAmountMinor"],
      });
    }
  });
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
