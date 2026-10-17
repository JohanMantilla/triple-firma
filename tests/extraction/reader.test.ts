import { describe, expect, it, vi } from "vitest";
import type { AnthropicClient } from "@/extraction/anthropic-client";
import { READER_RESPONSE_JSON_SCHEMA } from "@/extraction/prompts/reader-v1";
import { READER_PROMPTS, readInvoice, type ReaderResponse } from "@/extraction/reader";

// ── Helpers ──────────────────────────────────────────────────────────────────

const FIELD = {
  raw: "Dev Partners SAS",
  value: "Dev Partners SAS",
  evidence: "From: Dev Partners SAS",
  isUncertain: false,
};

const VALID_RESPONSE: ReaderResponse = {
  payee: FIELD,
  amountString: {
    raw: "USD 2,500.00",
    value: "2500.00",
    evidence: "Total: USD 2,500.00",
    isUncertain: false,
  },
  currencyRaw: { raw: "USD", value: "USD", evidence: "Total: USD 2,500.00", isUncertain: false },
  issueDateString: {
    raw: "Oct 1, 2026",
    value: "2026-10-01",
    evidence: "Issued: Oct 1, 2026",
    isUncertain: false,
  },
  dueDateString: {
    raw: "Oct 30, 2026",
    value: "2026-10-30",
    evidence: "Due: Oct 30, 2026",
    isUncertain: false,
  },
  reference: { raw: "INV-102", value: "INV-102", evidence: "Invoice INV-102", isUncertain: false },
  lineItemsSumString: {
    raw: "USD 2,500.00",
    value: "2500.00",
    evidence: "Subtotal: USD 2,500.00",
    isUncertain: false,
  },
  suspiciousText: [],
};

function makeClient(responseText: string): AnthropicClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
        stop_reason: "end_turn",
      }),
    },
  } as unknown as AnthropicClient;
}

const PDF_BUFFER = Buffer.from("%PDF-1.4 fake content");
const IMAGE_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes

// ── Tests ────────────────────────────────────────────────────────────────────

describe("readInvoice — happy path", () => {
  it("returns ok:true with the parsed response for a PDF", async () => {
    const client = makeClient(JSON.stringify(VALID_RESPONSE));
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result).toMatchObject({ ok: true, response: VALID_RESPONSE });
  });

  it("returns ok:true for an IMAGE source format", async () => {
    const client = makeClient(JSON.stringify(VALID_RESPONSE));
    const result = await readInvoice(client, IMAGE_BUFFER, "IMAGE", null);
    expect(result).toMatchObject({ ok: true });
  });

  it("returns ok:true for an EMAIL using sourceText", async () => {
    const client = makeClient(JSON.stringify(VALID_RESPONSE));
    const result = await readInvoice(client, Buffer.alloc(0), "EMAIL", "Invoice body text");
    expect(result).toMatchObject({ ok: true });
  });

  it("accepts a null lineItemsSumString", async () => {
    const response = { ...VALID_RESPONSE, lineItemsSumString: null };
    const client = makeClient(JSON.stringify(response));
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result).toMatchObject({ ok: true, response: { lineItemsSumString: null } });
  });

  it("reads an empty evidence as absent", async () => {
    const response = { ...VALID_RESPONSE, payee: { ...FIELD, evidence: "" } };
    const client = makeClient(JSON.stringify(response));
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result).toMatchObject({ ok: true, response: { payee: { evidence: null } } });
  });
});

describe("READER_RESPONSE_JSON_SCHEMA", () => {
  // The API rejects a structured-output schema with more than 16 union (anyOf) parameters.
  it("stays within the API limit of 16 union parameters", () => {
    const unions = JSON.stringify(READER_RESPONSE_JSON_SCHEMA).match(/"anyOf"/g) ?? [];
    expect(unions.length).toBeLessThanOrEqual(16);
  });
});

describe("readInvoice — prompt version", () => {
  function systemPromptSent(client: AnthropicClient): unknown {
    const create = client.messages.create as unknown as ReturnType<typeof vi.fn>;
    return create.mock.calls[0]?.[0]?.system;
  }

  it("uses prompt v1 by default", async () => {
    const client = makeClient(JSON.stringify(VALID_RESPONSE));
    await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(systemPromptSent(client)).toBe(READER_PROMPTS.v1);
  });

  it("uses prompt v2 when asked", async () => {
    const client = makeClient(JSON.stringify(VALID_RESPONSE));
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null, "v2");
    expect(result.ok).toBe(true);
    expect(systemPromptSent(client)).toBe(READER_PROMPTS.v2);
  });

  it("keeps the two versions distinct", () => {
    expect(READER_PROMPTS.v2).not.toBe(READER_PROMPTS.v1);
  });
});

describe("readInvoice — failure cases", () => {
  it("returns ok:false when the LLM returns invalid JSON", async () => {
    const client = makeClient("not valid json {{{");
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Reader error/);
  });

  it("returns ok:false when the JSON does not match the schema", async () => {
    const client = makeClient(JSON.stringify({ unexpected: "shape" }));
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/schema validation/);
  });

  it("returns ok:false when the LLM returns no text block", async () => {
    const client: AnthropicClient = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [], stop_reason: "end_turn" }),
      },
    } as unknown as AnthropicClient;
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no text block/);
  });

  it("returns ok:false when the API throws", async () => {
    const client: AnthropicClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("API timeout")),
      },
    } as unknown as AnthropicClient;
    const result = await readInvoice(client, PDF_BUFFER, "PDF", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("API timeout");
  });
});
