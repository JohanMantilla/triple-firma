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
    decidedAt: "2026-10-03T10:00:00-04:00",
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
