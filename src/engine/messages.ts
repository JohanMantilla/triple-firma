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
    valueNotSupported: (labels: string) => `la evidencia no respalda el valor leído de: ${labels}.`,
    evidenceNotInSource: (labels: string) =>
      `la evidencia de ${labels} no aparece en el texto original.`,
    escalated: (reasons: readonly string[]) => `R1: ${reasons.join(" ")}`,
  },

  paymentLimit: {
    missingBaseAmount:
      "R5: no se pudo calcular el monto en USD para compararlo con los límites; se escala por seguridad.",
    overHardCap: (amount: string, hardCap: string) =>
      `R5: ${amount} supera el tope absoluto de ${hardCap}; no se puede aprobar.`,
    overThreshold: (amount: string, threshold: string) =>
      `R5: ${amount} supera el umbral de aprobación de ${threshold}.`,
    withinThreshold: (amount: string, threshold: string) =>
      `R5: ${amount} no supera el umbral de aprobación de ${threshold}.`,
  },

  currency: {
    unreadable: "R8: no se pudo determinar la moneda con certeza; se escala por seguridad.",
    unsupported: (currency: string) =>
      `R8: la moneda ${currency} no está soportada (solo USD, COP, MXN y ARS).`,
    withoutRate: (currency: string) =>
      `R8: la moneda ${currency} no tiene una tasa de cambio configurada.`,
    conversionFailed: (currency: string) =>
      `R8: no se pudo convertir el monto en ${currency}; se escala por seguridad.`,
    supported: (currency: string, rate: string) =>
      `R8: la moneda ${currency} está soportada, con tasa fija ${rate} por USD.`,
    converted: (currency: string, rate: string, baseAmount: string) =>
      `R8: ${currency} convertido con la tasa fija ${rate} por USD: ${baseAmount}.`,
  },

  dueDate: {
    unreadable: "R9: no se pudo leer con certeza la fecha de vencimiento; se escala por seguridad.",
    tooOverdue: (dueDate: string, daysOverdue: number, maxDaysOverdue: number) =>
      `R9: venció el ${dueDate}, hace ${daysOverdue} días; la política admite hasta ${maxDaysOverdue}.`,
    tooFarAhead: (dueDate: string, daysAhead: number, maxDaysAhead: number) =>
      `R9: vence el ${dueDate}, dentro de ${daysAhead} días; la política admite hasta ${maxDaysAhead}.`,
    withinPolicy: (dueDate: string, daysUntilDue: number) =>
      daysUntilDue < 0
        ? `R9: venció el ${dueDate}, hace ${-daysUntilDue} días, dentro de la política.`
        : `R9: vence el ${dueDate}, dentro de ${daysUntilDue} días, dentro de la política.`,
  },
};
