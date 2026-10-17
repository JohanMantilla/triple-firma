import type { Client } from "@libsql/client";
import type { RulesConfig, RulesConfigVersion } from "@/contracts/rules-config";
import { appendAuditEntry } from "@/store/audit-log";
import { insertRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";

// Every change creates a new version with its audit entry; the engine always reads the latest one.
export function saveRulesConfig(
  db: Client,
  config: RulesConfig,
  now: string,
): Promise<RulesConfigVersion> {
  return withWriteTransaction(db, async (tx) => {
    const saved = await insertRulesConfig(tx, config, now);
    await appendAuditEntry(
      tx,
      "RULES_CONFIG_CHANGE",
      { version: saved.version, config: saved.config },
      now,
    );
    return saved;
  });
}
