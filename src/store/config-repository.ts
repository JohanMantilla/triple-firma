import { IsoDateTimeSchema } from "@/contracts/dates";
import {
  type RulesConfig,
  RulesConfigSchema,
  type RulesConfigVersion,
  RulesConfigVersionSchema,
} from "@/contracts/rules-config";
import type { Executor } from "./db";

export async function findCurrentRulesConfig(db: Executor): Promise<RulesConfigVersion | null> {
  const { rows } = await db.execute(
    "SELECT version, config_json, created_at FROM config_versions ORDER BY version DESC LIMIT 1",
  );
  const row = rows[0];
  if (row === undefined) return null;
  return RulesConfigVersionSchema.parse({
    version: row.version,
    config: JSON.parse(String(row.config_json)),
    createdAt: row.created_at,
  });
}

// SQLite assigns the next version (INTEGER PRIMARY KEY). Run it inside the caller's write transaction.
export async function insertRulesConfig(
  db: Executor,
  config: RulesConfig,
  createdAt: string,
): Promise<RulesConfigVersion> {
  const validConfig = RulesConfigSchema.parse(config);
  const validCreatedAt = IsoDateTimeSchema.parse(createdAt);
  const { rows } = await db.execute({
    sql: "INSERT INTO config_versions (config_json, created_at) VALUES (?, ?) RETURNING version",
    args: [JSON.stringify(validConfig), validCreatedAt],
  });
  return RulesConfigVersionSchema.parse({
    version: rows[0]?.version,
    config: validConfig,
    createdAt: validCreatedAt,
  });
}
