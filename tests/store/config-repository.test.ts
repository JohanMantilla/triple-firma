import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { findCurrentRulesConfig, insertRulesConfig } from "@/store/config-repository";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("rules config versions", () => {
  it("has no config before the first save", async () => {
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });

  it("numbers every save and returns the latest one", async () => {
    const first = await insertRulesConfig(db, buildRulesConfig(), NOW);
    const second = await insertRulesConfig(
      db,
      buildRulesConfig({ approvalThresholdMinor: 150_000 }),
      "2026-10-17T15:00:00Z",
    );
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(await findCurrentRulesConfig(db)).toEqual(second);
  });

  it("never stores an invalid config", async () => {
    const invalid = buildRulesConfig({ approvalThresholdMinor: 0 });
    await expect(insertRulesConfig(db, invalid, NOW)).rejects.toThrow();
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });
});
