import { afterEach, describe, expect, it, vi } from "vitest";
import { requireHumanKey } from "@/app/api/require-human-key";

const request = (key?: string) =>
  new Request("http://localhost/api/config", {
    method: "PUT",
    headers: key === undefined ? {} : { "x-api-key": key },
  });

describe("requireHumanKey", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the right key and refuses a missing or wrong one", async () => {
    vi.stubEnv("HUMAN_ACTIONS_KEY", "s3cret");
    expect(requireHumanKey(request("s3cret"))).toBeNull();
    for (const sent of [undefined, "", "wrong", "S3CRET"]) {
      const denied = requireHumanKey(request(sent));
      expect(denied?.status).toBe(401);
      expect(await denied?.json()).toEqual({ error: "UNAUTHORIZED" });
    }
  });

  it("stays open in development when no key is configured", () => {
    vi.stubEnv("HUMAN_ACTIONS_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(requireHumanKey(request())).toBeNull();
  });

  it("refuses in production when no key is configured", () => {
    vi.stubEnv("HUMAN_ACTIONS_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(requireHumanKey(request())?.status).toBe(401);
    expect(requireHumanKey(request(""))?.status).toBe(401);
  });
});
