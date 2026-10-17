import { IsoDateTimeSchema, type Period } from "@/contracts/dates";
import type { HistoryEntry } from "@/contracts/history";
import type { Invoice } from "@/contracts/invoice";
import { type ExchangeRate, isSupportedCurrency } from "@/contracts/money";
import type { RulesConfig } from "@/contracts/rules-config";
import { convertToBaseMinor } from "./convert-to-base";

// Everything a rule may read, computed once per invoice so every rule sees the same money and period.
export type RuleContext = {
  invoice: Invoice;
  config: RulesConfig;
  history: readonly HistoryEntry[];
  now: string;
  period: Period;
  amountMinor: number | null;
  currency: string | null;
  exchangeRate: ExchangeRate | null;
  baseAmountMinor: number | null;
};

export type RuleContextInput = {
  invoice: Invoice;
  config: RulesConfig;
  history: readonly HistoryEntry[];
  now: string;
};

export function buildRuleContext({ invoice, config, history, now }: RuleContextInput): RuleContext {
  const validNow = IsoDateTimeSchema.parse(now);
  const amountMinor = invoice.extraction.amountMinor.value;
  const currency = invoice.extraction.currency.value;
  const configuredRate =
    currency !== null && isSupportedCurrency(currency) ? config.exchangeRates[currency] : undefined;
  const baseAmountMinor =
    amountMinor !== null && configuredRate !== undefined
      ? convertToBaseMinor(amountMinor, configuredRate)
      : null;

  return {
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
  };
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
