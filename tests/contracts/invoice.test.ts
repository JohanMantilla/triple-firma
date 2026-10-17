import { describe, expect, it } from "vitest";
import { InvoiceSchema } from "@/contracts/invoice";
import { buildExtraction, VALID_HASH } from "./fixtures";

describe("InvoiceSchema", () => {
  const invoice = {
    id: "inv-1",
    fileHash: VALID_HASH,
    sourceFormat: "PDF",
    sourceText: null,
    receivedAt: "2026-10-17T13:00:00Z",
    extraction: buildExtraction(),
  };

  it("accepts a PDF without source text", () => {
    expect(InvoiceSchema.safeParse(invoice).success).toBe(true);
  });

  it.each(["EMAIL", "CHAT"])("accepts a %s with its source text", (sourceFormat) => {
    const withText = { ...invoice, sourceFormat, sourceText: "Hola, adjunto la cuenta de cobro." };
    expect(InvoiceSchema.safeParse(withText).success).toBe(true);
  });

  it.each(["EMAIL", "CHAT"])(
    "rejects a %s without source text, so R10 can always scan it",
    (sourceFormat) => {
      expect(InvoiceSchema.safeParse({ ...invoice, sourceFormat }).success).toBe(false);
    },
  );

  it.each([
    ["EMAIL", ""],
    ["EMAIL", "  \n\t "],
    ["CHAT", ""],
  ])("rejects a %s with empty source text %j", (sourceFormat, sourceText) => {
    expect(InvoiceSchema.safeParse({ ...invoice, sourceFormat, sourceText }).success).toBe(false);
  });

  it("rejects an invoice that omits sourceText instead of setting it to null", () => {
    const { sourceText: _omitted, ...withoutText } = invoice;
    expect(InvoiceSchema.safeParse(withoutText).success).toBe(false);
  });

  it("rejects an oversized source text", () => {
    const huge = { ...invoice, sourceFormat: "EMAIL", sourceText: "x".repeat(200_001) };
    expect(InvoiceSchema.safeParse(huge).success).toBe(false);
  });

  it("rejects an unknown source format", () => {
    expect(InvoiceSchema.safeParse({ ...invoice, sourceFormat: "FAX" }).success).toBe(false);
  });
});
