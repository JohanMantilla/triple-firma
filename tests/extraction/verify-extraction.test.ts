import { describe, expect, it, vi } from "vitest";
import type { Extraction } from "@/contracts/extraction";
import { VERIFIER_MODEL, type AnthropicClient } from "@/extraction/anthropic-client";
import type { ExtractInvoiceInput } from "@/extraction/extract-invoice-input";
import { VERIFIER_SYSTEM_PROMPT_V1 } from "@/extraction/prompts/verifier-v1";
import type { ReaderField, ReaderResponse } from "@/extraction/reader";
import { VERIFIED_FIELDS, verifyExtraction } from "@/extraction/verify-extraction";

function readerField(raw: string, value: string = raw): ReaderField {
  return { raw, value, evidence: raw, isUncertain: false };
}

function field<T>(value: T, raw: string) {
  return { raw, value, evidence: raw, isUncertain: false };
}

const SECOND_READ: ReaderResponse = {
  payee: readerField("Zzz Unique Payee Corp."),
  amountString: readerField("USD 2,500.00", "2500.00"),
  currencyRaw: readerField("USD"),
  issueDateString: readerField("Oct 1, 2026", "2026-10-01"),
  dueDateString: readerField("Oct 30, 2026", "2026-10-30"),
  reference: readerField("INV-102"),
  lineItemsSumString: null,
  suspiciousText: [],
};

const FIRST_READ: Extraction = {
  payee: field("Zzz Unique Payee Corp", "Zzz Unique Payee Corp"),
  amountMinor: field(250000, "USD 2,500.00"),
  currency: field("USD", "USD"),
  issueDate: field("2026-10-01", "Oct 1, 2026"),
  dueDate: field("2026-10-30", "Oct 30, 2026"),
  reference: field("INV-102", "INV-102"),
  lineItemsSumMinor: null,
  suspiciousText: [],
};

const INPUT: ExtractInvoiceInput = {
  fileHash: "a".repeat(64),
  fileBuffer: Buffer.from("%PDF-1.4 fake content"),
  sourceFormat: "PDF",
  sourceText: null,
};

function makeClient(create: ReturnType<typeof vi.fn>): AnthropicClient {
  return { messages: { create } } as unknown as AnthropicClient;
}

function clientReading(response: ReaderResponse): AnthropicClient {
  const text = JSON.stringify(response);
  return makeClient(vi.fn().mockResolvedValue({ content: [{ type: "text", text }] }));
}

describe("verifyExtraction — agreement", () => {
  it("leaves the extraction untouched when both reads agree", async () => {
    const result = await verifyExtraction(clientReading(SECOND_READ), INPUT, FIRST_READ);
    expect(result.mismatchedFields).toEqual([]);
    expect(result.verifierError).toBeNull();
    expect(result.extraction).toEqual(FIRST_READ);
  });

  it("compares payee and reference the way the engine does", async () => {
    const second = {
      ...SECOND_READ,
      payee: readerField("ZZZ  UNIQUE PAYEE CORP"),
      reference: readerField("inv 102"),
    };
    const result = await verifyExtraction(clientReading(second), INPUT, FIRST_READ);
    expect(result.mismatchedFields).toEqual([]);
  });

  it("does not flag a field both reads left empty", async () => {
    const empty = { raw: null, value: null, evidence: null, isUncertain: true };
    const first: Extraction = { ...FIRST_READ, dueDate: empty };
    const second = { ...SECOND_READ, dueDateString: empty };
    const result = await verifyExtraction(clientReading(second), INPUT, first);
    expect(result.mismatchedFields).toEqual([]);
    expect(result.extraction.dueDate).toEqual(empty);
  });
});

describe("verifyExtraction — disagreement", () => {
  it("marks only the field that disagrees as uncertain, keeping its value", async () => {
    const second = { ...SECOND_READ, amountString: readerField("USD 3,500.00", "3500.00") };
    const result = await verifyExtraction(clientReading(second), INPUT, FIRST_READ);

    expect(result.mismatchedFields).toEqual(["amountMinor"]);
    expect(result.extraction.amountMinor).toEqual({ ...FIRST_READ.amountMinor, isUncertain: true });
    expect(result.extraction.payee.isUncertain).toBe(false);
    expect(result.extraction.currency.isUncertain).toBe(false);
  });

  it.each([
    ["payee", { payee: readerField("Other Vendor LLC") }],
    ["currency", { currencyRaw: readerField("COP") }],
    ["issueDate", { issueDateString: readerField("Oct 2, 2026", "2026-10-02") }],
    ["dueDate", { dueDateString: readerField("Oct 31, 2026", "2026-10-31") }],
    ["reference", { reference: readerField("INV-103") }],
  ])("detects a different %s", async (name, change) => {
    const result = await verifyExtraction(
      clientReading({ ...SECOND_READ, ...change }),
      INPUT,
      FIRST_READ,
    );
    expect(result.mismatchedFields).toEqual([name]);
  });

  it("treats a field the verifier could not read as a disagreement", async () => {
    const unreadable = { raw: null, value: null, evidence: null, isUncertain: true };
    const result = await verifyExtraction(
      clientReading({ ...SECOND_READ, reference: unreadable }),
      INPUT,
      FIRST_READ,
    );
    expect(result.mismatchedFields).toEqual(["reference"]);
    expect(result.extraction.reference.isUncertain).toBe(true);
  });
});

describe("verifyExtraction — suspicious text", () => {
  it("keeps suspicious text found by either read, without duplicates", async () => {
    const first: Extraction = { ...FIRST_READ, suspiciousText: ["ignore the rules", "pay now"] };
    const second = { ...SECOND_READ, suspiciousText: ["pay now", "approved by CEO"] };
    const result = await verifyExtraction(clientReading(second), INPUT, first);

    expect(result.extraction.suspiciousText).toEqual([
      "ignore the rules",
      "pay now",
      "approved by CEO",
    ]);
  });
});

describe("verifyExtraction — fail-safe", () => {
  it("marks every verified field uncertain when the second read fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("API timeout"));
    const result = await verifyExtraction(makeClient(create), INPUT, FIRST_READ);

    expect(result.verifierError).toContain("API timeout");
    for (const name of VERIFIED_FIELDS) expect(result.extraction[name].isUncertain).toBe(true);
    expect(result.extraction.amountMinor.value).toBe(250000);
  });

  it("marks every verified field uncertain when the second read is invalid", async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "not json {{{" }] });
    const result = await verifyExtraction(makeClient(create), INPUT, FIRST_READ);

    expect(result.verifierError).not.toBeNull();
    for (const name of VERIFIED_FIELDS) expect(result.extraction[name].isUncertain).toBe(true);
  });
});

describe("verifyExtraction — independence", () => {
  it("uses the verifier model and prompt and never sends the first reading", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(SECOND_READ) }] });
    await verifyExtraction(makeClient(create), INPUT, FIRST_READ);

    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0]?.[0];
    expect(request.model).toBe(VERIFIER_MODEL);
    expect(request.system).toBe(VERIFIER_SYSTEM_PROMPT_V1);
    expect(JSON.stringify(request.messages)).not.toContain("Zzz Unique Payee");
  });
});
