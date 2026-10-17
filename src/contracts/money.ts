import { z } from "zod";

// All supported currencies use 2 decimal places, so amountMinor is always the amount in cents.
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code such as USD or COP");
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

export const MinorAmountSchema = z.int().nonnegative();

export const PositiveMinorAmountSchema = z.int().positive();

// Units of the currency per 1 unit of the base currency, as an exact decimal string ("4000", "18.50").
export const ExchangeRateSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Exchange rate must be a plain decimal string such as 4000 or 18.50")
  .refine((rate) => /[1-9]/.test(rate), "Exchange rate must be greater than zero");
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export function isExchangeRateOne(rate: ExchangeRate): boolean {
  return /^0*1(\.0+)?$/.test(rate);
}
