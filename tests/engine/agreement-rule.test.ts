import { describe, expect, it } from "vitest";
import type { Agreement, RulesConfig } from "@/contracts/rules-config";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluateAgreementRule } from "@/engine/rules/agreement-rule";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

// Fixture: the invoice is from "Dev Partners SAS" for USD 2,500.00, issued on 2026-10-01.
const AGREEMENT: Agreement = {
  payee: "Dev Partners SAS",
  amountMinor: 250_000,
  currency: "USD",
  validFrom: "2026-01-01",
  validUntil: null,
};

type Invoice = ReturnType<typeof buildInvoice>;

function evaluate(
  change: (invoice: Invoice) => void = () => {},
  config: Partial<RulesConfig> = {},
) {
  const invoice = buildInvoice();
  change(invoice);
  return evaluateAgreementRule(
    buildRuleContext({
      invoice,
      config: buildRulesConfig({ agreements: [AGREEMENT], ...config }),
      history: [],
      now: NOW,
    }),
  );
}

const withAmount = (amountMinor: number) => (invoice: Invoice) => {
  invoice.extraction.amountMinor = { ...invoice.extraction.amountMinor, value: amountMinor };
};

const issuedOn = (value: string, evidence: string) => (invoice: Invoice) => {
  invoice.extraction.issueDate = { ...invoice.extraction.issueDate, value, evidence };
};

describe("evaluateAgreementRule (R4)", () => {
  it("passes an invoice that matches the agreement exactly", () => {
    expect(evaluate()).toMatchObject({
      outcome: "PASS",
      message:
        "R4: cobra USD 2.500,00, conforme a lo acordado con “Dev Partners SAS” (USD 2.500,00, tolerancia USD 0,00).",
      compared: { agreedAmountMinor: 250_000, differenceMinor: 0 },
    });
  });

  it("blocks one cent more than agreed", () => {
    expect(evaluate(withAmount(250_001))).toMatchObject({
      outcome: "BLOCK",
      message:
        "R4: cobra USD 2.500,01, más de lo acordado con “Dev Partners SAS” (USD 2.500,00, tolerancia USD 0,00).",
      compared: { differenceMinor: 1 },
    });
  });

  it("escalates one cent less than agreed", () => {
    expect(evaluate(withAmount(249_999))).toMatchObject({
      outcome: "ESCALATE",
      compared: { differenceMinor: -1 },
    });
  });

  it.each([
    ["exactly the tolerance above", 255_000, "PASS"],
    ["exactly the tolerance below", 245_000, "PASS"],
    ["one cent above the tolerance", 255_001, "BLOCK"],
    ["one cent below the tolerance", 244_999, "ESCALATE"],
  ])("with a USD 50.00 tolerance, %s is %s", (_case, amountMinor, outcome) => {
    expect(evaluate(withAmount(amountMinor), { toleranceMinor: 5_000 }).outcome).toBe(outcome);
  });

  it("blocks an invoice in another currency than agreed", () => {
    const inCop = (invoice: Invoice) => {
      invoice.extraction.currency = { ...invoice.extraction.currency, value: "COP" };
    };
    expect(evaluate(inCop)).toMatchObject({
      outcome: "BLOCK",
      message: "R4: cobra en COP; lo acordado con “Dev Partners SAS” es en USD.",
    });
  });

  it.each([
    ["on the first day of the agreement", "2026-01-01", "Date: Jan 1, 2026", "PASS"],
    ["on the last day of the agreement", "2026-06-30", "Date: Jun 30, 2026", "PASS"],
    ["the day before it starts", "2025-12-31", "Date: Dec 31, 2025", "BLOCK"],
    ["the day after it ends", "2026-07-01", "Date: Jul 1, 2026", "BLOCK"],
  ])("an invoice issued %s is %s", (_case, value, evidence, outcome) => {
    const agreements = [{ ...AGREEMENT, validUntil: "2026-06-30" }];
    expect(evaluate(issuedOn(value, evidence), { agreements }).outcome).toBe(outcome);
  });

  it("explains an invoice issued outside the agreement", () => {
    const agreements = [{ ...AGREEMENT, validUntil: "2026-06-30" }];
    expect(evaluate(undefined, { agreements })).toMatchObject({
      outcome: "BLOCK",
      message:
        "R4: la factura se emitió el 2026-10-01, fuera de la vigencia del acuerdo con “Dev Partners SAS” (2026-01-01 a 2026-06-30).",
      compared: { validUntil: "2026-06-30" },
    });
  });

  it("uses the issue date, not today: an invoice issued during the agreement passes later", () => {
    const agreements = [{ ...AGREEMENT, validUntil: "2026-10-05" }];
    // NOW is 2026-10-17, after the agreement ended; the invoice was issued on 2026-10-01.
    expect(evaluate(undefined, { agreements }).outcome).toBe("PASS");
  });

  it("picks the agreement in force on the issue date when there are consecutive ones", () => {
    const agreements = [
      { ...AGREEMENT, validUntil: "2026-06-30" },
      { ...AGREEMENT, amountMinor: 300_000, validFrom: "2026-07-01" },
    ];
    expect(evaluate(withAmount(300_000), { agreements })).toMatchObject({
      outcome: "PASS",
      compared: { agreedAmountMinor: 300_000 },
    });
  });

  it("escalates a payee without any agreement", () => {
    const newPayee = (invoice: Invoice) => {
      invoice.extraction.payee = { ...invoice.extraction.payee, value: "Shady LLC" };
    };
    expect(evaluate(newPayee)).toMatchObject({
      outcome: "ESCALATE",
      message: "R4: no hay un acuerdo registrado con “Shady LLC”; requiere revisión humana.",
    });
  });

  it("does not use the agreement of a payee that only looks alike", () => {
    const lookalike = (invoice: Invoice) => {
      invoice.extraction.payee = { ...invoice.extraction.payee, value: "Dév Partners SAS" };
    };
    expect(evaluate(lookalike).outcome).toBe("ESCALATE");
  });

  it("matches the agreement by normalized name", () => {
    const formatted = (invoice: Invoice) => {
      invoice.extraction.payee = { ...invoice.extraction.payee, value: "DEV PARTNERS S.A.S." };
    };
    expect(evaluate(formatted).outcome).toBe("PASS");
  });

  it.each([
    ["uncertain", { isUncertain: true }],
    ["without evidence", { evidence: null }],
    ["not supported by its evidence", { evidence: "Date: Oct 2, 2026" }],
  ])("escalates an issue date that is %s", (_case, change) => {
    const invoice = (target: Invoice) => {
      target.extraction.issueDate = { ...target.extraction.issueDate, ...change };
    };
    expect(evaluate(invoice)).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R4: no se pudo leer con certeza la fecha de emisión para verificar la vigencia del acuerdo.",
    });
  });

  it("escalates an email whose issue date evidence is not in its original text", () => {
    const email = (invoice: Invoice) => {
      invoice.sourceFormat = "EMAIL";
      invoice.sourceText =
        "Cuenta de cobro de Dev Partners SAS. Fecha: 15/01/2026. Total USD 2,500.00";
    };
    expect(evaluate(email)).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R4: no se pudo leer con certeza la fecha de emisión para verificar la vigencia del acuerdo.",
    });
  });

  it("passes an email whose issue date evidence is in its original text", () => {
    const email = (invoice: Invoice) => {
      invoice.sourceFormat = "EMAIL";
      invoice.sourceText = "Dev Partners SAS. date:  oct 1, 2026. Total USD 2,500.00";
    };
    expect(evaluate(email).outcome).toBe("PASS");
  });

  it("escalates an issue date built from pieces of two different dates in its evidence", () => {
    // Issued 2026-01-15, before the agreement; the 03 comes from the due date, not the issue date.
    const agreements = [{ ...AGREEMENT, validFrom: "2026-03-01" }];
    const mixed = issuedOn("2026-03-15", "Fecha: 15/01/2026 Vence: 10/03/2026");
    expect(evaluate(mixed, { agreements }).outcome).toBe("ESCALATE");
  });

  it("escalates an unreadable issue date", () => {
    const unreadable = (invoice: Invoice) => {
      invoice.extraction.issueDate = { raw: null, value: null, evidence: null, isUncertain: true };
    };
    expect(evaluate(unreadable).outcome).toBe("ESCALATE");
  });

  it.each([
    ["payee", "Beneficiario"],
    ["amountMinor", "Monto"],
    ["currency", "Moneda"],
  ] as const)("escalates an uncertain %s", (field, label) => {
    const uncertain = (invoice: Invoice) => {
      const extraction = invoice.extraction as Record<string, unknown>;
      extraction[field] = { ...(extraction[field] as object), isUncertain: true };
    };
    expect(evaluate(uncertain)).toMatchObject({
      outcome: "ESCALATE",
      message: `R4: no se puede comparar con lo acordado porque no se pudo leer con certeza: ${label}.`,
    });
  });
});
