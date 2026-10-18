import { DATASET_NOW, processInvoiceSet, readCompanyConfig } from "@/pipeline/dataset";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { verifyAuditChain } from "@/store/audit-log";
import { openDb, resetDb } from "@/store/db";

const DEMO_SETS = ["dev", "adversarial"] as const;

// npm run demo resets YOUR database (TURSO_DATABASE_URL), loads the company rules and decides the dev
// and adversarial sets from the extraction cache. npm run demo:live (--live) also calls the model on a
// cache miss and fills data/cache; without --live no tokens are spent.
async function main(): Promise<void> {
  const isLive = process.argv.includes("--live");
  // With no key the reader fails on a cache miss, so that invoice escalates instead of being read.
  if (!isLive) {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ANTHROPIC_BASE_URL;
  }

  const url = process.env.TURSO_DATABASE_URL;
  if (url) console.log(`Resetting database: ${url.startsWith("file:") ? url : new URL(url).host}`);
  const db = await openDb();
  await resetDb(db);
  await saveRulesConfig(db, await readCompanyConfig(), DATASET_NOW);

  const counts = { PAY: 0, BLOCK: 0, ESCALATE: 0 };
  for (const set of DEMO_SETS) {
    for (const { fileName, result } of await processInvoiceSet(db, set, DATASET_NOW)) {
      if (!result.ok) {
        console.log(`SKIPPED   ${fileName}: ${result.reason}`);
        continue;
      }
      const { decision, extractionFailure } = result.record;
      if (result.isResubmission) {
        console.log(`SAME FILE ${fileName}: already decided as ${result.record.fileName}`);
        continue;
      }
      counts[decision.outcome] += 1;
      const failure =
        extractionFailure === null ? "" : `  (extraction failed: ${extractionFailure})`;
      console.log(`${decision.outcome.padEnd(9)} ${fileName}${failure}`);
    }
  }

  const chain = await verifyAuditChain(db);
  console.log(`\nPAY ${counts.PAY} · BLOCK ${counts.BLOCK} · ESCALATE ${counts.ESCALATE}`);
  console.log(
    chain.isValid
      ? `Audit chain valid: ${chain.entryCount} entries, last hash ${chain.lastHash}`
      : `Audit chain BROKEN at entry ${chain.firstInvalidSeq}`,
  );
  console.log("\nOpen http://localhost:3000");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
