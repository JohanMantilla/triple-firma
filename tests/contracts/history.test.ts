import { describe, expect, it } from "vitest";
import { HistoryEntrySchema, isCountedInBudget } from "@/contracts/history";
import { VALID_HASH } from "./fixtures";

describe("HistoryEntrySchema", () => {
  const entry = {
    invoiceId: "inv-0",
    fileHash: VALID_HASH,
    payee: "Café Andino SAS",
    reference: "FAC-101",
    amountMinor: 450_000_000,
    currency: "COP",
    exchangeRate: "4000",
    baseAmountMinor: 112_500,
    status: "PENDING_APPROVAL",
    period: "2026-10",
    decidedAt: "2026-10-03T14:00:00Z",
  };

  it("accepts a pending escalation that reserves budget", () => {
    expect(HistoryEntrySchema.safeParse(entry).success).toBe(true);
  });

  it.each(["amountMinor", "currency", "exchangeRate", "baseAmountMinor"])(
    "rejects a PAYABLE entry without %s, because it will be paid",
    (field) => {
      expect(
        HistoryEntrySchema.safeParse({ ...entry, status: "PAYABLE", [field]: null }).success,
      ).toBe(false);
    },
  );

  it("rejects a PAYABLE entry in a currency outside the supported list", () => {
    expect(
      HistoryEntrySchema.safeParse({ ...entry, status: "PAYABLE", currency: "EUR" }).success,
    ).toBe(false);
  });

  it("keeps a pending escalation with an unreadable reference and payee, so it still reserves budget", () => {
    const unreadable = { ...entry, payee: null, reference: null };
    expect(HistoryEntrySchema.safeParse(unreadable).success).toBe(true);
  });

  it("keeps a pending escalation with an unreadable amount, which reserves nothing because it can never be paid", () => {
    const unreadable = { ...entry, amountMinor: null, exchangeRate: null, baseAmountMinor: null };
    expect(HistoryEntrySchema.safeParse(unreadable).success).toBe(true);
  });

  it.each([
    ["without its exchange rate", { exchangeRate: null }],
    ["without its amount", { amountMinor: null }],
    ["in an unsupported currency", { currency: "EUR" }],
  ])("rejects a base amount %s", (_case, change) => {
    expect(HistoryEntrySchema.safeParse({ ...entry, ...change }).success).toBe(false);
  });

  it("keeps a REJECTED invoice in an unsupported currency, so R2 can catch it", () => {
    const rejected = {
      ...entry,
      status: "REJECTED",
      currency: "EUR",
      exchangeRate: null,
      baseAmountMinor: null,
    };
    expect(HistoryEntrySchema.safeParse(rejected).success).toBe(true);
  });

  it.each(["REJECTED", "BLOCKED"])(
    "keeps a %s invoice even without base amount, so R2 can catch a resubmission",
    (status) => {
      const withoutConversion = { ...entry, status, exchangeRate: null, baseAmountMinor: null };
      expect(HistoryEntrySchema.safeParse(withoutConversion).success).toBe(true);
    },
  );

  it("rejects an entry without the file hash", () => {
    const { fileHash: _omitted, ...withoutHash } = entry;
    expect(HistoryEntrySchema.safeParse(withoutHash).success).toBe(false);
  });

  it.each(["2026-13", "2026-1", "10-2026"])("rejects the period %s", (period) => {
    expect(HistoryEntrySchema.safeParse({ ...entry, period }).success).toBe(false);
  });

  it("rejects a zero amount", () => {
    expect(HistoryEntrySchema.safeParse({ ...entry, amountMinor: 0 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(HistoryEntrySchema.safeParse({ ...entry, status: "PAID" }).success).toBe(false);
  });
});

describe("isCountedInBudget", () => {
  it.each([
    ["PAYABLE", true],
    ["PENDING_APPROVAL", true],
    ["REJECTED", false],
    ["BLOCKED", false],
  ] as const)("is %s → %s", (status, expected) => {
    expect(isCountedInBudget(status)).toBe(expected);
  });
});
