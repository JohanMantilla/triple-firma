import { IsoDateTimeSchema, type Period } from "@/contracts/dates";
import { type HistoryEntry, HistoryEntrySchema } from "@/contracts/history";
import { type Invoice, InvoiceSchema } from "@/contracts/invoice";
import { type ExchangeRate, isSupportedCurrency } from "@/contracts/money";
import { type RulesConfig, RulesConfigSchema } from "@/contracts/rules-config";
import { convertToBaseMinor } from "./convert-to-base";

// Everything a rule may read, computed once per invoice so every rule sees the same money and period.
// It is deeply frozen: a rule cannot change what the next rule sees or what the decision records.
export type RuleContext = Readonly<{
  invoice: Invoice;
  config: RulesConfig;
  history: readonly HistoryEntry[];
  now: string;
  period: Period;
  amountMinor: number | null;
  currency: string | null;
  exchangeRate: ExchangeRate | null;
  baseAmountMinor: number | null;
}>;

export type RuleContextInput = {
  invoice: Invoice;
  config: RulesConfig;
  history: readonly HistoryEntry[];
  now: string;
};

// The engine never trusts its caller: invoice, config and history are parsed with their contracts, so
// a stored config with a missing limit throws here instead of letting a rule compare against undefined.
// Parsing also returns fresh copies, which are frozen without touching the caller's objects.
export function buildRuleContext(input: RuleContextInput): RuleContext {
  const invoice = InvoiceSchema.parse(input.invoice);
  const config = RulesConfigSchema.parse(input.config);
  const history = input.history.map((entry) => HistoryEntrySchema.parse(entry));
  const validNow = IsoDateTimeSchema.parse(input.now);
  const amountMinor = invoice.extraction.amountMinor.value;
  const currency = invoice.extraction.currency.value;
  const configuredRate =
    currency !== null && isSupportedCurrency(currency) ? config.exchangeRates[currency] : undefined;
  const baseAmountMinor =
    amountMinor !== null && configuredRate !== undefined
      ? convertToBaseMinor(amountMinor, configuredRate)
      : null;

  return deepFreeze({
    invoice,
    config,
    history,
    now: validNow,
    period: toPeriod(validNow, config.timezone),
    amountMinor,
    currency,
    // The rate is recorded only together with the base amount it produced.
    exchangeRate: baseAmountMinor !== null && configuredRate !== undefined ? configuredRate : null,
    baseAmountMinor,
  });
}

// "2026-11-01T03:30:00Z" is still October in America/New_York. Parsing the injected timestamp is
// deterministic; the engine never reads the current time.
export function toPeriod(isoUtc: string, timezone: string): Period {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(isoUtc));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
