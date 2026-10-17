import type { RuleId } from "@/contracts/decision";

// Every sentence a person reads in the audit log lives here, in Spanish, built from the values compared.
export const MESSAGES = {
  allRulesPassed: "Pagada: todas las reglas pasaron.",
  escalatedPrefix: "Escalada:",
  blockedPrefix: "Frenada:",
  ruleNotImplemented: (ruleId: RuleId) =>
    `${ruleId}: la regla aún no está implementada; se escala por seguridad.`,
  ruleFailed: (ruleId: RuleId) => `${ruleId}: la regla no pudo evaluarse; se escala por seguridad.`,

  fieldLabels: {
    payee: "Beneficiario",
    amountMinor: "Monto",
    currency: "Moneda",
    dueDate: "Vencimiento",
    reference: "Referencia",
  },

  extraction: {
    passed: "R1: los datos obligatorios se leyeron con certeza y con evidencia.",
    unreadable: (labels: string) => `no se pudo leer con certeza: ${labels}.`,
    withoutEvidence: (labels: string) => `falta la evidencia de: ${labels}.`,
    evidenceNotInSource: (labels: string) =>
      `la evidencia de ${labels} no aparece en el texto original.`,
    escalated: (reasons: readonly string[]) => `R1: ${reasons.join(" ")}`,
  },
};
