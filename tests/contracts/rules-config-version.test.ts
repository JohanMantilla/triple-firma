import { describe, expect, it } from "vitest";
import { RulesConfigVersionSchema } from "@/contracts/rules-config";
import { buildRulesConfig } from "./fixtures";

const VERSION = { version: 1, config: buildRulesConfig(), createdAt: "2026-10-17T14:00:00Z" };

describe("RulesConfigVersionSchema", () => {
  it("accepts a stored version of a valid config", () => {
    expect(RulesConfigVersionSchema.safeParse(VERSION).success).toBe(true);
  });

  it("rejects version 0", () => {
    expect(RulesConfigVersionSchema.safeParse({ ...VERSION, version: 0 }).success).toBe(false);
  });

  it("rejects a version whose config is invalid", () => {
    const config = buildRulesConfig({ approvalThresholdMinor: 0 });
    expect(RulesConfigVersionSchema.safeParse({ ...VERSION, config }).success).toBe(false);
  });
});
