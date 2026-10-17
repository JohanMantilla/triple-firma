import { describe, expect, it, vi } from "vitest";
import { READER_MODEL, VERIFIER_MODEL, makeAnthropicClient } from "@/extraction/anthropic-client";

describe("anthropic-client constants", () => {
  it("reader model is a non-empty string", () => {
    expect(typeof READER_MODEL).toBe("string");
    expect(READER_MODEL.length).toBeGreaterThan(0);
  });

  it("verifier model is a non-empty string", () => {
    expect(typeof VERIFIER_MODEL).toBe("string");
    expect(VERIFIER_MODEL.length).toBeGreaterThan(0);
  });

  it("reader and verifier are different models", () => {
    expect(READER_MODEL).not.toBe(VERIFIER_MODEL);
  });
});

describe("makeAnthropicClient", () => {
  it("returns a client with a messages API", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const client = makeAnthropicClient();
    expect(client.messages).toBeDefined();
    expect(typeof client.messages.create).toBe("function");
    vi.unstubAllEnvs();
  });
});
