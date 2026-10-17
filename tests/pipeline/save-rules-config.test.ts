import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb } from "../store/fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("saveRulesConfig", () => {
  it("creates a new version with its audit entry on every save", async () => {
    await saveRulesConfig(db, buildRulesConfig(), NOW);
    const second = await saveRulesConfig(
      db,
      buildRulesConfig({ approvalThresholdMinor: 150_000 }),
      NOW,
    );

    expect(second.version).toBe(2);
    expect((await findCurrentRulesConfig(db))?.config.approvalThresholdMinor).toBe(150_000);
    const { rows } = await db.execute(
      "SELECT type, json_extract(payload_json, '$.version') AS version FROM audit_entries ORDER BY seq",
    );
    expect(rows.map((row) => [row.type, row.version])).toEqual([
      ["RULES_CONFIG_CHANGE", 1],
      ["RULES_CONFIG_CHANGE", 2],
    ]);
  });

  it("stores nothing for an invalid config", async () => {
    const invalid = buildRulesConfig({ approvalThresholdMinor: 0 });
    await expect(saveRulesConfig(db, invalid, NOW)).rejects.toThrow();
    expect(await findCurrentRulesConfig(db)).toBeNull();
    expect(await countAuditEntries(db)).toBe(0);
  });
});
