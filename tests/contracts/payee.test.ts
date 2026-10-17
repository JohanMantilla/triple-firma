import { describe, expect, it } from "vitest";
import { normalizePayee, PayeeNameSchema } from "@/contracts/payee";

describe("normalizePayee", () => {
  it.each([
    ["Dev Partners S.A.S.", "dev partners sas"],
    ["  DEV   partners  SAS ", "dev partners sas"],
    ["Acme Corp.", "acme corp"],
    ["Ａｃｍｅ Corp", "acme corp"],
    ["Acme​ Corp", "acme corp"],
  ])("normalizes %j to %j", (name, expected) => {
    expect(normalizePayee(name)).toBe(expected);
  });

  it("keeps accents, so Cafe and Café are not an exact match", () => {
    expect(normalizePayee("Cafe Andino")).not.toBe(normalizePayee("Café Andino"));
  });

  it("keeps lookalike letters from other scripts, so a Cyrillic a is not an exact match", () => {
    expect(normalizePayee("аcme corp")).not.toBe(normalizePayee("acme corp"));
  });
});

describe("PayeeNameSchema", () => {
  it("accepts a regular name", () => {
    expect(PayeeNameSchema.safeParse("Café Andino SAS").success).toBe(true);
  });

  it.each(["", "   ", "​", "...", "x".repeat(201)])("rejects %j", (name) => {
    expect(PayeeNameSchema.safeParse(name).success).toBe(false);
  });
});
