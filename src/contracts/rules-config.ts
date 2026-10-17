import { z } from "zod";
import { IsoDateSchema, TimezoneSchema } from "./dates";
import {
  CurrencyCodeSchema,
  ExchangeRateSchema,
  isExchangeRateOne,
  MinorAmountSchema,
  PositiveMinorAmountSchema,
} from "./money";

const PayeeNameSchema = z.string().trim().min(1);

export const AgreementSchema = z
  .object({
    payee: PayeeNameSchema,
    amountMinor: PositiveMinorAmountSchema,
    currency: CurrencyCodeSchema,
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
export const RulesConfigSchema = z
  .object({
    baseCurrency: CurrencyCodeSchema,
    timezone: TimezoneSchema,
    exchangeRates: z.record(CurrencyCodeSchema, ExchangeRateSchema),
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

    const allowed = new Set(config.allowedPayees.map(normalizeForComparison));
    config.blockedPayees.forEach((payee, index) => {
      if (allowed.has(normalizeForComparison(payee))) {
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
    });
  });
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

function normalizeForComparison(payee: string): string {
  return payee.trim().toLowerCase();
}
