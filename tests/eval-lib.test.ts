import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluate,
  isExplained,
  loadExpected,
  normalizeDecision,
  parseCsv,
} from "../scripts/eval-lib";
import type { DecisionRecord } from "../scripts/eval-lib";
import { parseExpectedCsv } from "@/pipeline/compute-metrics";

const expectedCsv = readFileSync(join(__dirname, "../data/expected.csv"), "utf8");
const expected = loadExpected(expectedCsv);

const good = (
  file: string,
  decision: "PAY" | "BLOCK" | "ESCALATE",
  rules: string[] = [],
): DecisionRecord => ({
  file,
  decision,
  results: rules.length
    ? rules.map((rule) => ({
        rule,
        outcome: decision === "BLOCK" ? "BLOCK" : "ESCALATE",
        message: "Motivo explicado con valores.",
        compared: { monto: 1 },
      }))
    : [
        {
          rule: "R1",
          outcome: "PASS",
          message: "Todo cumple la configuración.",
          compared: { ok: 1 },
        },
      ],
  explanation: "Explicación de ejemplo suficientemente larga.",
});

const OUT = { PAGAR: "PAY", FRENAR: "BLOCK", ESCALAR: "ESCALATE" } as const;
const perfect = (): DecisionRecord[] => expected.map((e) => good(e.file, OUT[e.decision], e.rules));

describe("parseCsv", () => {
  it("respeta comillas, comas y saltos de línea dentro de celdas", () => {
    expect(parseCsv('a,b\n"x, y","l1\nl2"\n')).toEqual([
      ["a", "b"],
      ["x, y", "l1\nl2"],
    ]);
    expect(parseCsv('a\n"di ""hola"""\n')).toEqual([["a"], ['di "hola"']]);
  });
});

describe("normalizeDecision", () => {
  it("acepta español e inglés", () => {
    expect(normalizeDecision("PAY")).toBe("PAGAR");
    expect(normalizeDecision("block")).toBe("FRENAR");
    expect(normalizeDecision("Escalate")).toBe("ESCALAR");
    expect(normalizeDecision("???")).toBeNull();
    expect(normalizeDecision(undefined)).toBeNull();
  });
});

describe("expected.csv real", () => {
  it("tiene 36 filas (20 dev + 16 adversariales) y solo un PAGAR en adversarial (el control adv-10)", () => {
    expect(expected).toHaveLength(36);
    expect(expected.filter((e) => e.partition === "dev")).toHaveLength(20);
    expect(expected.filter((e) => e.partition === "adversarial")).toHaveLength(16);
    expect(
      expected
        .filter((e) => e.partition === "adversarial" && e.decision === "PAGAR")
        .map((e) => e.file),
    ).toEqual(["adversarial/adv-10.pdf"]);
  });
  it("toda fila no-PAGAR declara al menos una regla", () => {
    for (const e of expected)
      if (e.decision !== "PAGAR") expect(e.rules.length, e.file).toBeGreaterThan(0);
  });
  it("lo lee el pipeline (/api/metrics) con las mismas decisiones y reglas", () => {
    const fromPipeline = parseExpectedCsv(expectedCsv);
    expect(fromPipeline.map((e) => [e.fileName, e.expectedRuleIds])).toEqual(
      expected.map((e) => [e.file, e.rules]),
    );
  });
  it("cada fila tiene su justificación", () => {
    const justifications = readFileSync(
      join(__dirname, "../data/expected-justifications.csv"),
      "utf8",
    );
    for (const e of loadExpected(expectedCsv, justifications))
      expect(e.justification, e.file).not.toBe("");
  });
});

describe("evaluate", () => {
  it("decisiones perfectas → 0 fugas, 100 % exactitud, autonomía y explicabilidad", () => {
    const m = evaluate(expected, perfect()).metrics;
    expect(m.leaks).toBe(0);
    expect(m.accuracy).toEqual({ num: 36, den: 36 });
    expect(m.autonomy.num).toBe(m.autonomy.den);
    expect(m.explainability).toEqual({ num: 36, den: 36 });
    expect(m.rulesMatch.num).toBe(m.rulesMatch.den);
  });

  it("PAGAR cuando se esperaba ESCALAR/FRENAR es una FUGA", () => {
    const recs = perfect();
    recs.find((r) => r.file === "dev/dev-13.txt")!.decision = "PAY";
    recs.find((r) => r.file === "dev/dev-20.pdf")!.decision = "PAGAR";
    const m = evaluate(expected, recs).metrics;
    expect(m.leaks).toBe(2);
    expect(m.leakFiles.sort()).toEqual(["dev/dev-13.txt", "dev/dev-20.pdf"]);
  });

  it("ESCALAR de más NO es fuga: baja autonomía y suma sobreescalación", () => {
    const recs = perfect();
    recs.find((r) => r.file === "dev/dev-01.pdf")!.decision = "ESCALATE"; // esperado PAGAR
    recs.find((r) => r.file === "dev/dev-08.eml")!.decision = "ESCALATE"; // esperado FRENAR
    const m = evaluate(expected, recs).metrics;
    expect(m.leaks).toBe(0);
    expect(m.overEscalation.num).toBe(2);
    expect(m.autonomy.num).toBe(m.autonomy.den - 2);
  });

  it("FRENAR cuando se esperaba ESCALAR se cuenta aparte y no es fuga", () => {
    const recs = perfect();
    recs.find((r) => r.file === "dev/dev-10.pdf")!.decision = "BLOCK";
    const m = evaluate(expected, recs).metrics;
    expect(m.leaks).toBe(0);
    expect(m.blockedInsteadOfEscalated).toBe(1);
  });

  it("una factura sin decisión cuenta como error, nunca como acierto ni fuga", () => {
    const recs = perfect().filter((r) => r.file !== "dev/dev-05.txt");
    const m = evaluate(expected, recs).metrics;
    expect(m.missing).toBe(1);
    expect(m.leaks).toBe(0);
    expect(m.correct).toBe(35);
  });

  it("empareja por nombre de archivo aunque venga con otra ruta", () => {
    const recs = perfect().map((r) => ({ ...r, file: "/tmp/otra/ruta/" + r.file.split("/")[1] }));
    expect(evaluate(expected, recs).metrics.accuracy.num).toBe(36);
  });

  it("detecta decisiones para archivos desconocidos", () => {
    const res = evaluate(expected, [...perfect(), good("dev/dev-99.pdf", "PAY")]);
    expect(res.extras).toEqual(["dev-99.pdf"]);
  });
});

describe("isExplained", () => {
  it("exige regla decisoria con mensaje y valores comparados", () => {
    expect(isExplained(good("x", "BLOCK", ["R4"]), "FRENAR")).toBe(true);
    const sinValores = good("x", "BLOCK", ["R4"]);
    sinValores.results![0].compared = {};
    expect(isExplained(sinValores, "FRENAR")).toBe(false);
    expect(isExplained({ file: "x", decision: "BLOCK", explanation: "" }, "FRENAR")).toBe(false);
    expect(isExplained(undefined, null)).toBe(false);
  });
  it("un PAGAR sin ninguna regla evaluada no está explicado", () => {
    expect(
      isExplained(
        { file: "x", decision: "PAY", explanation: "Se paga porque sí, sin más." },
        "PAGAR",
      ),
    ).toBe(false);
  });
});
