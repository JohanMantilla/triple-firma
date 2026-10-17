import { describe, expect, it } from "vitest";
import { ExtractionSchema } from "@/contracts/extraction";
import { buildExtraction } from "./fixtures";

describe("ExtractionSchema", () => {
  it("accepts a complete extraction", () => {
    expect(ExtractionSchema.safeParse(buildExtraction()).success).toBe(true);
  });

  it("accepts an uncertain field with no value, so R1 can escalate it", () => {
    const extraction = buildExtraction();
    extraction.amountMinor = {
      raw: "1.500",
      value: null,
      evidence: "Total 1.500",
      isUncertain: true,
    };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
  });

  it("rejects an amount with decimals", () => {
    const extraction = buildExtraction();
    extraction.amountMinor = { ...extraction.amountMinor, value: 2500.5 };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(false);
  });

  it("rejects a currency symbol instead of an ISO code", () => {
    const extraction = buildExtraction();
    extraction.currency = { ...extraction.currency, value: "$" };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(false);
  });

  it("rejects a due date that is not ISO", () => {
    const extraction = buildExtraction();
    extraction.dueDate = { ...extraction.dueDate, value: "30/10/2026" };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(false);
  });

  it("rejects a field without the isUncertain flag", () => {
    const extraction = buildExtraction();
    const { isUncertain: _omitted, ...payee } = extraction.payee;
    expect(ExtractionSchema.safeParse({ ...extraction, payee }).success).toBe(false);
  });

  it.each([0, -250_000])("rejects the amount %s, so R1 escalates it", (value) => {
    const extraction = buildExtraction();
    extraction.amountMinor = { ...extraction.amountMinor, value };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(false);
  });

  it("rejects a negative sum of line items", () => {
    expect(
      ExtractionSchema.safeParse({ ...buildExtraction(), lineItemsSumMinor: -1 }).success,
    ).toBe(false);
  });

  it("rejects a payee made only of invisible characters", () => {
    const extraction = buildExtraction();
    extraction.payee = { ...extraction.payee, value: "\u200B \u200D" };
    expect(ExtractionSchema.safeParse(extraction).success).toBe(false);
  });
});
