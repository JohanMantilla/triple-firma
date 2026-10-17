import { describe, expect, it } from "vitest";
import {
  CurrencyCodeSchema,
  ExchangeRateSchema,
  isExchangeRateOne,
  MinorAmountSchema,
} from "@/contracts/money";

describe("MinorAmountSchema", () => {
  it("accepts integer cents", () => {
    expect(MinorAmountSchema.safeParse(200_000).success).toBe(true);
  });

  it.each([1500.5, -1, Number.NaN, 2 ** 60])("rejects %s", (amount) => {
    expect(MinorAmountSchema.safeParse(amount).success).toBe(false);
  });
});

describe("CurrencyCodeSchema", () => {
  it.each(["USD", "COP", "EUR"])("accepts %s", (code) => {
    expect(CurrencyCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(["usd", "$", "US", "USDT", ""])("rejects %s", (code) => {
    expect(CurrencyCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("ExchangeRateSchema", () => {
  it.each(["1", "4000", "18.50", "0.5"])("accepts %s", (rate) => {
    expect(ExchangeRateSchema.safeParse(rate).success).toBe(true);
  });

  it.each(["0", "0.00", "-4000", "4,000", "1e3", "18.", ".5", " 1", ""])("rejects %s", (rate) => {
    expect(ExchangeRateSchema.safeParse(rate).success).toBe(false);
  });

  it("rejects numbers, so rates never pass through floating point", () => {
    expect(ExchangeRateSchema.safeParse(18.5).success).toBe(false);
  });
});

describe("isExchangeRateOne", () => {
  it.each(["1", "1.0", "1.00", "01"])("is true for %s", (rate) => {
    expect(isExchangeRateOne(rate)).toBe(true);
  });

  it.each(["10", "1.01", "0.1"])("is false for %s", (rate) => {
    expect(isExchangeRateOne(rate)).toBe(false);
  });
});
