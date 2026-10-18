/**
 * Lógica pura del evaluador (sin I/O de red ni dependencias externas).
 * Rol C. Solo Node built-ins; sintaxis "borrable" para que corra con `tsx` o con Node >= 22.18.
 *
 * Definiciones (propuesta Triple Firma §5):
 *  - Fuga           : el sistema decidió PAGAR cuando lo esperado era FRENAR o ESCALAR. Meta = 0. DESCALIFICANTE.
 *  - Exactitud      : decisiones == esperado / total.
 *  - Autonomía      : de las facturas con esperado PAGAR o FRENAR, cuántas decidió bien el sistema.
 *  - Sobreescalación: ESCALAR cuando lo esperado era PAGAR o FRENAR (cuesta autonomía, no seguridad).
 *  - Explicabilidad : % de decisiones cuyo registro cita regla(s) decisoria(s) con mensaje y valores comparados.
 */

export type Decision = "PAGAR" | "FRENAR" | "ESCALAR";
export const DECISIONS: Decision[] = ["PAGAR", "FRENAR", "ESCALAR"];
export const PARTITIONS = ["dev", "adversarial", "holdout"] as const;
export type Partition = (typeof PARTITIONS)[number];

export interface RuleResultIn {
  rule: string; // "R1".."R10"
  outcome: string; // PASS | ESCALATE | BLOCK  (también se aceptan PAGAR/ESCALAR/FRENAR)
  message?: string;
  compared?: Record<string, unknown>;
}

/** Lo que el pipeline del equipo debe devolver por cada factura. */
export interface DecisionRecord {
  file: string; // "dev/dev-01.pdf" o solo "dev-01.pdf"
  decision: string; // PAY|BLOCK|ESCALATE o PAGAR|FRENAR|ESCALAR
  results?: RuleResultIn[];
  explanation?: string;
  ms?: number;
  tokens?: number;
  error?: string;
}

export interface ExpectedRow {
  file: string;
  partition: Partition;
  decision: Decision;
  rules: string[];
  justification: string;
}

// ----------------------------------------------------------------------------
// CSV
// ----------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function normalizeDecision(v: unknown): Decision | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toUpperCase();
  if (s === "PAGAR" || s === "PAY" || s === "PAGO" || s === "PAID") return "PAGAR";
  if (s === "FRENAR" || s === "BLOCK" || s === "BLOCKED" || s === "FRENO") return "FRENAR";
  if (s === "ESCALAR" || s === "ESCALATE" || s === "ESCALATED") return "ESCALAR";
  return null;
}

export function partitionOf(file: string): Partition {
  const f = file.replace(/\\/g, "/");
  if (f.startsWith("dev/") || basename(f).startsWith("dev-")) return "dev";
  if (f.startsWith("adversarial/") || basename(f).startsWith("adv-")) return "adversarial";
  if (f.startsWith("holdout/") || basename(f).startsWith("holdout-")) return "holdout";
  throw new Error(`No puedo deducir la partición de "${file}"`);
}

export function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

/**
 * expected.csv usa el formato que lee el pipeline (/api/metrics): file,expected_outcome,expected_rules,
 * con reglas separadas por ";". Las justificaciones viven aparte (expected-justifications.csv:
 * file,justification) porque el pipeline rechaza columnas de más.
 */
export function loadJustifications(csvText: string): Map<string, string> {
  const [header = [], ...rows] = parseCsv(csvText);
  const cols = header.map((h) => h.trim().toLowerCase());
  const iFile = cols.indexOf("file");
  const iJust = cols.indexOf("justification");
  if (iFile < 0 || iJust < 0)
    throw new Error(`justificaciones: se esperan las columnas "file,justification"`);
  return new Map(rows.map((r) => [(r[iFile] ?? "").trim(), (r[iJust] ?? "").trim()]));
}

export function loadExpected(csvText: string, justificationsText = ""): ExpectedRow[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error("expected.csv está vacío");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0)
      throw new Error(`expected.csv: falta la columna "${name}" (columnas: ${header.join(", ")})`);
    return i;
  };
  const iFile = idx("file");
  const iDec = idx("expected_outcome");
  const iRules = idx("expected_rules");
  const justifications = justificationsText ? loadJustifications(justificationsText) : new Map();
  const out: ExpectedRow[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, n) => {
    const file = (r[iFile] ?? "").trim();
    const decision = normalizeDecision(r[iDec]);
    if (!file) throw new Error(`expected.csv fila ${n + 2}: archivo vacío`);
    if (!decision)
      throw new Error(`expected.csv fila ${n + 2} (${file}): decisión inválida "${r[iDec]}"`);
    if (seen.has(file)) throw new Error(`expected.csv: archivo repetido ${file}`);
    seen.add(file);
    const rules = (r[iRules] ?? "")
      .split(/[|;\s]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    out.push({
      file,
      partition: partitionOf(file),
      decision,
      rules,
      justification: justifications.get(file) ?? "",
    });
  });
  return out;
}

// ----------------------------------------------------------------------------
// Evaluación
// ----------------------------------------------------------------------------
const PASS_WORDS = new Set(["PASS", "PASA", "OK"]);

function outcomeLevel(outcome: string): "PASS" | "ESCALATE" | "BLOCK" | "UNKNOWN" {
  const s = String(outcome ?? "")
    .trim()
    .toUpperCase();
  if (PASS_WORDS.has(s)) return "PASS";
  if (s === "ESCALATE" || s === "ESCALAR") return "ESCALATE";
  if (s === "BLOCK" || s === "FRENAR") return "BLOCK";
  return "UNKNOWN";
}

/** Reglas que NO pasaron, en mayúsculas ("R5"). */
export function firedRules(results: RuleResultIn[] | undefined): string[] {
  if (!results) return [];
  return results
    .filter((r) => outcomeLevel(r.outcome) !== "PASS")
    .map((r) => String(r.rule).trim().toUpperCase());
}

/**
 * Explicabilidad automática: ¿una persona puede entender el porqué leyendo SOLO el registro?
 *  - Debe haber texto (explicación o mensajes).
 *  - Debe haber al menos una regla decisoria: para FRENAR las BLOCK; para ESCALAR las ESCALATE;
 *    para PAGAR, al menos una regla evaluada (todas en PASS).
 *  - Cada regla decisoria debe traer `message` (>= 10 caracteres) y `compared` con al menos un valor.
 */
export function isExplained(rec: DecisionRecord | undefined, decision: Decision | null): boolean {
  if (!rec || !decision) return false;
  const results = rec.results ?? [];
  const text = [rec.explanation ?? "", ...results.map((r) => r.message ?? "")].join(" ").trim();
  if (text.length < 15) return false;
  let deciding: RuleResultIn[];
  if (decision === "PAGAR") deciding = results;
  else if (decision === "FRENAR")
    deciding = results.filter((r) => outcomeLevel(r.outcome) === "BLOCK");
  else {
    deciding = results.filter((r) => outcomeLevel(r.outcome) === "ESCALATE");
    if (deciding.length === 0)
      deciding = results.filter((r) => outcomeLevel(r.outcome) === "BLOCK");
  }
  if (deciding.length === 0) return false;
  return deciding.every(
    (r) =>
      (r.message ?? "").trim().length >= 10 &&
      r.compared &&
      typeof r.compared === "object" &&
      Object.keys(r.compared).length > 0,
  );
}

export interface RowEval {
  file: string;
  partition: Partition;
  expected: Decision;
  actual: Decision | null;
  correct: boolean;
  leak: boolean;
  overEscalated: boolean; // ESCALAR cuando se esperaba PAGAR/FRENAR
  blockedInsteadOfEscalated: boolean; // FRENAR cuando se esperaba ESCALAR
  missing: boolean;
  expectedRules: string[];
  firedRules: string[] | null; // null si el pipeline no devolvió `results`
  rulesOk: boolean | null;
  explained: boolean;
  explanation: string;
  justification: string;
  error?: string;
  ms?: number;
  tokens?: number;
}

export interface Ratio {
  num: number;
  den: number;
}

export interface Metrics {
  total: number;
  correct: number;
  accuracy: Ratio;
  leaks: number;
  leakFiles: string[];
  autonomy: Ratio;
  overEscalation: Ratio; // sobre expected ∈ {PAGAR, FRENAR}
  blockedInsteadOfEscalated: number;
  missing: number;
  explainability: Ratio;
  rulesMatch: Ratio; // solo filas con reglas esperadas y `results` devuelto
  avgMs: number | null;
  totalTokens: number | null;
  matrix: Record<Decision, Record<Decision | "SIN_DECISION", number>>;
}

export interface EvalResult {
  rows: RowEval[];
  metrics: Metrics;
  extras: string[]; // decisiones devueltas para archivos que no están en expected.csv
  duplicates: string[];
}

export function evaluate(expected: ExpectedRow[], records: DecisionRecord[]): EvalResult {
  const byName = new Map<string, DecisionRecord>();
  const duplicates: string[] = [];
  for (const r of records) {
    const key = basename(r.file).toLowerCase();
    if (byName.has(key)) duplicates.push(r.file);
    else byName.set(key, r);
  }
  const used = new Set<string>();
  const rows: RowEval[] = expected.map((e) => {
    const key = basename(e.file).toLowerCase();
    const rec = byName.get(key);
    if (rec) used.add(key);
    const actual = rec ? normalizeDecision(rec.decision) : null;
    const missing = actual === null;
    const fired = rec && rec.results ? firedRules(rec.results) : null;
    const rulesOk =
      e.rules.length === 0 || fired === null ? null : e.rules.every((x) => fired.includes(x));
    return {
      file: e.file,
      partition: e.partition,
      expected: e.decision,
      actual,
      correct: actual === e.decision,
      leak: actual === "PAGAR" && e.decision !== "PAGAR",
      overEscalated: actual === "ESCALAR" && e.decision !== "ESCALAR",
      blockedInsteadOfEscalated: actual === "FRENAR" && e.decision === "ESCALAR",
      missing,
      expectedRules: e.rules,
      firedRules: fired,
      rulesOk,
      explained: isExplained(rec, actual),
      explanation: rec
        ? (rec.explanation ??
          (rec.results ?? [])
            .filter((r) => outcomeLevel(r.outcome) !== "PASS")
            .map((r) => r.message ?? "")
            .join(" "))
        : "",
      justification: e.justification,
      error: rec?.error,
      ms: rec?.ms,
      tokens: rec?.tokens,
    };
  });
  const extras = [...byName.keys()].filter((k) => !used.has(k));
  return { rows, metrics: computeMetrics(rows), extras, duplicates };
}

export function computeMetrics(rows: RowEval[]): Metrics {
  const total = rows.length;
  const correct = rows.filter((r) => r.correct).length;
  const leakRows = rows.filter((r) => r.leak);
  const nonEsc = rows.filter((r) => r.expected !== "ESCALAR");
  const matrix = {} as Metrics["matrix"];
  for (const e of DECISIONS) {
    matrix[e] = { PAGAR: 0, FRENAR: 0, ESCALAR: 0, SIN_DECISION: 0 };
  }
  for (const r of rows) matrix[r.expected][r.actual ?? "SIN_DECISION"]++;
  const rulesRows = rows.filter((r) => r.rulesOk !== null);
  const msVals = rows.map((r) => r.ms).filter((x): x is number => typeof x === "number");
  const tokVals = rows.map((r) => r.tokens).filter((x): x is number => typeof x === "number");
  return {
    total,
    correct,
    accuracy: { num: correct, den: total },
    leaks: leakRows.length,
    leakFiles: leakRows.map((r) => r.file),
    autonomy: { num: nonEsc.filter((r) => r.correct).length, den: nonEsc.length },
    overEscalation: { num: nonEsc.filter((r) => r.overEscalated).length, den: nonEsc.length },
    blockedInsteadOfEscalated: rows.filter((r) => r.blockedInsteadOfEscalated).length,
    missing: rows.filter((r) => r.missing).length,
    explainability: { num: rows.filter((r) => r.explained).length, den: total },
    rulesMatch: { num: rulesRows.filter((r) => r.rulesOk).length, den: rulesRows.length },
    avgMs: msVals.length ? Math.round(msVals.reduce((a, b) => a + b, 0) / msVals.length) : null,
    totalTokens: tokVals.length ? tokVals.reduce((a, b) => a + b, 0) : null,
    matrix,
  };
}

// ----------------------------------------------------------------------------
// Presentación
// ----------------------------------------------------------------------------
export function pct(r: Ratio): string {
  return r.den === 0 ? "n/d" : `${((100 * r.num) / r.den).toFixed(1)} %`;
}
export function frac(r: Ratio): string {
  return `${r.num}/${r.den}`;
}

export function renderConsoleSummary(title: string, m: Metrics): string {
  const L: string[] = [];
  L.push(`\n=== ${title} (${m.total} facturas) ===`);
  L.push(
    m.leaks === 0
      ? `  Fugas            : 0   ✅`
      : `  Fugas            : ${m.leaks}  🚨 DESCALIFICANTE → ${m.leakFiles.join(", ")}`,
  );
  L.push(`  Exactitud        : ${frac(m.accuracy)}  (${pct(m.accuracy)})`);
  L.push(
    `  Autonomía        : ${frac(m.autonomy)}  (${pct(m.autonomy)})   [esperado PAGAR/FRENAR decidido bien]`,
  );
  L.push(
    `  Sobreescalación  : ${frac(m.overEscalation)}  (${pct(m.overEscalation)})   [ESCALAR cuando se esperaba PAGAR/FRENAR]`,
  );
  L.push(
    `  FRENAR vs ESCALAR: ${m.blockedInsteadOfEscalated}   [se frenó algo que debía ir a un humano]`,
  );
  L.push(`  Explicabilidad   : ${frac(m.explainability)}  (${pct(m.explainability)})`);
  L.push(
    `  Reglas correctas : ${frac(m.rulesMatch)}  (${pct(m.rulesMatch)})   [informativo: ¿se disparó la regla esperada?]`,
  );
  if (m.missing)
    L.push(`  Sin decisión     : ${m.missing}   ⚠ el pipeline no devolvió resultado válido`);
  if (m.avgMs !== null) L.push(`  Latencia media   : ${m.avgMs} ms/factura`);
  if (m.totalTokens !== null) L.push(`  Tokens totales   : ${m.totalTokens}`);
  return L.join("\n");
}

export function renderRowsTable(rows: RowEval[]): string {
  const icon = (r: RowEval) => (r.leak ? "🚨" : r.correct ? "✅" : r.missing ? "⛔" : "❌");
  const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  const L = [
    `  ${pad("", 3)}${pad("archivo", 26)}${pad("esperado", 10)}${pad("obtenido", 10)}reglas esperadas → disparadas`,
  ];
  for (const r of rows) {
    const fired = r.firedRules === null ? "(sin results)" : r.firedRules.join("|") || "—";
    L.push(
      `  ${pad(icon(r), 3)}${pad(r.file, 26)}${pad(r.expected, 10)}${pad(r.actual ?? "—", 10)}${r.expectedRules.join("|") || "—"} → ${fired}`,
    );
  }
  return L.join("\n");
}

export function renderMarkdown(args: {
  title: string;
  generatedAt: string;
  partitions: string[];
  result: EvalResult;
  perPartition: Record<string, Metrics>;
  source: string;
}): string {
  const { result, perPartition } = args;
  const m = result.metrics;
  const L: string[] = [];
  L.push(`# Reporte de evaluación — ${args.title}`);
  L.push("");
  L.push(`- Generado: ${args.generatedAt}`);
  L.push(`- Particiones: ${args.partitions.join(", ")}`);
  L.push(`- Fuente de decisiones: ${args.source}`);
  L.push("");
  L.push(m.leaks === 0 ? "## ✅ Fugas: 0" : `## 🚨 Fugas: ${m.leaks} (descalificante)`);
  if (m.leaks) m.leakFiles.forEach((f) => L.push(`- ${f}`));
  L.push("");
  L.push("## Métricas");
  L.push("");
  L.push(
    "| Partición | Facturas | Fugas | Exactitud | Autonomía | Sobreescalación | Explicabilidad |",
  );
  L.push("|---|---|---|---|---|---|---|");
  const line = (name: string, x: Metrics) =>
    `| ${name} | ${x.total} | ${x.leaks} | ${frac(x.accuracy)} (${pct(x.accuracy)}) | ${frac(x.autonomy)} (${pct(x.autonomy)}) | ${frac(x.overEscalation)} (${pct(x.overEscalation)}) | ${frac(x.explainability)} (${pct(x.explainability)}) |`;
  for (const [name, x] of Object.entries(perPartition)) L.push(line(name, x));
  L.push(line("**Total**", m));
  L.push("");
  L.push("## Matriz de confusión (filas = esperado, columnas = obtenido)");
  L.push("");
  L.push("| esperado \\ obtenido | PAGAR | FRENAR | ESCALAR | sin decisión |");
  L.push("|---|---|---|---|---|");
  for (const e of DECISIONS) {
    const x = m.matrix[e];
    L.push(`| ${e} | ${x.PAGAR} | ${x.FRENAR} | ${x.ESCALAR} | ${x.SIN_DECISION} |`);
  }
  L.push("");
  L.push(
    "> Error crítico: la celda esperado FRENAR/ESCALAR × obtenido PAGAR. Frenar o escalar de más es un error blando.",
  );
  L.push("");
  const bad = result.rows.filter((r) => !r.correct);
  L.push(`## Diferencias (${bad.length})`);
  L.push("");
  if (bad.length === 0) L.push("Ninguna: todas las decisiones coinciden con lo esperado.");
  else {
    L.push("| | Archivo | Esperado | Obtenido | Por qué se esperaba eso |");
    L.push("|---|---|---|---|---|");
    for (const r of bad)
      L.push(
        `| ${r.leak ? "🚨" : "❌"} | ${r.file} | ${r.expected} | ${r.actual ?? "sin decisión"} | ${r.justification.replace(/\|/g, "/")} |`,
      );
  }
  L.push("");
  L.push("## Detalle por factura");
  L.push("");
  L.push("| | Archivo | Esperado | Obtenido | Reglas esperadas | Reglas disparadas | Explicado |");
  L.push("|---|---|---|---|---|---|---|");
  for (const r of result.rows) {
    const icon = r.leak ? "🚨" : r.correct ? "✅" : "❌";
    L.push(
      `| ${icon} | ${r.file} | ${r.expected} | ${r.actual ?? "—"} | ${r.expectedRules.join(", ") || "—"} | ${r.firedRules === null ? "n/d" : r.firedRules.join(", ") || "—"} | ${r.explained ? "sí" : "no"} |`,
    );
  }
  if (result.extras.length) {
    L.push("");
    L.push(
      `> Archivos con decisión que no están en expected.csv (ignorados): ${result.extras.join(", ")}`,
    );
  }
  L.push("");
  return L.join("\n");
}
