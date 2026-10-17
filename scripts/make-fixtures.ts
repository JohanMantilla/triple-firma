/**
 * Genera decisiones de EJEMPLO para probar el evaluador sin tener todavía el motor:
 *   scripts/fixtures/decisions-perfect.json  → todas correctas y bien explicadas (esperado: 0 fugas, 100 %)
 *   scripts/fixtures/decisions-leaky.json    → con una fuga, errores blandos y una decisión faltante
 *
 * Uso:  node scripts/make-fixtures.ts     (o: npx tsx scripts/make-fixtures.ts)
 * No usa el motor del equipo: solo reescribe lo que dice expected.csv en el formato del pipeline.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadExpected } from "./eval-lib.ts";
import type { DecisionRecord } from "./eval-lib.ts";

const dataDir = resolve(process.argv[2] ?? "data");
const outDir = resolve("scripts/fixtures");
mkdirSync(outDir, { recursive: true });

const rows = loadExpected(readFileSync(join(dataDir, "expected.csv"), "utf8"));
const OUT = { PAGAR: "PAY", FRENAR: "BLOCK", ESCALAR: "ESCALATE" } as const;

const perfect: DecisionRecord[] = rows.map((r) => {
  if (r.decision === "PAGAR") {
    return {
      file: r.file,
      decision: "PAY",
      results: ["R1", "R2", "R3", "R4", "R5", "R6"].map((rule) => ({
        rule,
        outcome: "PASS",
        message: `${rule} cumple con la configuración de la empresa.`,
        compared: { regla: rule },
      })),
      explanation: r.justification,
      ms: 1200,
      tokens: 900,
    };
  }
  return {
    file: r.file,
    decision: OUT[r.decision],
    results: r.rules.map((rule) => ({
      rule,
      outcome: r.decision === "FRENAR" ? "BLOCK" : "ESCALATE",
      message: r.justification,
      compared: { motivo: rule },
    })),
    explanation: r.justification,
    ms: 1200,
    tokens: 900,
  };
});

// --- versión con problemas ---------------------------------------------------
const leaky: DecisionRecord[] = JSON.parse(JSON.stringify(perfect));
const get = (f: string) => leaky.find((x) => x.file === f)!;
get("dev/dev-13.txt").decision = "PAY"; //  FUGA: debía ESCALAR por superar el umbral
get("dev/dev-13.txt").results = [];
get("dev/dev-20.pdf").decision = "PAY"; //  FUGA: debía FRENAR por presupuesto
get("dev/dev-10.pdf").decision = "BLOCK"; //  error blando: se frenó algo que debía ir a un humano
get("dev/dev-01.pdf").decision = "ESCALATE"; //  sobreescalación
get("dev/dev-02.eml").results = []; //  correcto pero sin explicación
get("dev/dev-02.eml").explanation = "";
leaky.splice(leaky.findIndex((x) => x.file === "dev/dev-05.txt"), 1); //  sin decisión

writeFileSync(join(outDir, "decisions-perfect.json"), JSON.stringify(perfect, null, 2) + "\n");
writeFileSync(join(outDir, "decisions-leaky.json"), JSON.stringify(leaky, null, 2) + "\n");
console.log(`Fixtures escritos en ${outDir} (${perfect.length} decisiones).`);
