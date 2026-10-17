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

  it.each(["PAYABLE", "PENDING_APPROVAL"])(
    "rejects a %s entry without the exchange rate or base amount",
    (status) => {
      expect(HistoryEntrySchema.safeParse({ ...entry, status, exchangeRate: null }).success).toBe(
        false,
      );
      expect(
        HistoryEntrySchema.safeParse({ ...entry, status, baseAmountMinor: null }).success,
      ).toBe(false);
    },
  );

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
