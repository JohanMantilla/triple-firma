import { describe, expect, it } from "vitest";
import { HistoryEntrySchema } from "@/contracts/history";

describe("HistoryEntrySchema", () => {
  const entry = {
    invoiceId: "inv-0",
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

  it("rejects an entry without the exchange rate used", () => {
    const { exchangeRate: _omitted, ...withoutRate } = entry;
    expect(HistoryEntrySchema.safeParse(withoutRate).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(HistoryEntrySchema.safeParse({ ...entry, status: "PAID" }).success).toBe(false);
  });
});
