import { describe, expect, it } from "vitest";
import { isWithinOneEdit } from "@/engine/rules/edit-distance";

describe("isWithinOneEdit", () => {
  it.each([
    ["equal strings", "FAC102", "FAC102"],
    ["a changed character", "FAC102", "FAC103"],
    ["an added character", "FAC102", "FAC1020"],
    ["a removed character", "FAC102", "FAC12"],
    ["a change at the start", "acmecorp", "xcmecorp"],
    ["a change at the end", "acmecorp", "acmecorx"],
    ["two empty strings", "", ""],
    ["one character vs empty", "a", ""],
  ])("accepts %s", (_case, a, b) => {
    expect(isWithinOneEdit(a, b)).toBe(true);
    expect(isWithinOneEdit(b, a)).toBe(true);
  });

  it.each([
    ["two changed characters", "FAC102", "FAC203"],
    ["a transposition", "corp", "crop"],
    ["two added characters", "FAC102", "FAC10200"],
    ["different lengths and content", "acme", "zeta corp"],
  ])("rejects %s", (_case, a, b) => {
    expect(isWithinOneEdit(a, b)).toBe(false);
  });

  it("counts an astral character as one", () => {
    const mathematicalA = String.fromCodePoint(0x1d41a);
    expect(isWithinOneEdit(`${mathematicalA}cme`, "acme")).toBe(true);
  });
});
