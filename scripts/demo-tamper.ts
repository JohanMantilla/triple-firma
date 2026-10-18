import { openDb } from "@/store/db";
import { SCHEMA } from "@/store/schema";

// What someone with direct access to the database could do: drop the append-only guard, turn the first
// BLOCK decision of the log into PAY, and put the guard back. "Verificar integridad" then reports it.
async function main(): Promise<void> {
  const db = await openDb();
  const { rows } = await db.execute(
    `SELECT seq FROM audit_entries
     WHERE type = 'DECISION' AND json_extract(payload_json, '$.decision.outcome') = 'BLOCK'
     ORDER BY seq LIMIT 1`,
  );
  const target = rows[0];
  if (target === undefined) {
    console.log("No BLOCK decision in the audit log: run npm run demo first.");
    process.exitCode = 1;
    return;
  }

  await db.execute("DROP TRIGGER IF EXISTS audit_entries_no_update");
  await db.execute({
    sql: "UPDATE audit_entries SET payload_json = json_set(payload_json, '$.decision.outcome', 'PAY') WHERE seq = ?",
    args: [target.seq],
  });
  await db.executeMultiple(SCHEMA);
  console.log(
    `Audit entry ${target.seq} altered: BLOCK -> PAY. Press "Verificar integridad" in the UI.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
