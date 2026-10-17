import { describe, expect, it } from "vitest";
import { normalizeReference, ReferenceSchema } from "@/contracts/reference";

describe("normalizeReference", () => {
  it.each(["FAC-102", "fac 102", "FAC/102", "FAC.102", "FAC_102", " FAC # 102 ", "FAC​-102"])(
    "treats %j as FAC102",
    (reference) => {
      expect(normalizeReference(reference)).toBe("FAC102");
    },
  );

  it("treats full-width characters as their regular form", () => {
    expect(normalizeReference("ＦＡＣ－１０２")).toBe("FAC102");
  });

  it.each([
    ["FAC-102", "FAC-103"],
    ["FAC-102", "FAC-0102"],
    ["FAC-102", "FAC-102A"],
  ])("keeps %j and %j different, so R2 sees a near duplicate", (a, b) => {
    expect(normalizeReference(a)).not.toBe(normalizeReference(b));
  });
});

describe("ReferenceSchema", () => {
  it("accepts a regular reference", () => {
    expect(ReferenceSchema.safeParse("FAC-102").success).toBe(true);
  });

  it.each(["", "   ", "--/", "​", "x".repeat(101)])("rejects %j", (reference) => {
    expect(ReferenceSchema.safeParse(reference).success).toBe(false);
  });
});
