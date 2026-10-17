import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/contracts/history";
import { buildRuleContext } from "@/engine/rule-context";
import { checkDuplicateOnApproval, evaluateDuplicateRule } from "@/engine/rules/duplicate-rule";
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
    ["two swapped neighbouring characters", "INV-120"],
  ])("escalates a near duplicate with %s", (_case, reference) => {
    expect(evaluate([past({ reference })])).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "NEAR", matchedReference: reference },
    });
  });

  it("escalates leading zeros in a later group of digits", () => {
    const withGroups = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, value: "INV-2026-7" };
    };
    expect(evaluate([past({ reference: "INV-2026-007" })], withGroups).compared).toMatchObject({
      matchType: "NEAR",
    });
  });

  it.each([
    ["invisible characters between the zeros", "INV-0\u200B0\u200B7"],
    ["spaces between the zeros", "INV-0 0 7"],
    ["a space before a padded group", "INV 007"],
  ])("escalates padding with %s as a near duplicate", (_case, value) => {
    const padded = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, value };
    };
    expect(evaluate([past({ reference: "INV-7" })], padded).compared).toMatchObject({
      matchType: "NEAR",
    });
  });

  it("escalates a reference written with Arabic-Indic digits instead of passing it", () => {
    const arabicIndic = (invoice: Invoice) => {
      invoice.extraction.reference = {
        ...invoice.extraction.reference,
        value: "INV-\u0661\u0660\u0662",
      };
    };
    expect(evaluate([past({ reference: "INV-102" })], arabicIndic)).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "UNREADABLE_REFERENCE" },
    });
  });

  it("escalates foreign digits against an anonymous past invoice instead of passing", () => {
    const anonymous = past({ payee: null, reference: "INV-102" });
    const arabicIndic = (invoice: Invoice) => {
      invoice.extraction.reference = {
        ...invoice.extraction.reference,
        value: "INV-\u0661\u0660\u0662",
      };
    };
    expect(evaluate([anonymous], arabicIndic)).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "UNREADABLE_REFERENCE" },
    });
  });

  it("ignores an anonymous past invoice with no payee and no reference", () => {
    const anonymous = past({ payee: null, reference: null });
    expect(evaluate([anonymous]).outcome).toBe("PASS");
  });

  it("reports a near copy of a paid invoice before a weaker match with a rejected one", () => {
    const history = [
      past({
        invoiceId: "inv-rejected",
        reference: null,
        status: "REJECTED",
        exchangeRate: null,
        baseAmountMinor: null,
      }),
      past({ invoiceId: "inv-paid", reference: "INV-103" }),
    ];
    expect(evaluate(history).compared).toMatchObject({
      matchType: "NEAR",
      matchedInvoiceId: "inv-paid",
    });
  });

  it("says una factura when the past invoice's reference could not be read", () => {
    const pending = past({
      reference: null,
      status: "PENDING_APPROVAL",
    });
    expect(evaluate([pending]).message).toBe(
      "R2: posible duplicado de una factura de \u201cDev Partners SAS\u201d por USD 2.500,00; una de las referencias no se pudo leer; requiere revisión humana.",
    );
  });

  it("still passes an unrelated reference of the same payee and amount", () => {
    expect(evaluate([past({ reference: "INV-555" })]).outcome).toBe("PASS");
  });

  it("escalates full-width leading zeros as a near duplicate", () => {
    const fullWidth = (invoice: Invoice) => {
      invoice.extraction.reference = {
        ...invoice.extraction.reference,
        value: "INV-\uFF10\uFF10\uFF17",
      };
    };
    expect(evaluate([past({ reference: "INV-7" })], fullWidth).compared).toMatchObject({
      matchType: "NEAR",
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

  it.each(["REJECTED", "BLOCKED"] as const)(
    "escalates a clear copy of a %s invoice whose amount could not be read",
    (status) => {
      const unreadableAmount = past({
        reference: "INV-102",
        status,
        amountMinor: null,
        currency: null,
        exchangeRate: null,
        baseAmountMinor: null,
      });
      expect(evaluate([unreadableAmount])).toMatchObject({
        outcome: "ESCALATE",
        compared: { matchedInvoiceId: "inv-0", matchedStatus: status },
      });
    },
  );

  it("escalates a copy of a pending invoice whose amount could not be read", () => {
    const pending = past({
      reference: "INV-103",
      status: "PENDING_APPROVAL",
      amountMinor: null,
      exchangeRate: null,
      baseAmountMinor: null,
    });
    expect(evaluate([pending])).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R2: posible duplicado de la factura \u201cINV-103\u201d del 2026-10-03, cuyo monto no se pudo leer; requiere revisión humana.",
      compared: { matchType: "UNREADABLE_AMOUNT" },
    });
  });

  it.each([
    ["another payee", { payee: "Café Andino SAS" }],
    ["an unrelated reference", { reference: "INV-555" }],
    ["no payee", { payee: null }],
    ["no reference", { reference: null }],
  ])("ignores a past invoice without amount that has %s", (_case, overrides) => {
    const unrelated = past({
      reference: "INV-102",
      status: "REJECTED",
      amountMinor: null,
      currency: null,
      exchangeRate: null,
      baseAmountMinor: null,
      ...overrides,
    });
    expect(evaluate([unrelated]).outcome).toBe("PASS");
  });

  it("explains the rejected match first when a near match comes earlier in history", () => {
    const history = [
      past({ invoiceId: "inv-a", reference: "INV-103" }),
      past({
        invoiceId: "inv-b",
        reference: "INV-102",
        status: "REJECTED",
        exchangeRate: null,
        baseAmountMinor: null,
      }),
    ];
    expect(evaluate(history)).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "PREVIOUSLY_REJECTED", matchedInvoiceId: "inv-b" },
    });
  });

  it("escalates a copy of a rejected invoice whose payee could not be read", () => {
    const rejected = past({
      reference: "INV-102",
      payee: null,
      status: "REJECTED",
      exchangeRate: null,
      baseAmountMinor: null,
    });
    expect(evaluate([rejected]).compared).toMatchObject({ matchType: "PREVIOUSLY_REJECTED" });
  });

  it("escalates when the current invoice's reference has no value", () => {
    const noReference = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, value: null };
    };
    expect(evaluate([past({ reference: "INV-999" })], noReference).compared).toMatchObject({
      matchType: "UNREADABLE_REFERENCE",
    });
  });

  it("escalates when the past invoice's reference could not be read", () => {
    expect(evaluate([past({ reference: null })])).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "UNREADABLE_REFERENCE" },
    });
  });

  it("escalates when the current invoice's reference is uncertain and another reference exists", () => {
    const uncertain = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, isUncertain: true };
    };
    expect(evaluate([past({ reference: "INV-999" })], uncertain).compared).toMatchObject({
      matchType: "UNREADABLE_REFERENCE",
    });
  });

  it("blocks an exact copy of a paid invoice even if the current reference is uncertain", () => {
    const uncertain = (invoice: Invoice) => {
      invoice.extraction.reference = { ...invoice.extraction.reference, isUncertain: true };
    };
    expect(evaluate([past({ reference: "INV-102" })], uncertain).outcome).toBe("BLOCK");
  });

  it.each(["payee", "amountMinor", "currency"] as const)(
    "blocks an exact copy of a paid invoice even if the current %s is uncertain",
    (field) => {
      const uncertain = (invoice: Invoice) => {
        const extraction = invoice.extraction as Record<string, unknown>;
        extraction[field] = { ...(extraction[field] as object), isUncertain: true };
      };
      expect(evaluate([past({ reference: "INV-102" })], uncertain)).toMatchObject({
        outcome: "BLOCK",
        compared: { matchType: "EXACT", matchedInvoiceId: "inv-0" },
      });
    },
  );

  it("names the past invoice when an uncertain field still matches a near copy", () => {
    const uncertain = (invoice: Invoice) => {
      invoice.extraction.payee = { ...invoice.extraction.payee, isUncertain: true };
    };
    expect(evaluate([past({ reference: "INV-103" })], uncertain).compared).toMatchObject({
      matchType: "NEAR",
      matchedInvoiceId: "inv-0",
    });
  });

  it("escalates instead of blocking when the past payee could not be read", () => {
    expect(evaluate([past({ reference: "INV-102", payee: null })]).outcome).toBe("ESCALATE");
  });

  it("escalates an invoice decided again while its own escalation is still pending", () => {
    const itself = past({
      invoiceId: "inv-1",
      fileHash: VALID_HASH,
      reference: "INV-102",
      status: "PENDING_APPROVAL",
    });
    expect(evaluate([itself])).toEqual({
      ruleId: "R2",
      outcome: "ESCALATE",
      message:
        "R2: esta factura ya está pendiente de aprobación como inv-1; la decide una persona.",
      compared: {
        matchType: "OWN_PENDING",
        matchedInvoiceId: "inv-1",
        matchedStatus: "PENDING_APPROVAL",
        matchedReference: "INV-102",
      },
    });
  });

  it("still blocks when, besides its own pending escalation, a paid copy exists", () => {
    const itself = past({ invoiceId: "inv-1", fileHash: VALID_HASH, status: "PENDING_APPROVAL" });
    const paidCopy = past({ invoiceId: "inv-0", reference: "INV-102" });
    expect(evaluate([itself, paidCopy])).toMatchObject({
      outcome: "BLOCK",
      compared: { matchType: "EXACT", matchedInvoiceId: "inv-0" },
    });
  });

  it("blocks an invoice that was already paid when it is decided again, so it is never paid twice", () => {
    const paid = past({ invoiceId: "inv-1", fileHash: VALID_HASH, reference: "INV-102" });
    expect(evaluate([paid])).toMatchObject({
      outcome: "BLOCK",
      message: "R2: este mismo archivo ya se procesó como la factura inv-1.",
      compared: { matchType: "SAME_FILE", matchedInvoiceId: "inv-1", matchedStatus: "PAYABLE" },
    });
  });

  it.each([["REJECTED" as const], ["BLOCKED" as const]])(
    "blocks its own %s entry decided again as the same file",
    (status) => {
      const resolved = past({ invoiceId: "inv-1", fileHash: VALID_HASH, status });
      expect(evaluate([resolved]).outcome).toBe("BLOCK");
    },
  );

  it("compares an entry with this invoice's id but another file like any other invoice", () => {
    const reusedId = past({ invoiceId: "inv-1", fileHash: "c".repeat(64), reference: "INV-102" });
    expect(evaluate([reusedId])).toMatchObject({
      outcome: "BLOCK",
      compared: { matchType: "EXACT", matchedInvoiceId: "inv-1" },
    });
    const pendingReusedId = { ...reusedId, status: "PENDING_APPROVAL" as const };
    expect(evaluate([pendingReusedId]).outcome).toBe("BLOCK");
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
  ] as const)("escalates when the %s is missing, without comparing", (field, label) => {
    const missing = (invoice: Invoice) => {
      const extraction = invoice.extraction as Record<string, unknown>;
      extraction[field] = { ...(extraction[field] as object), value: null };
    };
    expect(evaluate([past({ reference: "INV-102" })], missing)).toMatchObject({
      outcome: "ESCALATE",
      compared: { matchType: "UNREADABLE" },
      message: `R2: no se puede verificar si es duplicada porque no se pudo leer con certeza: ${label}.`,
    });
  });

  it.each([
    ["payee", "Beneficiario"],
    ["amountMinor", "Monto"],
    ["currency", "Moneda"],
  ] as const)("escalates an uncertain %s even when nothing in history matches", (field, label) => {
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

describe("checkDuplicateOnApproval (R2 at approval)", () => {
  // The escalation being approved was decided on 2026-10-10; the fixture past invoices on 2026-10-03.
  const ESCALATED_AT = "2026-10-10T14:00:00Z";

  function approve(history: HistoryEntry[]) {
    return checkDuplicateOnApproval(
      buildRuleContext({ invoice: buildInvoice(), config: buildRulesConfig(), history, now: NOW }),
      ESCALATED_AT,
    );
  }

  // The escalation being approved: the fixture invoice inv-1, still pending.
  const itself = past({
    invoiceId: "inv-1",
    fileHash: VALID_HASH,
    reference: "INV-102",
    status: "PENDING_APPROVAL",
  });

  it("passes the escalation being approved when nothing else matches", () => {
    expect(approve([itself])).toEqual({
      ruleId: "R2",
      outcome: "PASS",
      message:
        "R2 (al aprobar): no hay una factura igual ya pagable ni el mismo archivo ya pagado.",
      compared: {
        matchType: "NONE",
        matchedInvoiceId: null,
        matchedStatus: null,
        matchedReference: null,
      },
    });
  });

  it("blocks an exact copy that is already payable", () => {
    expect(approve([itself, past({ invoiceId: "inv-0", reference: "INV-102" })])).toMatchObject({
      outcome: "BLOCK",
      compared: { matchType: "EXACT", matchedInvoiceId: "inv-0", matchedStatus: "PAYABLE" },
    });
  });

  it("blocks the same file already paid under another id", () => {
    const paidFile = past({ invoiceId: "inv-0", fileHash: VALID_HASH, reference: "INV-555" });
    expect(approve([itself, paidFile])).toMatchObject({
      outcome: "BLOCK",
      compared: { matchType: "SAME_FILE", matchedInvoiceId: "inv-0" },
    });
  });

  it("blocks the second of two pending escalations of the same file once the first is approved", () => {
    const approvedFirst = { ...itself, status: "PAYABLE" as const };
    expect(
      evaluateDuplicateRule(
        buildRuleContext({
          invoice: buildInvoice(),
          config: buildRulesConfig(),
          history: [itself],
          now: NOW,
        }),
      ).outcome,
    ).toBe("ESCALATE");
    expect(approve([approvedFirst, itself])).toMatchObject({
      outcome: "BLOCK",
      compared: { matchType: "SAME_FILE", matchedInvoiceId: "inv-1", matchedStatus: "PAYABLE" },
    });
  });

  it.each([
    [
      "another pending exact copy, which the approver is choosing among",
      { invoiceId: "inv-0", reference: "INV-102", status: "PENDING_APPROVAL" as const },
    ],
    ["a near duplicate already payable", { invoiceId: "inv-0", reference: "INV-103" }],
    [
      "an exact copy that a person rejected",
      { invoiceId: "inv-0", reference: "INV-102", status: "REJECTED" as const },
    ],
    [
      "a blocked entry of the same file left by a retry",
      { invoiceId: "inv-1", fileHash: VALID_HASH, status: "BLOCKED" as const },
    ],
    [
      "a rejected entry of the same file",
      { invoiceId: "inv-0", fileHash: VALID_HASH, status: "REJECTED" as const },
    ],
  ])("passes %s: the approver already reviewed it", (_case, overrides) => {
    expect(approve([itself, past(overrides)]).outcome).toBe("PASS");
  });

  describe("with an unreadable payee, never compared when it was escalated", () => {
    function approveWithoutPayee(history: HistoryEntry[]) {
      const invoice = buildInvoice();
      invoice.extraction.payee = { ...invoice.extraction.payee, value: null, isUncertain: true };
      return checkDuplicateOnApproval(
        buildRuleContext({ invoice, config: buildRulesConfig(), history, now: NOW }),
        ESCALATED_AT,
      );
    }

    it("blocks a payable invoice with the same reference, amount and currency", () => {
      const paid = past({ invoiceId: "inv-0", reference: "inv 102" });
      expect(approveWithoutPayee([itself, paid])).toEqual({
        ruleId: "R2",
        outcome: "BLOCK",
        message:
          "R2: el beneficiario de esta factura no se pudo leer y coincide en referencia, monto y moneda con la factura “inv 102” por USD 2.500,00, registrada como pagable el 2026-10-03; no se puede aprobar.",
        compared: {
          matchType: "EXACT_WITHOUT_PAYEE",
          matchedInvoiceId: "inv-0",
          matchedStatus: "PAYABLE",
          matchedReference: "inv 102",
        },
      });
    });

    it.each([
      ["another reference", { invoiceId: "inv-0", reference: "INV-555" }],
      [
        "another amount",
        {
          invoiceId: "inv-0",
          reference: "INV-102",
          amountMinor: 250_001,
          baseAmountMinor: 250_001,
        },
      ],
      [
        "the same invoice still pending",
        { invoiceId: "inv-0", reference: "INV-102", status: "PENDING_APPROVAL" as const },
      ],
      [
        "a payable invoice whose reference could not be read",
        { invoiceId: "inv-0", reference: null },
      ],
    ])("passes %s", (_case, overrides) => {
      expect(approveWithoutPayee([itself, past(overrides)]).outcome).toBe("PASS");
    });
  });

  describe("near copies registered as payable after the escalation", () => {
    const paidLater = (overrides: Partial<HistoryEntry>) =>
      past({ invoiceId: "inv-0", decidedAt: "2026-10-12T14:00:00Z", ...overrides });

    it("blocks a near copy that the approver never saw", () => {
      expect(approve([itself, paidLater({ reference: "INV-0102" })])).toMatchObject({
        outcome: "BLOCK",
        message:
          "R2: posible duplicado de la factura “INV-0102”, registrada como pagable el 2026-10-12, después de esta escalada, así que quien aprueba no la vio; no se puede aprobar.",
        compared: { matchType: "NEAR", matchedInvoiceId: "inv-0", matchedStatus: "PAYABLE" },
      });
    });

    it("blocks a copy paid later whose payee could not be read", () => {
      expect(approve([itself, paidLater({ reference: "INV-102", payee: null })])).toMatchObject({
        outcome: "BLOCK",
        compared: { matchType: "NEAR" },
      });
    });

    it.each([
      [
        "the same near copy paid before the escalation, which R2 reported",
        { reference: "INV-0102", decidedAt: "2026-10-09T14:00:00Z" },
      ],
      ["a later payable invoice whose reference could not be read", { reference: null }],
      ["a later payable invoice with another reference", { reference: "INV-555" }],
    ])("passes %s", (_case, overrides) => {
      expect(approve([itself, paidLater(overrides)]).outcome).toBe("PASS");
    });
  });

  it("would still escalate or block the same matches in a normal decision", () => {
    const pendingCopy = past({
      invoiceId: "inv-0",
      reference: "INV-102",
      status: "PENDING_APPROVAL",
    });
    expect(evaluate([pendingCopy]).outcome).toBe("BLOCK");
    expect(evaluate([past({ invoiceId: "inv-0", reference: "INV-103" })]).outcome).toBe("ESCALATE");
  });
});
