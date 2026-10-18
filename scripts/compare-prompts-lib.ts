/**
 * Scoring for scripts/compare-prompts.ts. Pure functions, no I/O, so they are covered by tests.
 *
 * A field of an extraction lands in one bucket:
 *   correct            value equals the truth and the field is not uncertain
 *   uncertainExpected  uncertain or empty, and the document really is empty or ambiguous there (right call)
 *   uncertainExtra     uncertain or empty although the document is clear (over-cautious: costs autonomy)
 *   silentError        a value that is wrong and NOT flagged uncertain. The dangerous bucket: nothing
 *                      downstream tells a person to look at it.
 */
import type { Extraction } from "@/contracts/extraction";
import { normalizePayee } from "@/contracts/payee";
import { normalizeReference } from "@/contracts/reference";

export type TruthEntry = {
  file: string;
  payee: string;
  amountMinor: number | null;
  currency: string | null;
  dueDate: string | null;
  reference: string;
  lineItemsTotalMinor: number | null;
  suspiciousText: string[];
  ambiguousFields: string[];
};

// issueDate is not scored: extraction-truth.json does not carry it.
export const SCORED_FIELDS = ["payee", "amountMinor", "currency", "dueDate", "reference"] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

export const FIELD_BUCKETS = [
  "correct",
  "uncertainExpected",
  "uncertainExtra",
  "silentError",
] as const;
export type FieldBucket = (typeof FIELD_BUCKETS)[number];

export const LINE_ITEMS_BUCKETS = ["correct", "missing", "wrong"] as const;
export type LineItemsBucket = (typeof LINE_ITEMS_BUCKETS)[number];

export const SUSPICIOUS_BUCKETS = ["detected", "missed", "clean", "falsePositive"] as const;
export type SuspiciousBucket = (typeof SUSPICIOUS_BUCKETS)[number];

type FieldValue = string | number | null;

export type SilentError = {
  file: string;
  field: ScoredField;
  got: FieldValue;
  expected: FieldValue;
};

export type FileScore = {
  file: string;
  fields: Record<ScoredField, FieldBucket>;
  lineItems: LineItemsBucket;
  suspicious: SuspiciousBucket;
  ambiguity: { flagged: number; total: number };
  silentErrors: SilentError[];
};

// The truth names the amount "amount"; the extraction calls it amountMinor.
const TRUTH_AMBIGUOUS_NAME: Record<string, ScoredField> = {
  payee: "payee",
  amount: "amountMinor",
  amountMinor: "amountMinor",
  currency: "currency",
  dueDate: "dueDate",
  reference: "reference",
};

// Fields are compared the way the engine compares them, so "Corp." and "Corp" agree.
function sameValue(field: ScoredField, got: string | number, expected: string | number): boolean {
  if (field === "payee") return normalizePayee(String(got)) === normalizePayee(String(expected));
  if (field === "reference") {
    return normalizeReference(String(got)) === normalizeReference(String(expected));
  }
  return got === expected;
}

function scoreField(
  name: ScoredField,
  truth: TruthEntry,
  extraction: Extraction,
  ambiguous: ReadonlySet<ScoredField>,
): { bucket: FieldBucket; got: FieldValue; expected: FieldValue } {
  const expected = truth[name];
  const { value: got, isUncertain } = extraction[name];
  if (isUncertain || got === null) {
    const wasRightToDoubt = expected === null || ambiguous.has(name);
    return { bucket: wasRightToDoubt ? "uncertainExpected" : "uncertainExtra", got, expected };
  }
  const isCorrect = expected !== null && sameValue(name, got, expected);
  return { bucket: isCorrect ? "correct" : "silentError", got, expected };
}

// The reader copies each line item and the engine (R10) adds them up, so the sum is taken here too.
function scoreLineItems(truth: TruthEntry, extraction: Extraction): LineItemsBucket {
  const amounts = extraction.lineItemAmountsMinor ?? [];
  const expected = truth.lineItemsTotalMinor;
  if (expected === null) return amounts.length === 0 ? "correct" : "wrong";
  const readable = amounts.filter((amount): amount is number => amount !== null);
  if (amounts.length === 0 || readable.length !== amounts.length) return "missing";
  return readable.reduce((sum, amount) => sum + amount, 0) === expected ? "correct" : "wrong";
}

function scoreSuspicious(truth: TruthEntry, extraction: Extraction): SuspiciousBucket {
  const hasTruth = truth.suspiciousText.length > 0;
  const hasFound = extraction.suspiciousText.length > 0;
  if (hasTruth) return hasFound ? "detected" : "missed";
  return hasFound ? "falsePositive" : "clean";
}

export function scoreExtraction(truth: TruthEntry, extraction: Extraction): FileScore {
  const ambiguous = new Set(
    truth.ambiguousFields.flatMap((name) => TRUTH_AMBIGUOUS_NAME[name] ?? []),
  );
  const fields = {} as Record<ScoredField, FieldBucket>;
  const silentErrors: SilentError[] = [];
  for (const name of SCORED_FIELDS) {
    const { bucket, got, expected } = scoreField(name, truth, extraction, ambiguous);
    fields[name] = bucket;
    if (bucket === "silentError")
      silentErrors.push({ file: truth.file, field: name, got, expected });
  }
  const flagged = [...ambiguous].filter((name) => fields[name] === "uncertainExpected").length;
  return {
    file: truth.file,
    fields,
    lineItems: scoreLineItems(truth, extraction),
    suspicious: scoreSuspicious(truth, extraction),
    ambiguity: { flagged, total: ambiguous.size },
    silentErrors,
  };
}

export type VariantSummary = {
  variant: string;
  files: number;
  // Reads that failed even after the retry, and verifier reads that failed: both make fields uncertain.
  readFailures: number;
  verifierFailures: number;
  fields: Record<ScoredField, Record<FieldBucket, number>>;
  totals: Record<FieldBucket, number>;
  lineItems: Record<LineItemsBucket, number>;
  suspicious: Record<SuspiciousBucket, number>;
  ambiguity: { flagged: number; total: number };
  silentErrors: SilentError[];
};

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

export function summarizeVariant(
  variant: string,
  scores: readonly FileScore[],
  failures: { readFailures: number; verifierFailures: number },
): VariantSummary {
  const summary: VariantSummary = {
    variant,
    files: scores.length,
    ...failures,
    fields: Object.fromEntries(
      SCORED_FIELDS.map((name) => [name, zeroed(FIELD_BUCKETS)]),
    ) as VariantSummary["fields"],
    totals: zeroed(FIELD_BUCKETS),
    lineItems: zeroed(LINE_ITEMS_BUCKETS),
    suspicious: zeroed(SUSPICIOUS_BUCKETS),
    ambiguity: { flagged: 0, total: 0 },
    silentErrors: [],
  };
  for (const score of scores) {
    for (const name of SCORED_FIELDS) {
      summary.fields[name][score.fields[name]] += 1;
      summary.totals[score.fields[name]] += 1;
    }
    summary.lineItems[score.lineItems] += 1;
    summary.suspicious[score.suspicious] += 1;
    summary.ambiguity.flagged += score.ambiguity.flagged;
    summary.ambiguity.total += score.ambiguity.total;
    summary.silentErrors.push(...score.silentErrors);
  }
  return summary;
}

function uncertainCount(counts: Record<FieldBucket, number>): number {
  return counts.uncertainExpected + counts.uncertainExtra;
}

function show(value: FieldValue): string {
  return value === null ? "null" : `\`${String(value)}\``;
}

export function renderMarkdown(summaries: readonly VariantSummary[]): string {
  const lines: string[] = [];
  const first = summaries[0];
  const header = (title: string, columns: string[]) => {
    lines.push("", `### ${title}`, "", `| variant | ${columns.join(" | ")} |`);
    lines.push(`| --- | ${columns.map(() => "---").join(" | ")} |`);
  };

  lines.push(
    `Files: ${first?.files ?? 0}. Scored fields per file: ${SCORED_FIELDS.join(", ")}.`,
    "A silent error is a wrong value that is not flagged uncertain; it is the number that matters.",
  );

  header("All scored fields", [
    "correct",
    "uncertain, right call",
    "uncertain, over-cautious",
    "silent errors",
  ]);
  for (const s of summaries) {
    const t = s.totals;
    lines.push(
      `| ${s.variant} | ${t.correct} | ${t.uncertainExpected} | ${t.uncertainExtra} | ${t.silentError} |`,
    );
  }

  header(
    "By field (correct / uncertain / silent error)",
    SCORED_FIELDS.map((name) => name),
  );
  for (const s of summaries) {
    const cells = SCORED_FIELDS.map((name) => {
      const c = s.fields[name];
      return `${c.correct} / ${uncertainCount(c)} / ${c.silentError}`;
    });
    lines.push(`| ${s.variant} | ${cells.join(" | ")} |`);
  }

  header("Line items, suspicious text, ambiguity and failures", [
    "items ok / missing / wrong",
    "suspicious found / missed / false alarms",
    "ambiguous fields flagged",
    "read failures",
    "verifier failures",
  ]);
  for (const s of summaries) {
    const i = s.lineItems;
    const x = s.suspicious;
    lines.push(
      `| ${s.variant} | ${i.correct} / ${i.missing} / ${i.wrong} | ${x.detected} / ${x.missed} / ${x.falsePositive} | ${s.ambiguity.flagged} of ${s.ambiguity.total} | ${s.readFailures} | ${s.verifierFailures} |`,
    );
  }

  for (const s of summaries) {
    lines.push("", `### Silent errors: ${s.variant}`, "");
    if (s.silentErrors.length === 0) lines.push("None.");
    for (const e of s.silentErrors) {
      lines.push(`- ${e.file} ${e.field}: got ${show(e.got)}, expected ${show(e.expected)}`);
    }
  }
  return lines.join("\n");
}
