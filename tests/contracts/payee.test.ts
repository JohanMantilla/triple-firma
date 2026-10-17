import { describe, expect, it } from "vitest";
import { normalizePayee, PayeeNameSchema } from "@/contracts/payee";

describe("normalizePayee", () => {
  it.each([
    ["Dev Partners S.A.S.", "dev partners sas"],
    ["  DEV   partners  SAS ", "dev partners sas"],
    ["Acme Corp.", "acme corp"],
    ["Acme, Inc.", "acme inc"],
    ["\uFF21\uFF43\uFF4D\uFF45 Corp", "acme corp"],
    ["Acme\u200B Corp", "acme corp"],
  ])("normalizes %j to %j", (name, expected) => {
    expect(normalizePayee(name)).toBe(expected);
  });

  it.each([
    ["A&B Corp", "AB Corp"],
    ["Dev-Partners SAS", "Dev Partners SAS"],
    ["Acme (USA) Corp", "Acme USA Corp"],
    ["Cafe Andino", "Café Andino"],
    ["\u0430cme corp", "acme corp"],
  ])("keeps %j and %j different, so R3 escalates them as near matches", (a, b) => {
    expect(normalizePayee(a)).not.toBe(normalizePayee(b));
  });
});

describe("PayeeNameSchema", () => {
  it.each(["Café Andino SAS", "A&B Corp", "3M"])("accepts %j", (name) => {
    expect(PayeeNameSchema.safeParse(name).success).toBe(true);
  });

  it.each(["", "   ", "\u200B", "...", "-- &", "x".repeat(201)])("rejects %j", (name) => {
    expect(PayeeNameSchema.safeParse(name).success).toBe(false);
  });
});
