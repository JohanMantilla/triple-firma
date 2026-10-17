import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { findCurrentRulesConfig, insertRulesConfig } from "@/store/config-repository";
import { openDb, resetDb, withWriteTransaction } from "@/store/db";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb, openTempFileDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openDb", () => {
  it("refuses to start without a database URL instead of falling back to a local file", async () => {
    vi.stubEnv("TURSO_DATABASE_URL", "");
    await expect(openDb()).rejects.toThrow("TURSO_DATABASE_URL is not set");
  });
});

describe("withWriteTransaction", () => {
  it("commits what the function wrote", async () => {
    await withWriteTransaction(db, (tx) => insertRulesConfig(tx, buildRulesConfig(), NOW));
    expect((await findCurrentRulesConfig(db))?.version).toBe(1);
  });

  it("rolls back everything when the function throws", async () => {
    const failing = withWriteTransaction(db, async (tx) => {
      await insertRulesConfig(tx, buildRulesConfig(), NOW);
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });

  it("runs concurrent write transactions one after another on a local file", async () => {
    const fileDb = await openTempFileDb();
    const saved = await Promise.all(
      [1, 2, 3].map(() =>
        withWriteTransaction(fileDb, (tx) => insertRulesConfig(tx, buildRulesConfig(), NOW)),
      ),
    );
    expect(saved.map((version) => version.version).sort()).toEqual([1, 2, 3]);
  });
});

describe("resetDb", () => {
  it("erases every table and leaves the schema ready", async () => {
    await insertRulesConfig(db, buildRulesConfig(), NOW);
    await resetDb(db);
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });
});
