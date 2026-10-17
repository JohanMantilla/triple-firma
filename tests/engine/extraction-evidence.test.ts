import { describe, expect, it } from "vitest";
import {
  isAmountSupported,
  isCurrencySupported,
  isDueDateSupported,
  isPayeeSupported,
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
    [250_000, "Total 2 500,00"],
    [250_000, "Total\u00A02\u202F500,00 COP"],
    [250_000, "Total: USD2,500.00"],
    [250_000, "Total 2,500.00 vence 30/10/2026"],
  ])("supports %i with %j", (amountMinor, evidence) => {
    expect(isAmountSupported(amountMinor, evidence)).toBe(true);
  });

  it.each([
    [250_000, "Total: USD 25.00"],
    [250_000, "Total: 250000"],
    [2_500, "Total: USD 2,500.00"],
    [250_000, "Total: USD dos mil quinientos"],
    [150, "Total 1.500"],
    [250_000, "Total: -2,500.00"],
    [250_000, "Total: - 2,500.00"],
    [250_000, "Saldo a favor (2,500.00)"],
    [250_000, "Total \u22122,500.00"],
    [250_000, "Total \u20132,500.00"],
    [3_000, "Total 25,000.00 vence 30/10/2026"],
    [1_900, "Total 25,000.00 IVA 19%"],
    [10_200, "Factura INV-102 por 25,000.00"],
    [25_000, "Total 2 50"],
  ])("does not support %i with %j", (amountMinor, evidence) => {
    expect(isAmountSupported(amountMinor, evidence)).toBe(false);
  });
});

describe("isCurrencySupported", () => {
  it.each([
    ["USD", "Total: USD 2,500.00"],
    ["USD", "Total US$ 2,500.00"],
    ["COP", "Valor: COP 4.500.000"],
    ["COP", "4.500.000 cop"],
  ])("supports %s with %j", (currency, evidence) => {
    expect(isCurrencySupported(currency, evidence)).toBe(true);
  });

  it.each([
    ["COP", "Total USD 2,500.00"],
    ["USD", "Total $ 2,500.00"],
    ["USD", "Total USDT 2,500.00"],
    ["MXN", "Total 2,500.00"],
  ])("does not support %s with %j", (currency, evidence) => {
    expect(isCurrencySupported(currency, evidence)).toBe(false);
  });
});

describe("isDueDateSupported", () => {
  it.each([
    ["2026-10-30", "Due: Oct 30, 2026"],
    ["2026-10-30", "Vence: 30/10/2026"],
    ["2026-10-30", "Fecha límite: 2026-10-30"],
    ["2026-10-30", "Pagar antes del 30 de octubre de 2026"],
    ["2026-08-05", "Vence el 5 de agosto de 2026"],
    ["2026-05-05", "Due 05/05/2026"],
    ["2026-09-15", "Vence el 15 de setiembre de 2026"],
    ["2026-12-01", "Due Dec. 1, 2026"],
  ])("supports %s with %j", (isoDate, evidence) => {
    expect(isDueDateSupported(isoDate, evidence)).toBe(true);
  });

  it.each([
    ["2026-01-01", "Due: Oct 30, 2026"],
    ["2026-10-30", "Vence: 30/10/26"],
    ["2026-10-30", "Due: Oct 31, 2026"],
    ["2026-05-05", "Due 5 2026"],
    ["2026-10-30", "Factura del mes"],
    ["2026-09-30", "Vence 30 2026, pago separado"],
    ["2026-03-30", "Vence 30 2026, marca registrada"],
  ])("does not support %s with %j", (isoDate, evidence) => {
    expect(isDueDateSupported(isoDate, evidence)).toBe(false);
  });
});
