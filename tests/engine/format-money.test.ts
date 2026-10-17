import { describe, expect, it } from "vitest";
import { formatMoney } from "@/engine/format-money";

describe("formatMoney", () => {
  it.each([
    [0, "USD 0,00"],
    [5, "USD 0,05"],
    [250_000, "USD 2.500,00"],
    [200_001, "USD 2.000,01"],
    [123_456_789, "USD 1.234.567,89"],
    [-250_000, "USD -2.500,00"],
    [Number.MAX_SAFE_INTEGER, "USD 90.071.992.547.409,91"],
  ])("formats %i as %s", (amountMinor, expected) => {
    expect(formatMoney(amountMinor, "USD")).toBe(expected);
  });

  it("uses the given currency code", () => {
    expect(formatMoney(450_000_000, "COP")).toBe("COP 4.500.000,00");
  });
});
