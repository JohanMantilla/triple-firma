/**
 * npm run eval            → dev + adversarial   (lo que se puede mirar y ajustar)
 * npm run eval:holdout    → SOLO holdout        (sellado; lo corre C una vez, sábado 10 pm)
 *
 * De dónde salen las decisiones (elige una):
 *   --decisions <archivo.json>   Un JSON con DecisionRecord[] (ver scripts/eval-lib.ts). Útil para probar el
 *                                evaluador o para evaluar una corrida que E exportó de la base de datos.
 *   --runner <módulo>            Módulo con `export async function runBatch(input): Promise<DecisionRecord[]>`.
 *                                Por defecto: src/pipeline/run-batch.ts  (lo implementan A/E, ver data/README.md §7).
 *
 * Otras opciones:
 *   --partition dev,adversarial,holdout   (por defecto dev,adversarial)
 *   --holdout                             atajo de --partition holdout
 *   --data-dir <ruta>                     (por defecto ./data)
 *   --out-dir <ruta>                      (por defecto <data-dir>/reports)  |  --no-report para no escribir archivos
 *   --verbose                             muestra además la explicación de cada diferencia
 *
 * Código de salida: 0 = sin fugas · 1 = hay fugas (PAGAR indebido) · 2 = error de configuración.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PARTITIONS,
  basename,
  computeMetrics,
  evaluate,
  loadExpected,
  renderConsoleSummary,
  renderMarkdown,
  renderRowsTable,
} from "./eval-lib";
import type { DecisionRecord, ExpectedRow, Partition, RowEval } from "./eval-lib";

export interface RunBatchInput {
  partition: Partition;
  /** Rutas ABSOLUTAS de las facturas, YA EN EL ORDEN en que deben procesarse (el estado importa: duplicados, presupuesto). */
  files: string[];
  /** Ruta al company.json (reglas de la empresa ficticia). */
  configPath: string;
  /** Ruta al historial inicial de esta partición (pagos previos). El pipeline debe empezar SIEMPRE desde ese estado. */
  seedPath: string;
  /** Fecha "de hoy" fija para R9 y el periodo del presupuesto (determinismo). */
  asOf: string;
}

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      a[key] = next;
      i++;
    } else a[key] = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolve(String(args["data-dir"] ?? "data"));
  const partitions: Partition[] = args["holdout"]
    ? ["holdout"]
    : String(args["partition"] ?? "dev,adversarial")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          if (!(PARTITIONS as readonly string[]).includes(s))
            fail(`Partición desconocida "${s}". Usa: ${PARTITIONS.join(", ")}`);
          return s as Partition;
        });

  const isHoldout = partitions.includes("holdout");
  if (isHoldout) {
    console.log(
      "\n🔒 CORRIDA SOBRE HOLDOUT. Esta es la medición final: no se ajusta nada contra estos resultados.",
    );
  }

  // ---- expected -----------------------------------------------------------
  const expected: ExpectedRow[] = [];
  const mainCsv = join(dataDir, "expected.csv");
  const holdCsv = join(dataDir, "expected-holdout.csv");
  const readIfExists = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
  if (partitions.some((p) => p !== "holdout")) {
    if (!existsSync(mainCsv)) fail(`No encuentro ${mainCsv}`);
    const justifications = readIfExists(join(dataDir, "expected-justifications.csv"));
    expected.push(...loadExpected(readFileSync(mainCsv, "utf8"), justifications));
  }
  if (isHoldout) {
    if (!existsSync(holdCsv)) {
      fail(
        `No encuentro ${holdCsv}.\nEl holdout está sellado: copia el contenido de _SELLADO_holdout/data/ dentro de data/ (solo en la corrida final) y vuelve a correr.`,
      );
    }
    const justifications = readIfExists(join(dataDir, "expected-holdout-justifications.csv"));
    expected.push(...loadExpected(readFileSync(holdCsv, "utf8"), justifications));
  }
  const selected = expected.filter((e) => partitions.includes(e.partition));
  if (selected.length === 0) fail("No hay facturas esperadas para las particiones elegidas.");

  // ---- decisiones ---------------------------------------------------------
  let records: DecisionRecord[] = [];
  let source = "";
  const asOf = readAsOf(dataDir);
  const configPath = join(dataDir, "config", "company.json");

  if (typeof args["decisions"] === "string") {
    const p = resolve(String(args["decisions"]));
    if (!existsSync(p)) fail(`No encuentro el archivo de decisiones ${p}`);
    const raw = JSON.parse(readFileSync(p, "utf8"));
    records = Array.isArray(raw) ? raw : raw.decisions;
    if (!Array.isArray(records))
      fail(`${p} debe ser un arreglo de decisiones o { "decisions": [...] }`);
    source = `archivo ${p}`;
  } else {
    const runnerPath = resolve(String(args["runner"] ?? "src/pipeline/run-batch.ts"));
    if (!existsSync(runnerPath)) {
      fail(
        `No encuentro el pipeline en ${runnerPath}.\n` +
          `Opciones:\n` +
          `  • Implementar \`runBatch\` (A/E) según data/README.md §7 y volver a correr.\n` +
          `  • Probar el evaluador ya mismo con decisiones de ejemplo:\n` +
          `      npm run eval -- --decisions scripts/fixtures/decisions-perfect.json`,
      );
    }
    const mod = await import(pathToFileURL(runnerPath).href);
    if (typeof mod.runBatch !== "function") fail(`${runnerPath} debe exportar \`runBatch\`.`);
    for (const part of partitions) {
      const files = selected
        .filter((e) => e.partition === part)
        .map((e) => e.file)
        .sort((x, y) => basename(x).localeCompare(basename(y)))
        .map((f) => join(dataDir, "invoices", f));
      const missing = files.filter((f) => !existsSync(f));
      if (missing.length) fail(`Faltan facturas:\n  ${missing.join("\n  ")}`);
      const seedPath = join(dataDir, "config", "seeds", `${part}.json`);
      if (!existsSync(seedPath)) fail(`Falta el historial inicial ${seedPath}`);
      const input: RunBatchInput = { partition: part, files, configPath, seedPath, asOf };
      console.log(`▶ Procesando ${files.length} facturas de "${part}" ...`);
      const out = await mod.runBatch(input);
      if (!Array.isArray(out)) fail("runBatch debe devolver un arreglo de DecisionRecord.");
      records.push(...out);
    }
    source = `pipeline ${runnerPath}`;
  }

  // ---- evaluación ---------------------------------------------------------
  const result = evaluate(selected, records);
  if (result.duplicates.length)
    console.warn(
      `⚠ Decisiones duplicadas para: ${result.duplicates.join(", ")} (se usó la primera)`,
    );

  const perPartition: Record<string, ReturnType<typeof computeMetrics>> = {};
  for (const p of partitions) {
    const rows: RowEval[] = result.rows.filter((r) => r.partition === p);
    perPartition[p] = computeMetrics(rows);
    console.log(renderConsoleSummary(`Partición ${p}`, perPartition[p]));
    console.log(renderRowsTable(rows));
    if (args["verbose"]) {
      for (const r of rows.filter((x) => !x.correct))
        console.log(
          `    ↳ ${r.file}: ${r.explanation || "(sin explicación)"}\n      esperado porque: ${r.justification}`,
        );
    }
  }
  if (partitions.length > 1) console.log(renderConsoleSummary("TOTAL", result.metrics));
  if (result.extras.length)
    console.warn(
      `\n⚠ Decisiones para archivos que no están en expected.csv (ignoradas): ${result.extras.join(", ")}`,
    );

  // ---- reportes -----------------------------------------------------------
  if (!args["no-report"]) {
    const outDir = resolve(String(args["out-dir"] ?? join(dataDir, "reports")));
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const tag = isHoldout ? "holdout" : partitions.join("+");
    const title = isHoldout ? "HOLDOUT (corrida final)" : partitions.join(" + ");
    const md = renderMarkdown({
      title,
      generatedAt: new Date().toISOString(),
      partitions,
      result,
      perPartition,
      source,
    });
    const base = join(outDir, `eval-${tag}-${stamp}`);
    writeFileSync(`${base}.md`, md, "utf8");
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        { partitions, source, metrics: result.metrics, perPartition, rows: result.rows },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(join(outDir, `latest-${isHoldout ? "holdout" : "dev"}.md`), md, "utf8");
    console.log(`\n📄 Reporte: ${base}.md`);
  }

  if (result.metrics.leaks > 0) {
    console.error(
      `\n🚨 ${result.metrics.leaks} FUGA(S): el sistema pagó algo que no debía. Arréglalo antes que cualquier otra cosa.`,
    );
    process.exit(1);
  }
  console.log("\n✅ Cero fugas.");
}

function readAsOf(dataDir: string): string {
  try {
    const cfg = JSON.parse(readFileSync(join(dataDir, "config", "company.json"), "utf8"));
    return String(cfg.evaluationDate ?? "2026-10-17");
  } catch {
    return "2026-10-17";
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
