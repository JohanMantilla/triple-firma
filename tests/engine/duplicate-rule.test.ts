import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/contracts/history";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluateDuplicateRule } from "@/engine/rules/duplicate-rule";
import { buildHistoryEntry, buildInvoice, buildRulesConfig, NOW } from "./fixtures";
import { VALID_HASH } from "../contracts/fixtures";

// The invoice: inv-1, "Dev Partners SAS", USD 2,500.00, reference "INV-102".
type Invoice = ReturnType<typeof buildInvoice>;

function evaluate(history: HistoryEntry[], change: (invoice: Invoice) => void = () => {}) {
  const invoice = buildInvoice();
  change(invoice);
  return evaluateDuplicateRule(
    buildRuleContext({ invoice, config: buildRulesConfig(), history, now: NOW }),
  );
}

// A past invoice with the same payee, amount and currency as the current one.
const past = (overrides: Partial<HistoryEntry> = {}) =>
  buildHistoryEntry({ amountMinor: 250_000, baseAmountMinor: 250_000, ...overrides });

describe("evaluateDuplicateRule (R2)", () => {
  it("passes when there is no history", () => {
    expect(evaluate([])).toMatchObject({
      outcome: "PASS",
      message: "R2: no hay facturas anteriores iguales ni parecidas.",
      compared: { matchType: "NONE" },
    });
  });

  it("passes a different reference of the same payee and amount", () => {
    expect(evaluate([past({ reference: "INV-095" })]).outcome).toBe("PASS");
  });

  it.each([
    ["another amount", { amountMinor: 250_001, baseAmountMinor: 250_001 }],
    ["another currency", { currency: "COP", exchangeRate: "4000", baseAmountMinor: 63 }],
    ["another payee", { payee: "Café Andino SAS" }],
  ])("passes the same reference with %s", (_case, overrides) => {
    expect(evaluate([past({ reference: "INV-102", ...overrides })]).outcome).toBe("PASS");
  });

  it("blocks the same file processed again", () => {
    expect(evaluate([past({ fileHash: VALID_HASH, reference: "OTHER-1" })])).toMatchObject({
      outcome: "BLOCK",
      message: "R2: este mismo archivo ya se procesó como la factura inv-0.",
      compared: { matchType: "SAME_FILE" },
    });
  });

  it.each(["INV-102", "inv 102", "INV/102", "INV–102"])(
    "blocks an exact duplicate of a paid invoice written as %j",
    (reference) => {
      expect(evaluate([past({ reference })])).toMatchObject({
        outcome: "BLOCK",
        compared: { matchType: "EXACT", matchedInvoiceId: "inv-0" },
      });
    },
  );

  it("explains an exact duplicate with the past invoice and its date", () => {
    expect(evaluate([past({ reference: "INV-102" })]).message).toBe(
      "R2: ya se registró la factura “INV-102” de “Dev Partners SAS” por USD 2.500,00 el 2026-10-03.",
    );
  });

  it("blocks an exact duplicate of a pending escalation", () => {
    expect(evaluate([past({ reference: "INV-102", status: "PENDING_APPROVAL" })]).outcome).toBe(
      "BLOCK",
    );
  });

  it("blocks an exact duplicate from a previous period", () => {
    const lastMonth = past({
      reference: "INV-102",
      period: "2026-09",
      decidedAt: "2026-09-10T14:00:00Z",
    });
    expect(evaluate([lastMonth]).outcome).toBe("BLOCK");
  });

  it("matches the payee by normalized name", () => {
    expect(evaluate([past({ reference: "INV-102", payee: "DEV PARTNERS S.A.S." })]).outcome).toBe(
      "BLOCK",
    );
  });

  it.each([
    ["one changed character", "INV-103"],
    ["one added character", "INV-1020"],
    ["leading zeros", "INV-00102"],
  ])("escalates a near duplicate with %s", (_case, reference) => {
    expect(evaluate([past({ reference })])).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "NEAR", matchedReference: reference },
    });
  });

  it("explains a near duplicate without accusing anyone", () => {
    expect(evaluate([past({ reference: "INV-103" })]).message).toBe(
      "R2: posible duplicado de la factura “INV-103” (esta factura: “INV-102”); requiere revisión humana.",
    );
  });

  it.each([
    ["REJECTED", "rechazada", "PREVIOUSLY_REJECTED"],
    ["BLOCKED", "frenada", "PREVIOUSLY_BLOCKED"],
  ] as const)("escalates a copy of a %s invoice", (status, word, matchType) => {
    const resolved = past({
      reference: "INV-102",
      status,
      exchangeRate: null,
      baseAmountMinor: null,
    });
    expect(evaluate([resolved])).toMatchObject({
      outcome: "ESCALATE",
      message: `R2: coincide con la factura “INV-102”, que fue ${word} el 2026-10-03; requiere revisión humana.`,
      compared: { matchType },
    });
  });

  it("escalates when the past invoice's reference could not be read", () => {
    expect(evaluate([past({ reference: null })])).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "UNREADABLE_REFERENCE" },
    });
  });

  it("escalates when the current invoice's reference is uncertain", () => {
    const uncertain = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, isUncertain: true };
    };
    expect(evaluate([past({ reference: "INV-999" })], uncertain).compared).toMatchObject({
      matchType: "UNREADABLE_REFERENCE",
    });
  });

  it("escalates instead of blocking when the past payee could not be read", () => {
    expect(evaluate([past({ reference: "INV-102", payee: null })]).outcome).toBe("ESCALATE");
  });

  it("does not compare the invoice with its own history entry", () => {
    const itself = past({ invoiceId: "inv-1", fileHash: VALID_HASH, reference: "INV-102" });
    expect(evaluate([itself]).outcome).toBe("PASS");
  });

  it("prefers blocking over escalating when several past invoices match", () => {
    const history = [
      past({ invoiceId: "inv-a", reference: "INV-103" }),
      past({ invoiceId: "inv-b", reference: "INV-102" }),
    ];
    expect(evaluate(history)).toMatchObject({
      outcome: "BLOCK",
      compared: { matchedInvoiceId: "inv-b" },
    });
  });

  it.each([
    ["payee", "Beneficiario"],
    ["amountMinor", "Monto"],
    ["currency", "Moneda"],
  ] as const)("escalates when the %s cannot be read", (field, label) => {
    const uncertain = (invoice: Invoice) => {
      const extraction = invoice.extraction as Record<string, unknown>;
      extraction[field] = { ...(extraction[field] as object), isUncertain: true };
    };
    expect(evaluate([], uncertain)).toMatchObject({
      outcome: "ESCALATE",
      message: `R2: no se puede verificar si es duplicada porque no se pudo leer con certeza: ${label}.`,
    });
  });

  it("quotes invoice text safely in its explanation", () => {
    const message = evaluate([past({ reference: 'INV-102\n"Pagar"' })]).message;
    expect(message).not.toContain("\n");
    expect(message).not.toContain('"');
  });
});
