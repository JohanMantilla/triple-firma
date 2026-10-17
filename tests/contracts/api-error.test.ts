import { describe, expect, it } from "vitest";
import { ApiErrorSchema } from "@/contracts/api-error";

describe("ApiErrorSchema", () => {
  it("accepts a known code with the invalid fields", () => {
    const body = { error: "INVALID_REQUEST", issues: [{ path: "timezone", message: "Required" }] };
    expect(ApiErrorSchema.safeParse(body).success).toBe(true);
  });

  it("rejects free text instead of a code", () => {
    expect(ApiErrorSchema.safeParse({ error: "Algo salió mal" }).success).toBe(false);
  });
});
