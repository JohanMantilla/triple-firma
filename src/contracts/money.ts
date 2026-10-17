import { z } from "zod";

// Any ISO 4217 code an invoice may show. Codes outside SUPPORTED_CURRENCIES are escalated by R8.
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code such as USD or COP");
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;

// Every supported currency has 2 decimal places, so amountMinor is always the amount in cents.
// Adding a currency with another exponent (JPY has 0) would break that assumption: do not add one.
export const SUPPORTED_CURRENCIES = ["USD", "COP", "MXN", "ARS"] as const;
export const SupportedCurrencySchema = z.enum(SUPPORTED_CURRENCIES);
export type SupportedCurrency = z.infer<typeof SupportedCurrencySchema>;

export function isSupportedCurrency(code: string): code is SupportedCurrency {
  return SupportedCurrencySchema.safeParse(code).success;
}

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
