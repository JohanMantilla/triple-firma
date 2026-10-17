import type { Decision, DecisionOutcome } from "@/contracts/decision";
import type { DecisionRecord } from "@/contracts/decision-record";
import {
  type ExpectedDecision,
  ExpectedDecisionSchema,
  type Metrics,
  MetricsSchema,
} from "@/contracts/metrics";

const EXPECTED_HEADER = "file,expected_outcome,expected_rules";
const AUTONOMOUS_OUTCOMES: readonly DecisionOutcome[] = ["PAY", "BLOCK"];

type Measured = { expected: ExpectedDecision; decision: Decision };

// data/expected.csv, written by hand by C. It tolerates what spreadsheets add (BOM, CRLF, blank lines,
// spaces). ponytail: plain comma split, since no field contains a comma; use a CSV parser if one ever
// needs quoting.
export function parseExpectedCsv(text: string): ExpectedDecision[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const [header, ...rows] = lines.filter((line) => line.trim() !== "");
  if (header === undefined) return [];
  if (header.replace(/\s/g, "") !== EXPECTED_HEADER) {
    throw new Error(`expected.csv header must be "${EXPECTED_HEADER}"`);
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const [fileName = "", expectedOutcome, rules = "", ...extra] = row
      .split(",")
      .map((field) => field.trim());
    if (extra.length > 0) throw new Error(`expected.csv line ${index + 2}: too many fields`);
    if (seen.has(fileName)) throw new Error(`expected.csv lists ${fileName} twice`);
    seen.add(fileName);
    return ExpectedDecisionSchema.parse({
      fileName,
      expectedOutcome,
      expectedRuleIds: rules === "" ? [] : rules.split(";").map((ruleId) => ruleId.trim()),
    });
  });
}

// The automatic decision against what C expected (PROPUESTA section 5): never the human approval.
// Expected files with no stored decision (for example a byte-identical resend, which returns the
// original record) are listed in missingFiles and left out of every rate.
export function computeMetrics(
  records: readonly DecisionRecord[],
  expected: readonly ExpectedDecision[],
): Metrics {
  const byFile = new Map(records.map((record) => [record.fileName, record.decision]));
  const measured: Measured[] = expected.flatMap((row) => {
    const decision = byFile.get(row.fileName);
    return decision === undefined ? [] : [{ expected: row, decision }];
  });
  const autonomous = measured.filter(({ expected: row }) =>
    AUTONOMOUS_OUTCOMES.includes(row.expectedOutcome),
  );
  const leakFiles = measured
    .filter(
      ({ expected: row, decision }) => decision.outcome === "PAY" && row.expectedOutcome !== "PAY",
    )
    .map(({ expected: row }) => row.fileName);

  return MetricsSchema.parse({
    total: measured.length,
    leaks: leakFiles.length,
    leakFiles,
    missingFiles: expected.filter((row) => !byFile.has(row.fileName)).map((row) => row.fileName),
    accuracy: rate(measured.filter(isCorrect).length, measured.length),
    autonomy: rate(autonomous.filter(isCorrect).length, autonomous.length),
    overEscalation: rate(
      autonomous.filter(({ decision }) => decision.outcome === "ESCALATE").length,
      autonomous.length,
    ),
    explainability: rate(
      measured.filter(({ decision }) => isExplained(decision)).length,
      measured.length,
    ),
    ruleMatchRate: rate(measured.filter(firesExpectedRules).length, measured.length),
  });
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function isCorrect({ expected: row, decision }: Measured): boolean {
  return decision.outcome === row.expectedOutcome;
}

// Explained when every rule that did not pass shows the values it compared, and its message is in the
// explanation a person reads.
function isExplained(decision: Decision): boolean {
  return decision.ruleResults
    .filter((result) => result.outcome !== "PASS")
    .every(
      (result) =>
        Object.keys(result.compared).length > 0 && decision.explanation.includes(result.message),
    );
}

function firesExpectedRules({ expected: row, decision }: Measured): boolean {
  const fired = new Set(
    decision.ruleResults
      .filter((result) => result.outcome !== "PASS")
      .map((result) => result.ruleId),
  );
  return row.expectedRuleIds.every((ruleId) => fired.has(ruleId));
}
