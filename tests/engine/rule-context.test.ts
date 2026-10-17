import { describe, expect, it } from "vitest";
import { buildRuleContext, daysBetween, toPeriod } from "@/engine/rule-context";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

function invoiceWith(amountMinor: number | null, currency: string | null) {
  const invoice = buildInvoice();
  invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: amountMinor };
  invoice.extraction.currency = { ...invoice.extraction.currency, value: currency };
  return invoice;
}

function contextFor(amountMinor: number | null, currency: string | null) {
  return buildRuleContext({
    invoice: invoiceWith(amountMinor, currency),
    config: buildRulesConfig(),
    history: [],
    now: NOW,
  });
}

describe("buildRuleContext", () => {
  it("converts a COP invoice once with the configured rate", () => {
    expect(contextFor(800_000_000, "COP")).toMatchObject({
      amountMinor: 800_000_000,
      currency: "COP",
      exchangeRate: "4000",
      baseAmountMinor: 200_000,
    });
  });

  it.each([
    ["an unsupported currency", 100_000, "EUR"],
    ["a supported currency without a configured rate", 100_000, "MXN"],
    ["an unreadable amount", null, "USD"],
    ["an unreadable currency", 100_000, null],
  ])("leaves the base amount and rate null for %s", (_case, amountMinor, currency) => {
    const config = buildRulesConfig({ exchangeRates: { USD: "1", COP: "4000" } });
    const ctx = buildRuleContext({
      invoice: invoiceWith(amountMinor, currency),
      config,
      history: [],
      now: NOW,
    });
    expect(ctx.baseAmountMinor).toBeNull();
    expect(ctx.exchangeRate).toBeNull();
  });

  it.each(["amountMinor", "currency"] as const)(
    "keeps an uncertain %s for display but does not convert it",
    (field) => {
      const invoice = invoiceWith(800_000_000, "COP");
      if (field === "amountMinor") {
        invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, isUncertain: true };
      } else {
        invoice.extraction.currency = { ...invoice.extraction.currency, isUncertain: true };
      }
      const ctx = buildRuleContext({ invoice, config: buildRulesConfig(), history: [], now: NOW });
      expect(ctx).toMatchObject({
        amountMinor: 800_000_000,
        currency: "COP",
        exchangeRate: null,
        baseAmountMinor: null,
      });
    },
  );

  it("computes the period of now in the configured time zone", () => {
    expect(contextFor(100_000, "USD").period).toBe("2026-10");
  });
});

describe("toPeriod", () => {
  it.each([
    ["2026-11-01T03:59:59Z", "America/New_York", "2026-10"],
    ["2026-11-01T04:00:00Z", "America/New_York", "2026-11"],
    ["2026-11-01T03:59:59Z", "UTC", "2026-11"],
    ["2027-01-01T04:59:59Z", "America/New_York", "2026-12"],
    ["2027-01-01T05:00:00Z", "America/New_York", "2027-01"],
  ])("puts %s in %s into the period %s", (isoUtc, timezone, expected) => {
    expect(toPeriod(isoUtc, timezone)).toBe(expected);
  });

  it("handles the last millisecond of the month", () => {
    expect(toPeriod("2026-11-01T03:59:59.999Z", "America/New_York")).toBe("2026-10");
  });

  it.each([
    ["a year below 1000", "0500-01-01T00:00:00Z", "UTC"],
    ["a year above 9999", "9999-12-31T23:00:00Z", "Asia/Tokyo"],
  ])("throws for %s instead of returning a malformed period", (_case, isoUtc, timezone) => {
    expect(() => toPeriod(isoUtc, timezone)).toThrow();
  });
});

describe("daysBetween", () => {
  it.each([
    ["the same day", "2026-10-17", "2026-10-17", 0],
    ["a later day", "2026-10-17", "2026-10-30", 13],
    ["an earlier day", "2026-10-17", "2026-10-11", -6],
    ["the end of daylight saving time in New York", "2026-10-31", "2026-11-02", 2],
    ["the start of daylight saving time in New York", "2026-03-07", "2026-03-09", 2],
    ["a month change", "2026-10-30", "2026-11-03", 4],
    ["a leap day", "2028-02-28", "2028-03-01", 2],
    ["a year change", "2026-12-31", "2027-01-01", 1],
    ["a year below 100, kept as is", "0050-01-01", "0050-01-31", 30],
  ])("counts whole calendar days across %s", (_case, from, to, days) => {
    expect(daysBetween(from, to)).toBe(days);
  });
});
