import { describe, expect, it } from "vitest";
import type { Invoice } from "@/contracts/invoice";
import { evaluateRules } from "@/engine/evaluate-rules";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluateExtractionRule } from "@/engine/rules/extraction-rule";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

const FIELDS = ["payee", "amountMinor", "currency", "dueDate", "reference"] as const;

// The fixture's evidence, written as an email would show it: other case and extra spaces.
const EMAIL_TEXT = [
  "From:   Dev Partners SAS",
  "invoice inv-102",
  "TOTAL: USD 2,500.00",
  "Due: Oct 30, 2026",
].join("\n");

function evaluate(invoice: Invoice) {
  return evaluateExtractionRule(
    buildRuleContext({ invoice, config: buildRulesConfig(), history: [], now: NOW }),
  );
}

function withField(field: (typeof FIELDS)[number], change: Record<string, unknown>): Invoice {
  const invoice = buildInvoice();
  const extraction = invoice.extraction as Record<string, unknown>;
  extraction[field] = { ...(extraction[field] as object), ...change };
  return invoice;
}

describe("evaluateExtractionRule (R1)", () => {
  it("passes when every required field is certain and has evidence", () => {
    expect(evaluate(buildInvoice())).toMatchObject({
      ruleId: "R1",
      outcome: "PASS",
      compared: { unreadable: "", withoutEvidence: "", evidenceNotInSource: "" },
    });
  });

  it.each(FIELDS)("escalates when %s has no value", (field) => {
    const invoice = withField(field, { value: null, isUncertain: true });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { unreadable: field },
    });
  });

  it.each(FIELDS)("escalates when %s is marked uncertain", (field) => {
    expect(evaluate(withField(field, { isUncertain: true }))).toMatchObject({
      outcome: "ESCALATE",
      compared: { unreadable: field },
    });
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "   "],
  ])("escalates when the evidence is %s", (_case, evidence) => {
    expect(evaluate(withField("amountMinor", { evidence }))).toMatchObject({
      outcome: "ESCALATE",
      message: "R1: falta la evidencia de: Monto.",
      compared: { withoutEvidence: "amountMinor" },
    });
  });

  it("passes an email whose text contains every evidence, ignoring case and spacing", () => {
    const invoice = buildInvoice({ sourceFormat: "EMAIL", sourceText: EMAIL_TEXT });
    expect(evaluate(invoice).outcome).toBe("PASS");
  });

  it("escalates an email whose evidence does not appear in its original text", () => {
    const invoice = buildInvoice({
      sourceFormat: "EMAIL",
      sourceText: EMAIL_TEXT.replace("2,500.00", "25.00"),
    });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      message: "R1: la evidencia de Monto, Moneda no aparece en el texto original.",
      compared: { evidenceNotInSource: "amountMinor,currency" },
    });
  });

  it("escalates a payee whose evidence names someone else, even in a PDF", () => {
    const invoice = withField("payee", { evidence: "From: Shady LLC" });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      message: "R1: la evidencia no respalda el valor leído de: Beneficiario.",
      compared: { valueNotSupported: "payee" },
    });
  });

  it("escalates an amount that its evidence does not show, so it cannot dodge the threshold", () => {
    const invoice = withField("amountMinor", { value: 2_500 });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "amountMinor" },
    });
  });

  it("escalates an amount whose only evidence is negative, so a credit note is never paid", () => {
    const invoice = withField("amountMinor", { evidence: "Total: USD -2,500.00" });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "amountMinor" },
    });
  });

  it.each(["Total: -$2,500.00", "Nota crédito (USD 2,500.00)"])(
    "escalates a credit note written as %j",
    (evidence) => {
      expect(evaluate(withField("amountMinor", { evidence })).outcome).toBe("ESCALATE");
    },
  );

  it("escalates an amount supported only by a date in its evidence", () => {
    const invoice = withField("amountMinor", {
      value: 3_000,
      evidence: "Total USD 25,000.00 vence 30/10/2026",
    });
    expect(evaluate(invoice).outcome).toBe("ESCALATE");
  });

  it("escalates a reference that only partially matches its evidence", () => {
    const invoice = withField("reference", { value: "INV-10" });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "reference" },
    });
  });

  it("escalates a currency value that its evidence does not show, even if the raw text does", () => {
    const invoice = withField("currency", { raw: "USD", value: "COP" });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "currency", currencyEvidence: "Total: USD 2,500.00" },
    });
  });

  it("escalates a due date built from pieces of two dates in its evidence", () => {
    const invoice = withField("dueDate", {
      value: "2026-03-15",
      evidence: "Fecha: 15/01/2026 Vence: 10/03/2026",
    });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "dueDate" },
    });
  });

  it("escalates a due date that its evidence does not show, so it cannot dodge R9", () => {
    const invoice = withField("dueDate", { raw: "Oct 30, 2026", value: "2026-01-01" });
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      compared: { valueNotSupported: "dueDate" },
    });
  });

  it("escalates evidence too short to support the value", () => {
    const invoice = withField("payee", { evidence: "D" });
    expect(evaluate(invoice).outcome).toBe("ESCALATE");
  });

  it("does not search the evidence in a PDF, which has no original text", () => {
    expect(evaluate(buildInvoice({ sourceFormat: "PDF", sourceText: null })).outcome).toBe("PASS");
  });

  it.each(FIELDS)("escalates when %s has no value even if not marked uncertain", (field) => {
    expect(evaluate(withField(field, { value: null, isUncertain: false }))).toMatchObject({
      outcome: "ESCALATE",
      compared: { unreadable: field },
    });
  });

  it("records the raw text of an unreadable field and the evidence of a contradicted one", () => {
    const invoice = withField("reference", { isUncertain: true });
    invoice.extraction.payee = { ...invoice.extraction.payee, evidence: "From: Shady LLC" };
    expect(evaluate(invoice).compared).toMatchObject({
      referenceRaw: "INV-102",
      payeeEvidence: "From: Shady LLC",
    });
  });

  it("records the evidence that is missing from the original text", () => {
    const invoice = buildInvoice({
      sourceFormat: "EMAIL",
      sourceText: EMAIL_TEXT.replace("2,500.00", "25.00"),
    });
    expect(evaluate(invoice).compared).toMatchObject({
      amountMinorEvidence: "Total: USD 2,500.00",
    });
  });

  it("checks a chat the same way as an email", () => {
    const passing = buildInvoice({ sourceFormat: "CHAT", sourceText: EMAIL_TEXT });
    const failing = buildInvoice({ sourceFormat: "CHAT", sourceText: "hola, te envío la cuenta" });
    expect(evaluate(passing).outcome).toBe("PASS");
    expect(evaluate(failing).outcome).toBe("ESCALATE");
  });

  it("finds evidence through invisible and full-width characters in the original text", () => {
    const sourceText = EMAIL_TEXT.replace("Dev Partners", "Dev\u200B Partners").replace(
      "2,500.00",
      "\uFF12,500.00",
    );
    expect(evaluate(buildInvoice({ sourceFormat: "EMAIL", sourceText })).outcome).toBe("PASS");
  });

  it("treats a blank original text like a PDF without text", () => {
    expect(evaluate(buildInvoice({ sourceFormat: "PDF", sourceText: "  " })).outcome).toBe("PASS");
  });

  it("lists every problem in one message", () => {
    const invoice = withField("reference", { isUncertain: true });
    invoice.extraction.payee = { ...invoice.extraction.payee, evidence: null };
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      message: "R1: no se pudo leer con certeza: Referencia. falta la evidencia de: Beneficiario.",
      compared: { unreadable: "reference", withoutEvidence: "payee" },
    });
  });

  it("is wired into the engine, which still escalates while other rules are placeholders", () => {
    const decision = evaluateRules({
      invoice: buildInvoice(),
      config: buildRulesConfig(),
      configVersion: 1,
      history: [],
      now: NOW,
    });
    expect(decision.ruleResults[0]).toMatchObject({ ruleId: "R1", outcome: "PASS" });
    expect(decision.outcome).toBe("ESCALATE");
  });
});
