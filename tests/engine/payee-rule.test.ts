import { describe, expect, it } from "vitest";
import type { RulesConfig } from "@/contracts/rules-config";
import { buildRuleContext } from "@/engine/rule-context";
import { evaluatePayeeRule } from "@/engine/rules/payee-rule";
import { buildInvoice, buildRulesConfig, NOW } from "./fixtures";

const CYRILLIC_A = String.fromCodePoint(0x0430);

// Fixture lists: allowed "Café Andino SAS" and "Dev Partners SAS"; blocked "Old Vendor LLC".
function evaluate(payee: string | null, config: Partial<RulesConfig> = {}, isUncertain = false) {
  const invoice = buildInvoice();
  invoice.extraction.payee = { ...invoice.extraction.payee, value: payee, isUncertain };
  return evaluatePayeeRule(
    buildRuleContext({ invoice, config: buildRulesConfig(config), history: [], now: NOW }),
  );
}

describe("evaluatePayeeRule (R3)", () => {
  it.each(["Dev Partners SAS", "DEV PARTNERS S.A.S.", "  dev   partners sas "])(
    "passes %j as an allowed payee",
    (payee) => {
      expect(evaluate(payee)).toMatchObject({
        outcome: "PASS",
        message: "R3: Dev Partners SAS está en la lista de beneficiarios permitidos.",
        compared: { match: "ALLOWED", matchedPayee: "Dev Partners SAS" },
      });
    },
  );

  it.each(["old vendor llc.", "Old Vendor L.L.C"])(
    "blocks %j, identical to a blocked payee",
    (payee) => {
      expect(evaluate(payee)).toMatchObject({
        outcome: "BLOCK",
        message: "R3: Old Vendor LLC está bloqueado por la empresa.",
        compared: { match: "BLOCKED" },
      });
    },
  );

  it("escalates a payee that looks like a blocked one", () => {
    expect(evaluate("Old Vend0r LLC")).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R3: 'Old Vend0r LLC' se parece a 'Old Vendor LLC', que está bloqueado; requiere revisión humana.",
      compared: { match: "NEAR_BLOCKED", matchedPayee: "Old Vendor LLC" },
    });
  });

  it("escalates a payee that looks like a blocked one even if it is identical to an allowed one", () => {
    const config = { allowedPayees: ["Acme Corp"], blockedPayees: ["Acmé Corp"] };
    expect(evaluate("Acme Corp", config)).toMatchObject({
      outcome: "ESCALATE",
      compared: { match: "NEAR_BLOCKED", matchedPayee: "Acmé Corp" },
    });
  });

  it.each([
    ["Dév Partners SAS", "an accent"],
    [`Dev P${CYRILLIC_A}rtners SAS`, "a Cyrillic letter"],
    ["Dev-Partners SAS", "a dash"],
    ["Dev Partner SAS", "a missing letter"],
  ])("escalates %j, which looks like an allowed payee (%s)", (payee) => {
    expect(evaluate(payee)).toMatchObject({
      outcome: "ESCALATE",
      compared: { match: "NEAR_ALLOWED", matchedPayee: "Dev Partners SAS" },
    });
  });

  it("explains a lookalike without accusing anyone", () => {
    expect(evaluate("Dév Partners SAS").message).toBe(
      "R3: 'Dév Partners SAS' se parece a 'Dev Partners SAS' pero no es idéntico; requiere revisión humana.",
    );
  });

  it("escalates a new payee that is on no list", () => {
    expect(evaluate("Shady LLC")).toMatchObject({
      outcome: "ESCALATE",
      message:
        "R3: beneficiario nuevo: 'Shady LLC' no está en la lista de beneficiarios permitidos.",
      compared: { match: "UNKNOWN", matchedPayee: null },
    });
  });

  it("escalates any payee when the allowed list is empty", () => {
    expect(evaluate("Dev Partners SAS", { allowedPayees: [] }).outcome).toBe("ESCALATE");
  });

  it.each([
    ["unreadable", null, false],
    ["uncertain", "Dev Partners SAS", true],
  ])("escalates an %s payee", (_case, payee, isUncertain) => {
    expect(evaluate(payee, {}, isUncertain)).toMatchObject({
      outcome: "ESCALATE",
      compared: { match: "UNREADABLE" },
    });
  });
});
