import { describe, expect, it } from "vitest";
import {
  isAmountSupported,
  isPayeeSupported,
  isRawSupported,
  isReferenceSupported,
} from "@/engine/rules/extraction-evidence";

describe("isPayeeSupported", () => {
  it.each([
    ["Dev Partners SAS", "From: Dev Partners SAS"],
    ["Dev Partners SAS", "Pagar a DEV PARTNERS S.A.S."],
    ["Acme Corp", "Acme Corp. (USA)"],
  ])("supports %j with %j", (value, evidence) => {
    expect(isPayeeSupported(value, evidence)).toBe(true);
  });

  it.each([
    ["Dev Partners SAS", "From: Shady LLC"],
    ["Acme Corp", "From: Acme Corporation Ltd"],
    ["Acme Corp", "From: MegaAcme Corp"],
    ["Dev Partners SAS", "Dev"],
  ])("does not support %j with %j", (value, evidence) => {
    expect(isPayeeSupported(value, evidence)).toBe(false);
  });
});

describe("isReferenceSupported", () => {
  it.each([
    ["INV-102", "Invoice INV-102"],
    ["INV-102", "Factura No. inv 102"],
    ["FAC-102", "Cuenta de cobro FAC/102 del mes"],
  ])("supports %j with %j", (value, evidence) => {
    expect(isReferenceSupported(value, evidence)).toBe(true);
  });

  it.each([
    ["FAC-1", "Invoice FAC-10"],
    ["FAC-102", "Invoice FAC-1020"],
    ["INV-102", "Total: USD 2,500.00"],
  ])("does not support %j with %j", (value, evidence) => {
    expect(isReferenceSupported(value, evidence)).toBe(false);
  });
});

describe("isAmountSupported", () => {
  it.each([
    [250_000, "Total: USD 2,500.00"],
    [250_000, "Total: COP 2.500,00"],
    [250_000, "Total 2500"],
    [250_000, "Total 2,500"],
    [150_000, "Total 1.500"],
    [250, "Total 2.5"],
    [250_000, "Subtotal 2,000.00 IVA 500.00 Total 2,500.00"],
  ])("supports %i with %j", (amountMinor, evidence) => {
    expect(isAmountSupported(amountMinor, evidence)).toBe(true);
  });

  it.each([
    [250_000, "Total: USD 25.00"],
    [250_000, "Total: 250000"],
    [2_500, "Total: USD 2,500.00"],
    [250_000, "Total: USD dos mil quinientos"],
    [150, "Total 1.500"],
  ])("does not support %i with %j", (amountMinor, evidence) => {
    expect(isAmountSupported(amountMinor, evidence)).toBe(false);
  });
});

describe("isRawSupported", () => {
  it("supports raw text that appears in the evidence, ignoring case and spacing", () => {
    expect(isRawSupported("Oct 30, 2026", "Due:   oct 30,  2026")).toBe(true);
  });

  it.each([
    [null, "Total: USD 2,500.00"],
    ["", "Total: USD 2,500.00"],
    ["   ", "Total: USD 2,500.00"],
    ["EUR", "Total: USD 2,500.00"],
  ])("does not support the raw %j", (raw, evidence) => {
    expect(isRawSupported(raw, evidence)).toBe(false);
  });
});
