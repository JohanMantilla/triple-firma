import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { toRulesConfig } from "./company-config";
import { saveRulesConfig } from "./save-rules-config";
import { detectSourceFormat, processInvoice } from "./process-invoice";
import { RULE_IDS } from "@/contracts/decision";
import type { Decision } from "@/contracts/decision";
import type { Invoice } from "@/contracts/invoice";
import type { RulesConfig } from "@/contracts/rules-config";
import { toPeriod } from "@/engine/rule-context";
import { insertDecision } from "@/store/decision-repository";
import { insertInvoice } from "@/store/invoice-repository";
import { openDb, resetDb } from "@/store/db";

type SeedPayment = {
  id: string;
  beneficiary: string;
  reference: string;
  amountMinor: number;
  currency: string;
  usdMinor: number;
  paidOn: string;
};

export type RunBatchInput = {
  partition: string;
  files: string[];
  configPath: string;
  seedPath: string;
  asOf: string;
};

export type RunBatchRecord = {
  file: string;
  decision: Decision["outcome"];
  results?: {
    rule: string;
    outcome: string;
    message: string;
    compared: Decision["ruleResults"][number]["compared"];
  }[];
  explanation?: string;
  error?: string;
};

const field = <T>(value: T) => ({
  raw: String(value),
  value,
  evidence: String(value),
  isUncertain: false,
});
const empty = { raw: null, value: null, evidence: null, isUncertain: false };

// Past payments of the seed become PAY decisions, so R2, R6 and R7 see them as history.
async function insertSeedPayment(
  db: Awaited<ReturnType<typeof openDb>>,
  payment: SeedPayment,
  config: RulesConfig,
): Promise<void> {
  const decidedAt = `${payment.paidOn}T12:00:00Z`;
  const invoice: Invoice = {
    id: `seed-${payment.id}`,
    fileHash: createHash("sha256").update(`seed:${payment.id}`).digest("hex"),
    sourceFormat: "PDF",
    sourceText: null,
    receivedAt: decidedAt,
    extraction: {
      payee: field(payment.beneficiary),
      amountMinor: field(payment.amountMinor),
      currency: field(payment.currency),
      issueDate: empty,
      dueDate: empty,
      reference: field(payment.reference),
      lineItemsSumMinor: null,
      suspiciousText: [],
    },
  };
  const decision: Decision = {
    id: `seed-decision-${payment.id}`,
    invoiceId: invoice.id,
    outcome: "PAY",
    ruleResults: RULE_IDS.map((ruleId) => ({
      ruleId,
      outcome: "PASS",
      message: "Pago previo del historial inicial",
      compared: {},
    })),
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    baseAmountMinor: payment.usdMinor,
    exchangeRate: config.exchangeRates[payment.currency as "USD"] ?? "1",
    explanation: "Pago previo del historial inicial",
    configVersion: 1,
    decidedAt,
  };
  await insertInvoice(db, {
    invoice,
    fileName: `seed/${payment.id}`,
    fileBytes: new Uint8Array(),
    extractionFailure: null,
  });
  await insertDecision(db, decision, toPeriod(decidedAt, config.timezone));
}

// The contract of data/README.md section 7: decide one partition in order, from the seed history, on a
// throwaway in-memory database (never the demo's). A failure on one file escalates it, never skips it.
export async function runBatch(input: RunBatchInput): Promise<RunBatchRecord[]> {
  const config = toRulesConfig(JSON.parse(await readFile(input.configPath, "utf8")));
  const seed: { payments: SeedPayment[] } = JSON.parse(await readFile(input.seedPath, "utf8"));
  const now = `${input.asOf}T15:00:00Z`;

  const db = await openDb(":memory:");
  await resetDb(db);
  await saveRulesConfig(db, config, now);
  for (const payment of seed.payments) await insertSeedPayment(db, payment, config);

  const records: RunBatchRecord[] = [];
  for (const file of input.files) {
    const name = path.basename(file);
    const sourceFormat = detectSourceFormat(name);
    try {
      if (sourceFormat === null) throw new Error("unsupported file type");
      const result = await processInvoice(
        db,
        { fileName: `${input.partition}/${name}`, fileBuffer: await readFile(file), sourceFormat },
        now,
      );
      if (!result.ok) throw new Error(result.reason);
      const { decision, extractionFailure } = result.record;
      records.push({
        file: name,
        decision: decision.outcome,
        results: decision.ruleResults.map((r) => ({
          rule: r.ruleId,
          outcome: r.outcome,
          message: r.message,
          compared: r.compared,
        })),
        explanation: decision.explanation,
        ...(extractionFailure === null ? {} : { error: extractionFailure }),
      });
    } catch (error) {
      records.push({ file: name, decision: "ESCALATE", error: String(error) });
    }
  }
  return records;
}
