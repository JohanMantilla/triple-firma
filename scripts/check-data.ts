/**
 * npm run check:data
 *
 * Verifica la coherencia INTERNA de los datos del Rol C (no usa el motor del equipo):
 *   1. Cada fila de expected.csv tiene su archivo, y cada archivo tiene su fila.
 *   2. Repite a mano la aritmética (conversión con redondeo en contra del pago, umbral, presupuesto con
 *      escaladas reservadas, duplicados, ventana de fraccionamiento, fechas) y confirma que cada trampa
 *      realmente ocurre con los datos, y que cada PAGAR esperado realmente cumple todo.
 *
 * Si esto falla, el error está en los DATOS (o en expected.csv), no en el motor.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { basename, loadExpected } from "./eval-lib";
import type { ExpectedRow, Partition } from "./eval-lib";

interface Truth {
  file: string;
  payee: string;
  amountMinor: number | null;
  currency: string | null;
  dueDate: string | null;
  reference: string;
  lineItemsTotalMinor: number | null;
  suspiciousText: string[];
  ambiguousFields: string[];
}
interface Payment {
  beneficiary: string;
  reference: string;
  amountMinor: number;
  currency: string;
  usdMinor: number;
  paidOn: string;
}
interface Seed {
  asOf: string;
  payments: Payment[];
}
interface Agreement {
  beneficiary: string;
  kind: string;
  amountMinor: number;
  currency: string;
  validFrom: string;
  validTo: string;
}
interface Config {
  evaluationDate: string;
  budget: { amountMinor: number };
  approvalThresholdMinor: number;
  fx: { rates: Record<string, string> };
  rules: { R7_splitting: { windowDays: number; thresholdMinor: number }; R9_dates: { maxOverdueDays: number; maxFutureDays: number } };
  beneficiaries: { name: string; status: string }[];
  agreements: Agreement[];
}

const errors: string[] = [];
const err = (m: string) => errors.push(m);

const dataDir = resolve(process.argv[2] ?? "data");
const sealedDir = resolve(process.argv[3] ?? join(dataDir, "..", "_SELLADO_holdout", "data"));

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** ceil(amountMinor / rate) con BigInt (sin float). rate es string decimal, p. ej. "4000" o "20.5". */
function toUsdMinor(amountMinor: number, ccy: string, rates: Record<string, string>): number {
  const rate = rates[ccy];
  if (rate === undefined) throw new Error(`sin tasa para ${ccy}`);
  const [i, d = ""] = rate.split(".");
  const num = BigInt(i + d);
  const den = 10n ** BigInt(d.length);
  const n = BigInt(amountMinor) * den;
  return Number((n + num - 1n) / num);
}

/** Normalización de nombres y referencias (S1): espacios colapsados + minúsculas; puntuación y acentos cuentan. */
const nrm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();

const day = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / 86_400_000);

function checkPartition(part: Partition, expected: ExpectedRow[], truth: Truth[], seed: Seed, cfg: Config, invoicesDir: string) {
  const rows = expected.filter((e) => e.partition === part).sort((a, b) => basename(a.file).localeCompare(basename(b.file)));
  // 1) archivos <-> filas
  const dir = join(invoicesDir, part);
  const onDisk = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const r of rows) if (!onDisk.includes(basename(r.file))) err(`[${part}] falta el archivo ${r.file}`);
  for (const f of onDisk) if (!rows.some((r) => basename(r.file) === f)) err(`[${part}] ${f} no tiene fila en expected`);
  if (rows.length === 0) return;

  const asOf = day(cfg.evaluationDate);
  const T = cfg.approvalThresholdMinor;
  const budget = cfg.budget.amountMinor;
  const win = cfg.rules.R7_splitting.windowDays;
  const allowed = new Map(cfg.beneficiaries.map((b) => [nrm(b.name), b.status]));
  const agrOf = (name: string) => cfg.agreements.find((a) => nrm(a.beneficiary) === nrm(name));

  // Estado: pagos (PAGAR) y reservas (ESCALAR con monto conocido)
  let committed = seed.payments.filter((p) => p.paidOn.slice(0, 7) === cfg.evaluationDate.slice(0, 7)).reduce((s, p) => s + p.usdMinor, 0);
  const paid: Payment[] = [...seed.payments];
  const reserved: { beneficiary: string; usdMinor: number }[] = [];

  for (const r of rows) {
    const t = truth.find((x) => x.file === r.file);
    if (!t) {
      err(`[${r.file}] no está en extraction-truth`);
      continue;
    }
    const tag = `[${r.file}]`;
    const known = t.amountMinor !== null && t.currency !== null && !t.ambiguousFields.includes("amount");
    const usd = known ? toUsdMinor(t.amountMinor!, t.currency!, cfg.fx.rates) : null;
    const status = allowed.get(nrm(t.payee));
    const agr = agrOf(t.payee);
    const exactDup = paid.some((p) => nrm(p.beneficiary) === nrm(t.payee) && nrm(p.reference) === nrm(t.reference) && p.amountMinor === t.amountMinor && p.currency === t.currency);
    const windowSum = known
      ? paid.filter((p) => nrm(p.beneficiary) === nrm(t.payee) && asOf - day(p.paidOn) <= win && asOf - day(p.paidOn) >= 0).reduce((s, p) => s + p.usdMinor, 0) +
        reserved.filter((p) => nrm(p.beneficiary) === nrm(t.payee)).reduce((s, p) => s + p.usdMinor, 0)
      : 0;
    const dueDays = t.dueDate ? day(t.dueDate) - asOf : null; // negativo = vencida

    const has = (x: string) => r.rules.includes(x);

    // ---- aserciones por regla esperada ------------------------------------
    if (has("R1") && !(t.amountMinor === null || t.dueDate === null || t.ambiguousFields.includes("amount"))) err(`${tag} R1: el documento sí trae monto y fecha sin ambigüedad`);
    if (has("R2") && r.decision === "FRENAR" && !exactDup) err(`${tag} R2: no hay un pago previo exacto (beneficiario+monto+moneda+referencia)`);
    if (has("R2") && r.decision === "ESCALAR") {
      const near = paid.some((p) => nrm(p.beneficiary) === nrm(t.payee) && p.amountMinor === t.amountMinor && nrm(p.reference) !== nrm(t.reference) && p.reference.replace(/[^A-Za-z0-9]/g, "") === t.reference.replace(/[^A-Za-z0-9]/g, ""));
      if (!near) err(`${tag} R2: no hay un casi-duplicado (misma referencia salvo puntuación/espacios)`);
    }
    if (has("R3")) {
      const exactAllowed = status === "allowed";
      if (r.decision === "FRENAR" && status !== "blocked") err(`${tag} R3 FRENAR: el beneficiario no está bloqueado`);
      if (r.decision === "ESCALAR" && exactAllowed) err(`${tag} R3 ESCALAR: el beneficiario SÍ está exacto en la lista`);
    }
    if (has("R4")) {
      if (r.decision === "FRENAR") {
        const moreThanAgreed = !!agr && t.currency === agr.currency && t.amountMinor !== null && t.amountMinor > agr.amountMinor;
        const otherCurrency = !!agr && t.currency !== null && t.currency !== agr.currency;
        const outOfValidity = !!agr && t.dueDate !== null && (t.dueDate < agr.validFrom || t.dueDate > agr.validTo);
        if (!(moreThanAgreed || otherCurrency || outOfValidity)) err(`${tag} R4 FRENAR: debería cobrar más, en otra moneda o fuera de vigencia`);
      } else if (agr) err(`${tag} R4 ESCALAR: sí tiene acuerdo (se esperaba "sin acuerdo")`);
    }
    if (has("R5") && !(usd !== null && usd > T)) err(`${tag} R5: USD ${usd} no supera el umbral ${T}`);
    if (has("R6") && !(usd !== null && committed + usd > budget)) err(`${tag} R6: comprometido ${committed} + ${usd} no supera ${budget}`);
    if (has("R7") && !(usd !== null && windowSum + usd > T)) err(`${tag} R7: ventana ${windowSum} + ${usd} no supera ${T}`);
    if (has("R8") && t.currency !== null) err(`${tag} R8: la moneda no es ambigua`);
    if (has("R9") && !(t.ambiguousFields.includes("dueDate") || (dueDays !== null && (dueDays < -cfg.rules.R9_dates.maxOverdueDays || dueDays > cfg.rules.R9_dates.maxFutureDays)))) err(`${tag} R9: vencimiento dentro de rango`);
    if (has("R10") && !(t.suspiciousText.length > 0 || (t.lineItemsTotalMinor !== null && t.amountMinor !== null && t.lineItemsTotalMinor !== t.amountMinor))) err(`${tag} R10: no hay contenido sospechoso ni total descuadrado`);

    // ---- un PAGAR esperado no debe tener NINGÚN motivo para no pagarse -----
    if (r.decision === "PAGAR") {
      if (r.rules.length) err(`${tag} PAGAR no debe listar reglas`);
      if (!known || usd === null) err(`${tag} PAGAR sin monto/moneda conocidos`);
      else {
        if (status !== "allowed") err(`${tag} PAGAR: beneficiario no permitido`);
        if (!agr) err(`${tag} PAGAR: sin acuerdo`);
        else {
          if (agr.currency !== t.currency || agr.amountMinor !== t.amountMinor) err(`${tag} PAGAR: no coincide con el acuerdo`);
          if (t.dueDate && (t.dueDate < agr.validFrom || t.dueDate > agr.validTo)) err(`${tag} PAGAR: fuera de vigencia del acuerdo`);
        }
        if (usd > T) err(`${tag} PAGAR: USD ${usd} supera el umbral`);
        if (exactDup) err(`${tag} PAGAR: es duplicado`);
        if (windowSum + usd > T) err(`${tag} PAGAR: dispara fraccionamiento (${windowSum}+${usd})`);
        if (committed + usd > budget) err(`${tag} PAGAR: no hay presupuesto (${committed}+${usd}>${budget})`);
        if (dueDays === null || dueDays < -cfg.rules.R9_dates.maxOverdueDays || dueDays > cfg.rules.R9_dates.maxFutureDays) err(`${tag} PAGAR: fecha fuera de rango`);
        if (t.suspiciousText.length || (t.lineItemsTotalMinor !== null && t.lineItemsTotalMinor !== t.amountMinor)) err(`${tag} PAGAR: contenido sospechoso`);
      }
    }

    // ---- actualizar estado --------------------------------------------------
    if (r.decision === "PAGAR" && usd !== null) {
      committed += usd;
      paid.push({ beneficiary: t.payee, reference: t.reference, amountMinor: t.amountMinor!, currency: t.currency!, usdMinor: usd, paidOn: cfg.evaluationDate });
    } else if (r.decision === "ESCALAR" && usd !== null && !has("R1") && !has("R8")) {
      // las escaladas pendientes con monto conocido reservan presupuesto
      if (committed + usd > budget) err(`${tag} ESCALAR: con el presupuesto reservado (${committed}+${usd}) debería ser FRENAR por R6`);
      committed += usd;
      reserved.push({ beneficiary: t.payee, usdMinor: usd });
    }
  }
  const usedPct = ((100 * committed) / budget).toFixed(1);
  console.log(`  ${part.padEnd(12)} ${rows.length} facturas · presupuesto comprometido al final: USD ${(committed / 100).toFixed(2)} (${usedPct} %)`);
}

function main() {
  console.log("Verificando datos del Rol C ...");
  const cfg = readJson<Config>(join(dataDir, "config", "company.json"));
  const mainExpected = loadExpected(readFileSync(join(dataDir, "expected.csv"), "utf8"));
  const truth = readJson<Truth[]>(join(dataDir, "extraction-truth.json"));
  const all = [...mainExpected];
  const truthAll = [...truth];

  for (const p of ["dev", "adversarial"] as Partition[]) {
    checkPartition(p, all, truthAll, readJson<Seed>(join(dataDir, "config", "seeds", `${p}.json`)), cfg, join(dataDir, "invoices"));
  }

  // Holdout: se verifica si está presente (en data/ o en la carpeta sellada).
  const candidates = [dataDir, sealedDir];
  const hd = candidates.find((d) => existsSync(join(d, "expected-holdout.csv")));
  if (hd) {
    const hExpected = loadExpected(readFileSync(join(hd, "expected-holdout.csv"), "utf8"));
    const hTruth = readJson<Truth[]>(join(hd, "extraction-truth-holdout.json"));
    checkPartition("holdout", hExpected, hTruth, readJson<Seed>(join(hd, "config", "seeds", "holdout.json")), cfg, join(hd, "invoices"));
  } else {
    console.log("  holdout      (no presente: omitido)");
  }

  if (errors.length) {
    console.error(`\n❌ ${errors.length} problema(s) en los datos:`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✅ Datos coherentes: cada trampa ocurre y cada PAGAR cumple todas las reglas.");
}

main();
