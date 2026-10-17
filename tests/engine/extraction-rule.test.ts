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

  it("does not search the evidence in a PDF, which has no original text", () => {
    expect(evaluate(buildInvoice({ sourceFormat: "PDF", sourceText: null })).outcome).toBe("PASS");
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
