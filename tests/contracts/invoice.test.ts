import { describe, expect, it } from "vitest";
import { InvoiceSchema } from "@/contracts/invoice";
import { buildExtraction, VALID_HASH } from "./fixtures";

describe("InvoiceSchema", () => {
  const invoice = {
    id: "inv-1",
    fileHash: VALID_HASH,
    sourceFormat: "PDF",
    receivedAt: "2026-10-17T13:00:00Z",
    extraction: buildExtraction(),
  };

  it("accepts a valid invoice", () => {
    expect(InvoiceSchema.safeParse(invoice).success).toBe(true);
  });

  it("rejects an unknown source format", () => {
    expect(InvoiceSchema.safeParse({ ...invoice, sourceFormat: "FAX" }).success).toBe(false);
  });
});
