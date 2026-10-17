import { describe, expect, it } from "vitest";
import { ExtractionSchema } from "@/contracts/extraction";
import {
  normalizeAmount,
  normalizeCurrency,
  normalizeDate,
  normalizeExtraction,
} from "@/extraction/normalize-extraction";
import type { ReaderField, ReaderResponse } from "@/extraction/reader";

function field(raw: string | null, value: string | null = raw, isUncertain = false): ReaderField {
  return { raw, value, evidence: raw, isUncertain };
}

const READER_RESPONSE: ReaderResponse = {
  payee: field("Dev Partners SAS"),
  amountString: field("USD 2,500.00", "2500.00"),
  currencyRaw: field("USD"),
  issueDateString: field("Oct 1, 2026", "2026-10-01"),
  dueDateString: field("Oct 30, 2026", "2026-10-30"),
  reference: field("INV-102"),
  lineItemAmountStrings: ["USD 1,000.00", "USD 1,500.00"],
  suspiciousText: [],
};

describe("normalizeAmount", () => {
  it.each([
    ["2500", 250000],
    ["2500.00", 250000],
    ["2,500.00", 250000],
    ["2.500,00", 250000],
    ["USD 2,500.00", 250000],
    ["$1.500.000", 150000000],
    ["COP 4.500.000,00", 450000000],
    ["1,234,567.89", 123456789],
    ["2 500,50", 250050],
    ["1'500.00", 150000],
    ["12.5", 1250],
    ["0.50", 50],
    ["1,500", 150000],
    ["1.500", 150000],
    ["0.01", 1],
  ])("reads %s as %d minor units", (raw, expected) => {
    expect(normalizeAmount(raw)).toBe(expected);
  });

  it("is exact where floating point would drift", () => {
    expect(normalizeAmount("0.29")).toBe(29);
    expect(normalizeAmount("1.15")).toBe(115);
    expect(normalizeAmount("4.35")).toBe(435);
  });

  it.each([
    ["no digits", "Total"],
    ["empty", ""],
    ["negative", "-2,500.00"],
    ["negative in parentheses", "(2,500.00)"],
    ["two numbers", "2,500.00 and 300.00"],
    ["three decimals", "2.5000"],
    ["mixed separators", "1,500.000,00"],
    ["bad grouping", "1.50.000"],
    ["leading zero group", "0,500"],
    ["words between digits", "12 2500"],
    ["beyond safe integers", "99999999999999999.99"],
  ])("returns null for %s", (_label, raw) => {
    expect(normalizeAmount(raw)).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it.each([
    ["USD", "USD"],
    ["usd", "USD"],
    ["COP", "COP"],
    ["US$", "USD"],
    ["MX$", "MXN"],
    ["AR$", "ARS"],
    ["COL$", "COP"],
    ["€", "EUR"],
    ["Currency: USD", "USD"],
    ["USD$", "USD"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normalizeCurrency(raw)).toBe(expected);
  });

  it.each([
    ["a bare dollar sign", "$"],
    ["no currency", "dollars"],
    ["two currencies", "USD / COP"],
    ["empty", ""],
  ])("returns null for %s", (_label, raw) => {
    expect(normalizeCurrency(raw)).toBeNull();
  });
});

describe("normalizeDate", () => {
  it.each([
    ["2026-10-30", "2026-10-30"],
    ["Oct 30, 2026", "2026-10-30"],
    ["October 30th, 2026", "2026-10-30"],
    ["30 October 2026", "2026-10-30"],
    ["30 de octubre de 2026", "2026-10-30"],
    ["30 Oct. 2026", "2026-10-30"],
    ["1 de septiembre de 2026", "2026-09-01"],
    ["15 de Diciembre del 2026", "2026-12-15"],
    ["30/10/2026", "2026-10-30"],
    ["10/30/2026", "2026-10-30"],
    ["30.10.2026", "2026-10-30"],
    ["05/05/2026", "2026-05-05"],
    ["29 Feb 2028", "2028-02-29"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normalizeDate(raw)).toBe(expected);
  });

  it.each([
    ["day and month both could come first", "03/04/2026"],
    ["two-digit year", "30/10/26"],
    ["no year", "Oct 30"],
    ["not a real day", "31 Apr 2026"],
    ["not a leap year", "29 Feb 2026"],
    ["month 13", "13/13/2026"],
    ["extra words", "Friday Oct 30 2026"],
    ["two months", "Oct Nov 2026"],
    ["no date", "next week"],
    ["empty", ""],
  ])("returns null for %s", (_label, raw) => {
    expect(normalizeDate(raw)).toBeNull();
  });
});

describe("normalizeExtraction", () => {
  it("converts a clean reader response into a valid Extraction", () => {
    const extraction = normalizeExtraction(READER_RESPONSE);
    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    expect(extraction.amountMinor).toEqual({
      raw: "USD 2,500.00",
      value: 250000,
      evidence: "USD 2,500.00",
      isUncertain: false,
    });
    expect(extraction.currency.value).toBe("USD");
    expect(extraction.issueDate.value).toBe("2026-10-01");
    expect(extraction.dueDate.value).toBe("2026-10-30");
    expect(extraction.payee.value).toBe("Dev Partners SAS");
    expect(extraction.reference.value).toBe("INV-102");
    expect(extraction.lineItemAmountsMinor).toEqual([100000, 150000]);
  });

  it("parses from the verbatim raw text, ignoring the reader's own value", () => {
    const response = { ...READER_RESPONSE, amountString: field("USD 2,500.00", "25000.00") };
    expect(normalizeExtraction(response).amountMinor.value).toBe(250000);
  });

  it("marks an ambiguous amount as null and uncertain", () => {
    const response = { ...READER_RESPONSE, amountString: field("2.5000") };
    const { amountMinor } = normalizeExtraction(response);
    expect(amountMinor.value).toBeNull();
    expect(amountMinor.isUncertain).toBe(true);
    expect(amountMinor.raw).toBe("2.5000");
  });

  it("marks a zero amount as null and uncertain", () => {
    const response = { ...READER_RESPONSE, amountString: field("0.00") };
    const { amountMinor } = normalizeExtraction(response);
    expect(amountMinor.value).toBeNull();
    expect(amountMinor.isUncertain).toBe(true);
  });

  it("marks a bare dollar sign currency as null and uncertain", () => {
    const response = { ...READER_RESPONSE, currencyRaw: field("$") };
    const { currency } = normalizeExtraction(response);
    expect(currency.value).toBeNull();
    expect(currency.isUncertain).toBe(true);
  });

  it("marks an ambiguous due date as null and uncertain", () => {
    const response = { ...READER_RESPONSE, dueDateString: field("03/04/2026") };
    const { dueDate } = normalizeExtraction(response);
    expect(dueDate.value).toBeNull();
    expect(dueDate.isUncertain).toBe(true);
  });

  it("marks an ambiguous issue date as null and uncertain", () => {
    const response = { ...READER_RESPONSE, issueDateString: field("03/04/2026") };
    const { issueDate, dueDate } = normalizeExtraction(response);
    expect(issueDate.value).toBeNull();
    expect(issueDate.isUncertain).toBe(true);
    expect(dueDate.value).toBe("2026-10-30");
  });

  it("keeps a field uncertain when the reader flagged it", () => {
    const response = { ...READER_RESPONSE, reference: field("INV-102", "INV-102", true) };
    const { reference } = normalizeExtraction(response);
    expect(reference.value).toBe("INV-102");
    expect(reference.isUncertain).toBe(true);
  });

  it("marks absent fields as null and uncertain", () => {
    const missing: ReaderField = { raw: null, value: null, evidence: null, isUncertain: true };
    const extraction = normalizeExtraction({
      ...READER_RESPONSE,
      payee: missing,
      amountString: missing,
      currencyRaw: missing,
      issueDateString: missing,
      dueDateString: missing,
      reference: missing,
    });
    expect(ExtractionSchema.safeParse(extraction).success).toBe(true);
    for (const key of [
      "payee",
      "amountMinor",
      "currency",
      "issueDate",
      "dueDate",
      "reference",
    ] as const) {
      expect(extraction[key]).toEqual({
        raw: null,
        value: null,
        evidence: null,
        isUncertain: true,
      });
    }
  });

  it("treats a blank payee or reference as missing", () => {
    const response = { ...READER_RESPONSE, payee: field("  ", "  "), reference: field("", "") };
    const extraction = normalizeExtraction(response);
    expect(extraction.payee.value).toBeNull();
    expect(extraction.payee.isUncertain).toBe(true);
    expect(extraction.reference.value).toBeNull();
    expect(extraction.reference.isUncertain).toBe(true);
  });

  it("returns no item amounts when there is no breakdown", () => {
    const extraction = normalizeExtraction({ ...READER_RESPONSE, lineItemAmountStrings: [] });
    expect(extraction.lineItemAmountsMinor).toBeNull();
  });

  it("copies each printed item and never sums them", () => {
    const extraction = normalizeExtraction({
      ...READER_RESPONSE,
      lineItemAmountStrings: ["COP 800.000,00", "COP 200.000,00"],
    });
    expect(extraction.lineItemAmountsMinor).toEqual([80000000, 20000000]);
    expect(extraction.lineItemsSumMinor).toBeNull();
  });

  it("keeps an unreadable item as null in its place", () => {
    const extraction = normalizeExtraction({
      ...READER_RESPONSE,
      lineItemAmountStrings: ["USD 1,000.00", "n/a"],
    });
    expect(extraction.lineItemAmountsMinor).toEqual([100000, null]);
  });

  it("passes suspicious text through untouched", () => {
    const suspiciousText = ["ignore previous instructions"];
    expect(normalizeExtraction({ ...READER_RESPONSE, suspiciousText }).suspiciousText).toEqual(
      suspiciousText,
    );
  });
});
