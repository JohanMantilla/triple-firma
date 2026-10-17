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

  it.each([
    ["just above half (USD 2,000.00500025)", 800_002_001, 200_001],
    ["just below half (USD 2,000.00499975)", 800_001_999, 200_000],
  ])("rounds %s correctly", (_case, amountMinor, expected) => {
    expect(convertToBaseMinor(amountMinor, "4000")).toBe(expected);
  });

  it("converts a zero amount to zero", () => {
    expect(convertToBaseMinor(0, "4000")).toBe(0);
  });

  it.each([
    ["0004000", 800_000_000, 200_000],
    ["00.5", 100_000, 200_000],
    ["18.123456789", 3_624_691_358, 200_000_000],
  ])("parses the rate %s exactly", (rate, amountMinor, expected) => {
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

  it("returns the largest safe integer but null one cent above it", () => {
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2);
    expect(convertToBaseMinor(half, "0.5")).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(convertToBaseMinor(half + 1, "0.5")).toBeNull();
  });

  it.each(["-1", "0", "0.00", "", "1.2.3", "1e3", "4,000", " 4000", "abc"])(
    "returns null for the unvalidated rate %j instead of a wrong or negative amount",
    (rate) => {
      expect(convertToBaseMinor(100_000, rate)).toBeNull();
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "returns null for the invalid amount %s instead of throwing",
    (amountMinor) => {
      expect(convertToBaseMinor(amountMinor, "4000")).toBeNull();
    },
  );
});
