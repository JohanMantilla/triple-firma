import { z } from "zod";
import { IsoDateSchema, TimezoneSchema } from "./dates";
import {
  ExchangeRateSchema,
  isExchangeRateOne,
  MinorAmountSchema,
  PositiveMinorAmountSchema,
  SupportedCurrencySchema,
} from "./money";
import { normalizePayee, PayeeNameSchema } from "./payee";

export const AgreementSchema = z
  .object({
    payee: PayeeNameSchema,
    amountMinor: PositiveMinorAmountSchema,
    currency: SupportedCurrencySchema,
    validFrom: IsoDateSchema,
    validUntil: IsoDateSchema.nullable(),
  })
  .refine(
    (agreement) => agreement.validUntil === null || agreement.validFrom <= agreement.validUntil,
    {
      message: "validFrom must not be after validUntil",
      path: ["validUntil"],
    },
  );
export type Agreement = z.infer<typeof AgreementSchema>;

export const DueDatePolicySchema = z.object({
  maxDaysOverdue: z.int().nonnegative(),
  maxDaysAhead: z.int().positive(),
});

// Every field is required: an incomplete configuration is rejected instead of silently passing a rule.
// toleranceMinor is in the agreement's currency. R7 compares split payments against approvalThresholdMinor.
export const RulesConfigSchema = z
  .object({
    baseCurrency: SupportedCurrencySchema,
    timezone: TimezoneSchema,
    exchangeRates: z.partialRecord(SupportedCurrencySchema, ExchangeRateSchema),
    approvalThresholdMinor: PositiveMinorAmountSchema,
    hardCapMinor: PositiveMinorAmountSchema.nullable(),
    monthlyBudgetMinor: PositiveMinorAmountSchema,
    allowedPayees: z.array(PayeeNameSchema),
    blockedPayees: z.array(PayeeNameSchema),
    agreements: z.array(AgreementSchema),
    toleranceMinor: MinorAmountSchema,
    splitPaymentWindowDays: z.int().positive(),
    dueDatePolicy: DueDatePolicySchema,
  })
  .superRefine((config, ctx) => {
    const baseRate = config.exchangeRates[config.baseCurrency];
    if (baseRate === undefined || !isExchangeRateOne(baseRate)) {
      ctx.addIssue({
        code: "custom",
        message: "exchangeRates must include the base currency with rate 1",
        path: ["exchangeRates"],
      });
    }

    if (config.hardCapMinor !== null && config.hardCapMinor <= config.approvalThresholdMinor) {
      ctx.addIssue({
        code: "custom",
        message: "hardCapMinor must be greater than approvalThresholdMinor",
        path: ["hardCapMinor"],
      });
    }

    const allowed = new Set(config.allowedPayees.map(normalizePayee));
    config.blockedPayees.forEach((payee, index) => {
      if (allowed.has(normalizePayee(payee))) {
        ctx.addIssue({
          code: "custom",
          message: "A payee cannot be both allowed and blocked",
          path: ["blockedPayees", index],
        });
      }
    });

    config.agreements.forEach((agreement, index) => {
      if (config.exchangeRates[agreement.currency] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: "Agreement currency has no exchange rate",
          path: ["agreements", index, "currency"],
        });
      }

      const hasOverlap = config.agreements
        .slice(0, index)
        .some(
          (other) => isSamePayee(other, agreement) && areValidPeriodsOverlapping(other, agreement),
        );
      if (hasOverlap) {
        ctx.addIssue({
          code: "custom",
          message: "A payee cannot have two agreements valid at the same time",
          path: ["agreements", index],
        });
      }
    });
  });
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

function isSamePayee(a: Agreement, b: Agreement): boolean {
  return normalizePayee(a.payee) === normalizePayee(b.payee);
}

function areValidPeriodsOverlapping(a: Agreement, b: Agreement): boolean {
  const aStartsBeforeBEnds = b.validUntil === null || a.validFrom <= b.validUntil;
  const bStartsBeforeAEnds = a.validUntil === null || b.validFrom <= a.validUntil;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}
