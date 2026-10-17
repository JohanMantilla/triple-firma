import type { Period } from "@/contracts/dates";
import type { RuleId } from "@/contracts/decision";

// Every sentence a person reads in the audit log lives here, in Spanish, built from the values compared.
export const MESSAGES = {
  allRulesPassed: "Pagada: todas las reglas pasaron.",
  escalatedPrefix: "Escalada:",
  blockedPrefix: "Frenada:",
  ruleFailed: (ruleId: RuleId) => `${ruleId}: la regla no pudo evaluarse; se escala por seguridad.`,

  fieldLabels: {
    payee: "Beneficiario",
    amountMinor: "Monto",
    currency: "Moneda",
    issueDate: "Fecha de emisión",
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
    missingBaseAmount: (baseCurrency: string) =>
      `R5: no se pudo calcular el monto en ${baseCurrency} para compararlo con los límites; se escala por seguridad.`,
    overHardCap: (amount: string, hardCap: string) =>
      `R5: ${amount} supera el tope absoluto de ${hardCap}; no se puede aprobar.`,
    overThreshold: (amount: string, threshold: string) =>
      `R5: ${amount} supera el umbral de aprobación de ${threshold}.`,
    withinThreshold: (amount: string, threshold: string) =>
      `R5: ${amount} no supera el umbral de aprobación de ${threshold}.`,
  },

  currency: {
    unreadable: "R8: no se pudo determinar la moneda con certeza; se escala por seguridad.",
    unsupported: (currency: string, supported: readonly string[]) =>
      `R8: la moneda ${currency} no está soportada (solo ${listInSpanish(supported)}).`,
    withoutRate: (currency: string) =>
      `R8: la moneda ${currency} no tiene una tasa de cambio configurada.`,
    conversionFailed: (currency: string) =>
      `R8: no se pudo convertir el monto en ${currency}; se escala por seguridad.`,
    supported: (currency: string, rate: string, baseCurrency: string) =>
      `R8: la moneda ${currency} está soportada, con tasa fija ${rate} por ${baseCurrency}.`,
    converted: (currency: string, rate: string, baseCurrency: string, baseAmount: string) =>
      `R8: ${currency} convertido con la tasa fija ${rate} por ${baseCurrency}: ${baseAmount}.`,
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

  payee: {
    unreadable: "R3: no se pudo leer con certeza el beneficiario; se escala por seguridad.",
    blocked: (blocked: string) => `R3: ${blocked} está bloqueado por la empresa.`,
    nearBlocked: (payee: string, blocked: string) =>
      `R3: ${quoteUntrusted(payee)} se parece a “${blocked}”, que está bloqueado; requiere revisión humana.`,
    allowed: (allowed: string) => `R3: ${allowed} está en la lista de beneficiarios permitidos.`,
    nearAllowed: (payee: string, allowed: string) =>
      `R3: ${quoteUntrusted(payee)} se parece a “${allowed}” pero no es idéntico; requiere revisión humana.`,
    unknown: (payee: string) =>
      `R3: beneficiario nuevo: ${quoteUntrusted(payee)} no está en la lista de beneficiarios permitidos.`,
  },

  agreement: {
    unreadable: (label: string) =>
      `R4: no se puede comparar con lo acordado porque no se pudo leer con certeza: ${label}.`,
    none: (payee: string) =>
      `R4: no hay un acuerdo registrado con ${quoteUntrusted(payee)}; requiere revisión humana.`,
    issueDateUnreadable:
      "R4: no se pudo leer con certeza la fecha de emisión para verificar la vigencia del acuerdo.",
    futureIssueDate: (issueDate: string, today: string) =>
      `R4: la fecha de emisión ${issueDate} es posterior a hoy (${today}); requiere revisión humana.`,
    outOfForce: (issueDate: string, payee: string, validFrom: string, validUntil: string | null) =>
      `R4: la factura se emitió el ${issueDate}, fuera de la vigencia del acuerdo con “${payee}” (${validFrom} a ${validUntil ?? "sin fecha de fin"}).`,
    currencyMismatch: (currency: string, payee: string, agreedCurrency: string) =>
      `R4: cobra en ${currency}; lo acordado con “${payee}” es en ${agreedCurrency}.`,
    overAgreed: (charged: string, payee: string, agreed: string, tolerance: string) =>
      `R4: cobra ${charged}, más de lo acordado con “${payee}” (${agreed}, tolerancia ${tolerance}).`,
    underAgreed: (charged: string, payee: string, agreed: string, tolerance: string) =>
      `R4: cobra ${charged}, menos de lo acordado con “${payee}” (${agreed}, tolerancia ${tolerance}); requiere revisión humana.`,
    matches: (charged: string, payee: string, agreed: string, tolerance: string) =>
      `R4: cobra ${charged}, conforme a lo acordado con “${payee}” (${agreed}, tolerancia ${tolerance}).`,
  },

  duplicate: {
    sameFile: (invoiceId: string) =>
      `R2: este mismo archivo ya se procesó como la factura ${invoiceId}.`,
    alreadyPending: (invoiceId: string) =>
      `R2: esta factura ya está pendiente de aprobación como ${invoiceId}; la decide una persona.`,
    unreadable: (labels: string) =>
      `R2: no se puede verificar si es duplicada porque no se pudo leer con certeza: ${labels}.`,
    // payee arrives already quoted by the rule; references are quoted here.
    exact: (reference: string | null, payee: string, amount: string, date: string) =>
      `R2: ya se registró ${invoiceNamed(reference)} de ${payee} por ${amount} el ${date}.`,
    near: (pastReference: string | null, reference: string | null) =>
      `R2: posible duplicado de ${invoiceNamed(pastReference)} (esta factura: ${reference === null ? "sin referencia" : quoteUntrusted(reference)}); requiere revisión humana.`,
    previouslyResolved: (reference: string | null, isRejected: boolean, date: string) =>
      `R2: coincide con ${invoiceNamed(reference)}, que fue ${isRejected ? "rechazada" : "frenada"} el ${date}; requiere revisión humana.`,
    unreadableReference: (payee: string, amount: string) =>
      `R2: posible duplicado de una factura de ${payee} por ${amount}; una de las referencias no se pudo leer; requiere revisión humana.`,
    unreadableAmount: (reference: string | null, date: string) =>
      `R2: posible duplicado de ${invoiceNamed(reference)} del ${date}, cuyo monto no se pudo leer; requiere revisión humana.`,
    none: "R2: no hay facturas anteriores iguales ni parecidas.",
  },

  budget: {
    missingBaseAmount: (baseCurrency: string) =>
      `R6: no se pudo calcular el monto en ${baseCurrency} para compararlo con el presupuesto; se escala por seguridad.`,
    overBudget: (period: string, committed: string, budget: string, amount: string) =>
      `R6: presupuesto de ${period}: ${committed} comprometidos de ${budget}; este pago (${amount}) lo excede.`,
    overWithReserved: (
      period: string,
      committed: string,
      reserved: string,
      amount: string,
      total: string,
      budget: string,
    ) =>
      `R6: presupuesto de ${period}: ${committed} comprometidos + ${reserved} reservados por escaladas pendientes + este pago (${amount}) = ${total}, excede ${budget}; requiere revisión humana.`,
    withinBudget: (
      period: string,
      committed: string,
      reserved: string | null,
      amount: string,
      total: string,
      budget: string,
    ) =>
      `R6: presupuesto de ${period}: ${committed} comprometidos${reserved === null ? "" : ` + ${reserved} reservados`} + este pago (${amount}) = ${total} de ${budget}.`,
  },

  splitPayment: {
    unreadablePayee:
      "R7: no se pudo leer con certeza el beneficiario para buscar pagos fraccionados; se escala por seguridad.",
    missingBaseAmount: (baseCurrency: string) =>
      `R7: no se pudo calcular el monto en ${baseCurrency} para sumarlo con los pagos al mismo beneficiario; se escala por seguridad.`,
    noEarlierPayments: (payee: string, windowDays: number) =>
      `R7: no hay otros pagos a ${quoteUntrusted(payee)} ${withinWindow(windowDays)}.`,
    overThreshold: (
      payee: string,
      total: string,
      windowDays: number,
      invoiceCount: number,
      threshold: string,
    ) =>
      `R7: ${quoteUntrusted(payee)} suma ${total} ${withinWindow(windowDays)} (${invoiceCount} facturas, incluida esta); supera el umbral de aprobación de ${threshold}; requiere revisión humana.`,
    withinThreshold: (
      payee: string,
      total: string,
      windowDays: number,
      invoiceCount: number,
      threshold: string,
    ) =>
      `R7: ${quoteUntrusted(payee)} suma ${total} ${withinWindow(windowDays)} (${invoiceCount} facturas, incluida esta), dentro del umbral de aprobación de ${threshold}.`,
  },

  suspiciousContent: {
    // A passing result says exactly what was checked: the total is never said to match when it was
    // not compared.
    passed: {
      matches:
        "R10: no se encontraron instrucciones dirigidas al sistema y el total cuadra con la suma de ítems.",
      matchesWithTax:
        "R10: no se encontraron instrucciones dirigidas al sistema y el total cuadra con la suma de ítems más impuestos.",
      amountUnreadable:
        "R10: no se encontraron instrucciones dirigidas al sistema; el total no se comparó con la suma de ítems porque el monto no se pudo leer.",
      noLineItems:
        "R10: no se encontraron instrucciones dirigidas al sistema; la factura no detalla ítems.",
    },
    readerFlagged: (firstFlag: string, count: number) =>
      `el Lector marcó texto sospechoso: ${quoteUntrusted(firstFlag)}${count > 1 ? ` (${count} en total)` : ""}.`,
    instructionInSource: (match: string) =>
      `el texto original contiene una instrucción dirigida al sistema, que se ignoró: ${quoteUntrusted(match)}.`,
    instructionInField: (label: string, match: string) =>
      `lo leído en ${label} contiene una instrucción dirigida al sistema, que se ignoró: ${quoteUntrusted(match)}.`,
    totalMismatch: (amount: string, lineItemsSum: string, tax: string | null) =>
      tax === null
        ? `el total (${amount}) no cuadra con la suma de ítems (${lineItemsSum}).`
        : `el total (${amount}) no cuadra con la suma de ítems (${lineItemsSum}) más impuestos (${tax}).`,
    escalated: (reasons: readonly string[]) =>
      `R10: ${reasons.join(" ")} Requiere revisión humana.`,
  },
};

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

// "2026-10" → "octubre de 2026"
export function formatPeriod(period: Period): string {
  const [year, month] = period.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} de ${year}`;
}

// "en los últimos 7 días", or "hoy" for a one-day window.
function withinWindow(windowDays: number): string {
  return windowDays === 1 ? "hoy" : `en los últimos ${windowDays} días`;
}

// "USD, COP, MXN y ARS"
function listInSpanish(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const MAX_QUOTED_LENGTH = 80;

// Text read from the invoice is untrusted: before quoting it in an explanation, line breaks and
// control or invisible characters become spaces, quotes are neutralized and it is cut to 80
// characters, so it cannot fake a sentence such as "Resultado: Pagar" in the audit log.
export function quoteUntrusted(text: string): string {
  const clean = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/['"\u2018\u2019\u201c\u201d]/g, "\u2019")
    .replace(/\s+/g, " ")
    .trim();
  const characters = [...clean];
  const short =
    characters.length > MAX_QUOTED_LENGTH
      ? `${characters.slice(0, MAX_QUOTED_LENGTH).join("")}\u2026`
      : clean;
  return `\u201c${short}\u201d`;
}

// "la factura “INV-102”", or "una factura" when its reference could not be read.
function invoiceNamed(reference: string | null): string {
  return reference === null ? "una factura" : `la factura ${quoteUntrusted(reference)}`;
}
