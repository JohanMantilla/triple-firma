import Anthropic from "@anthropic-ai/sdk";

// Reader uses Sonnet (vision + PDF native); verifier uses Haiku (cost-effective second read).
// Update these constants when new model versions are released.
export const READER_MODEL = "claude-sonnet-4-6" as const;
export const VERIFIER_MODEL = "claude-haiku-4-5" as const;

const TIMEOUT_MS = 30_000; // 30 s — enough for large PDFs; pipeline escalates on timeout
const MAX_RETRIES = 2; // SDK retries on 429 and 5xx with exponential backoff

// Interface used by reader and verifier so tests can inject a spy instead of hitting the API.
export type AnthropicClient = Pick<Anthropic, "messages">;

export function makeAnthropicClient(): AnthropicClient {
  return new Anthropic({
    timeout: TIMEOUT_MS,
    maxRetries: MAX_RETRIES,
  });
}
