import { describe, expect, it } from "vitest";
import { convertToBaseMinor } from "@/engine/convert-to-base";

describe("convertToBaseMinor", () => {
  it("keeps base currency amounts unchanged", () => {
    expect(convertToBaseMinor(200_000, "1")).toBe(200_000);
    expect(convertToBaseMinor(1, "1.00")).toBe(1);
  });

  it.each([
    ["COP 8,000,000.00 at 4000 is exactly USD 2,000.00", 800_000_000, "4000", 200_000],
    ["COP 8,000,000.01 drops the 0.0000025 fraction", 800_000_001, "4000", 200_000],
    ["COP 7,999,999.99 rounds up to USD 2,000.00", 799_999_999, "4000", 200_000],
    ["COP 8,000,019.99 (USD 2,000.0049975) rounds down", 800_001_999, "4000", 200_000],
    ["COP 8,000,020.00 (USD 2,000.005, exactly half) rounds half up", 800_002_000, "4000", 200_001],
    ["MXN 37,000.00 at 18.50 is exactly USD 2,000.00", 3_700_000, "18.50", 200_000],
    ["MXN 37,000.10 at 18.50 (USD 2,000.0054) rounds up", 3_700_010, "18.50", 200_001],
    ["ARS 2,000,000.00 at 1000 is exactly USD 2,000.00", 200_000_000, "1000", 200_000],
    ["a rate below 1 increases the amount", 100_000, "0.5", 200_000],
  ])("%s", (_case, amountMinor, rate, expected) => {
    expect(convertToBaseMinor(amountMinor, rate)).toBe(expected);
  });

  it("treats trailing zeros in the rate as the same rate", () => {
    expect(convertToBaseMinor(3_700_000, "18.5")).toBe(convertToBaseMinor(3_700_000, "18.500"));
  });

  it("converts a COP amount below half a cent in USD to zero", () => {
    expect(convertToBaseMinor(1, "4000")).toBe(0);
  });

  it("is exact for huge amounts where floating point would drift", () => {
    expect(convertToBaseMinor(Number.MAX_SAFE_INTEGER, "1")).toBe(Number.MAX_SAFE_INTEGER);
    expect(convertToBaseMinor(9_007_199_254_740_000, "4000")).toBe(2_251_799_813_685);
  });

  it("returns null when the result does not fit in a safe integer", () => {
    expect(convertToBaseMinor(Number.MAX_SAFE_INTEGER, "0.5")).toBeNull();
  });
});
