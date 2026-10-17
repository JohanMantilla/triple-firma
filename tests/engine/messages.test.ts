import { describe, expect, it } from "vitest";
import { quoteUntrusted } from "@/engine/messages";

describe("quoteUntrusted", () => {
  it("wraps plain text in typographic quotes", () => {
    expect(quoteUntrusted("Shady LLC")).toBe("\u201cShady LLC\u201d");
  });

  it("turns line breaks, tabs and invisible characters into single spaces", () => {
    expect(quoteUntrusted("Shady\n\tLLC\u200B\u2028Inc")).toBe("\u201cShady LLC Inc\u201d");
  });

  it("neutralizes every kind of quote so the text cannot close the quotation", () => {
    expect(quoteUntrusted(`a'b"c\u201cd\u201de`)).toBe("\u201ca\u2019b\u2019c\u2019d\u2019e\u201d");
  });

  it("cuts text longer than 80 characters", () => {
    expect(quoteUntrusted("x".repeat(200))).toBe(`\u201c${"x".repeat(80)}\u2026\u201d`);
  });
});
