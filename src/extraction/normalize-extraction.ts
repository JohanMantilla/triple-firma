import type { z } from "zod";
import { IsoDateSchema } from "@/contracts/dates";
import type { Extraction } from "@/contracts/extraction";
import { CurrencyCodeSchema, PositiveMinorAmountSchema } from "@/contracts/money";
import { PayeeNameSchema } from "@/contracts/payee";
import { ReferenceSchema } from "@/contracts/reference";
import type { ReaderField, ReaderResponse } from "./reader";

// Turns what the reader copied from the document into the typed Extraction. It reads the verbatim
// `raw` text for amounts, currencies and dates, never the reader's own `value`, so the LLM does no
// arithmetic. Anything ambiguous becomes null (and the field uncertain): R1 then escalates.

// ── Amounts ──────────────────────────────────────────────────────────────────

const AMOUNT_TOKEN = /\d+(?:[.,\s'’]\d+)*/g;
const GROUP_SEPARATOR = /[.,\s'’]/;
const NEGATIVE_AMOUNT = /[-\u2212(]\s*\d/;

// Groups of an integer part: "1.500.000" or "1 500". The first group has 1-3 digits and no leading
// zero, the others exactly 3, and one separator character is used throughout.
function joinGroupedDigits(text: string): string | null {
  const groups = text.split(GROUP_SEPARATOR);
  if (groups.length === 1) return text;
  if (new Set(text.match(/[.,\s'’]/g)).size > 1) return null;
  const [first, ...rest] = groups;
  if (!/^[1-9]\d{0,2}$/.test(first ?? "")) return null;
  if (!rest.every((group) => /^\d{3}$/.test(group))) return null;
  return groups.join("");
}

// Splits a numeric token into whole digits and decimal digits. Every supported currency has 2
// decimals, so a single separator followed by 3 digits ("1,500", "1.500") is a thousands separator.
function splitAmountToken(token: string): { whole: string; decimals: string } | null {
  const lastSeparator = Math.max(token.lastIndexOf("."), token.lastIndexOf(","));
  if (lastSeparator === -1) {
    const whole = joinGroupedDigits(token);
    return whole === null ? null : { whole, decimals: "" };
  }

  const after = token.slice(lastSeparator + 1);
  const before = token.slice(0, lastSeparator);
  const isSingleSeparator = !before.includes(token.charAt(lastSeparator));

  if (after.length <= 2 && isSingleSeparator) {
    const whole = joinGroupedDigits(before);
    return whole === null ? null : { whole, decimals: after };
  }
  if (after.length === 3) {
    const whole = joinGroupedDigits(token);
    return whole === null ? null : { whole, decimals: "" };
  }
  return null;
}

// "1.500,00", "1,500.00", "USD 2 500.5" → minor units. Null when the text has no amount, has more
// than one, is negative or its format is ambiguous. Integer arithmetic only: no parseFloat.
export function normalizeAmount(raw: string): number | null {
  if (NEGATIVE_AMOUNT.test(raw)) return null;
  const tokens = raw.match(AMOUNT_TOKEN);
  if (tokens?.length !== 1) return null;
  const parts = splitAmountToken(tokens[0] ?? "");
  if (parts === null) return null;
  const minor = Number(`${parts.whole}${parts.decimals.padEnd(2, "0")}`);
  return Number.isSafeInteger(minor) ? minor : null;
}

// ── Currency ─────────────────────────────────────────────────────────────────

// Symbols that name one currency. A bare "$" is shared by USD, COP, MXN and ARS, so it is not here.
const CURRENCY_SYMBOLS: ReadonlyArray<readonly [string, string]> = [
  ["COL$", "COP"],
  ["US$", "USD"],
  ["MX$", "MXN"],
  ["AR$", "ARS"],
  ["€", "EUR"],
  ["£", "GBP"],
];

export function normalizeCurrency(raw: string): string | null {
  const text = raw.trim();
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();

  const symbol = CURRENCY_SYMBOLS.find(([symbolText]) => text.toUpperCase().includes(symbolText));
  if (symbol) return symbol[1];

  const codes = new Set(text.match(/\b[A-Z]{3}\b/g));
  return codes.size === 1 ? ([...codes][0] ?? null) : null;
}

// ── Dates ────────────────────────────────────────────────────────────────────

const MONTH_NAMES: ReadonlyArray<readonly string[]> = [
  ["january", "jan", "enero", "ene"],
  ["february", "feb", "febrero"],
  ["march", "mar", "marzo"],
  ["april", "apr", "abril", "abr"],
  ["may", "mayo"],
  ["june", "jun", "junio"],
  ["july", "jul", "julio"],
  ["august", "aug", "agosto", "ago"],
  ["september", "sep", "sept", "septiembre", "setiembre", "set"],
  ["october", "oct", "octubre"],
  ["november", "nov", "noviembre"],
  ["december", "dec", "diciembre", "dic"],
];

const MONTH_BY_NAME = new Map(
  MONTH_NAMES.flatMap((names, index) => names.map((name) => [name, index + 1] as const)),
);

const FILLER_WORDS = new Set(["de", "del", "of", "the"]);

function toIsoDate(year: string, month: number | string, day: number | string): string | null {
  const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = IsoDateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const NUMERIC_DATE = /^(\d{1,4})([/.-])(\d{1,2})\2(\d{1,4})$/;

// "2026-10-30" and "30/10/2026" (day first only when the order is unambiguous).
function parseNumericDate(text: string): string | null {
  const match = NUMERIC_DATE.exec(text);
  if (!match) return null;
  const [, first = "", , second = "", third = ""] = match;

  if (first.length === 4 && third.length <= 2) return toIsoDate(first, second, third);
  if (third.length !== 4 || first.length > 2) return null;

  const a = Number(first);
  const b = Number(second);
  if (a === b) return toIsoDate(third, b, a);
  if (a > 12 && b <= 12) return toIsoDate(third, b, a);
  if (b > 12 && a <= 12) return toIsoDate(third, a, b);
  return null;
}

// "Oct 30, 2026", "30 October 2026", "30 de octubre de 2026": exactly one month name, a day and a year.
function parseNamedMonthDate(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[,.]/g, " ")
    .split(/\s+/)
    .filter((token) => token !== "" && !FILLER_WORDS.has(token))
    .map((token) => token.replace(/^(\d{1,2})(?:st|nd|rd|th)$/, "$1"));

  const months = tokens.filter((token) => MONTH_BY_NAME.has(token));
  const days = tokens.filter((token) => /^\d{1,2}$/.test(token));
  const years = tokens.filter((token) => /^\d{4}$/.test(token));
  const [month] = months;
  const [day] = days;
  const [year] = years;
  const isOnePerKind = months.length === 1 && days.length === 1 && years.length === 1;
  if (!isOnePerKind || tokens.length !== 3) return null;

  const monthNumber = MONTH_BY_NAME.get(month ?? "");
  if (monthNumber === undefined) return null;
  return toIsoDate(year ?? "", monthNumber, day ?? "");
}

export function normalizeDate(raw: string): string | null {
  const text = raw.trim();
  return parseNumericDate(text) ?? parseNamedMonthDate(text);
}

// ── Extraction ───────────────────────────────────────────────────────────────

type NormalizedField<T> = {
  raw: string | null;
  value: T | null;
  evidence: string | null;
  isUncertain: boolean;
};

// A value that fails its contract schema is dropped, and the field becomes uncertain.
function buildField<T>(
  source: ReaderField,
  schema: z.ZodType<T>,
  candidate: unknown,
): NormalizedField<T> {
  const parsed = schema.safeParse(candidate);
  const value = parsed.success ? parsed.data : null;
  return {
    raw: source.raw,
    value,
    evidence: source.evidence,
    isUncertain: source.isUncertain || value === null,
  };
}

export function normalizeExtraction(response: ReaderResponse): Extraction {
  const {
    payee,
    amountString,
    currencyRaw,
    issueDateString,
    dueDateString,
    reference,
    lineItemsSumString,
  } = response;
  const lineItemsSumMinor = lineItemsSumString?.raw
    ? normalizeAmount(lineItemsSumString.raw)
    : null;

  return {
    payee: buildField(payee, PayeeNameSchema, payee.value?.trim()),
    amountMinor: buildField(
      amountString,
      PositiveMinorAmountSchema,
      amountString.raw ? normalizeAmount(amountString.raw) : null,
    ),
    currency: buildField(
      currencyRaw,
      CurrencyCodeSchema,
      currencyRaw.raw ? normalizeCurrency(currencyRaw.raw) : null,
    ),
    issueDate: buildField(
      issueDateString,
      IsoDateSchema,
      issueDateString.raw ? normalizeDate(issueDateString.raw) : null,
    ),
    dueDate: buildField(
      dueDateString,
      IsoDateSchema,
      dueDateString.raw ? normalizeDate(dueDateString.raw) : null,
    ),
    reference: buildField(reference, ReferenceSchema, reference.value?.trim()),
    lineItemsSumMinor,
    suspiciousText: response.suspiciousText,
  };
}
