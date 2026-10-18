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

type YearLastDate = { first: number; second: number; year: string; separator: string };

// "30/10/2026": two small numbers and a 4-digit year last. The order of the first two is not known.
function splitYearLastDate(text: string): YearLastDate | null {
  const match = NUMERIC_DATE.exec(text);
  const [, first = "", separator = "", second = "", year = ""] = match ?? [];
  if (!match || year.length !== 4 || first.length > 2) return null;
  return { first: Number(first), second: Number(second), year, separator };
}

// "2026-10-30" and "30/10/2026" (day first only when the order is unambiguous).
function parseNumericDate(text: string): string | null {
  const match = NUMERIC_DATE.exec(text);
  if (!match) return null;
  const [, first = "", , second = "", third = ""] = match;
  if (first.length === 4 && third.length <= 2) return toIsoDate(first, second, third);

  const date = splitYearLastDate(text);
  if (!date) return null;
  const { first: a, second: b, year } = date;
  if (a === b) return toIsoDate(year, b, a);
  if (a > 12 && b <= 12) return toIsoDate(year, b, a);
  if (b > 12 && a <= 12) return toIsoDate(year, a, b);
  return null;
}

type DateOrder = "DMY" | "MDY";

// The order a numeric date proves by itself: "18/10/2026" can only be day first. Null when the date
// is ambiguous or not a real date.
function provenDateOrder(text: string): { order: DateOrder; separator: string } | null {
  const date = splitYearLastDate(text);
  if (!date || parseNumericDate(text) === null) return null;
  if (date.first > 12) return { order: "DMY", separator: date.separator };
  if (date.second > 12) return { order: "MDY", separator: date.separator };
  return null;
}

// Reads an ambiguous date ("03/04/2026") in the order another date of the same document proves.
// Only a numeric date with the same separator counts: a month name or an ISO date says nothing
// about how this writer orders day and month.
function inferDateOrder(text: string, evidenceText: string | null): string | null {
  const date = splitYearLastDate(text);
  const isAmbiguous =
    date !== null && date.first !== date.second && Math.max(date.first, date.second) <= 12;
  if (!isAmbiguous || evidenceText === null) return null;
  const proof = provenDateOrder(evidenceText);
  if (proof?.separator !== date.separator) return null;
  return proof.order === "DMY"
    ? toIsoDate(date.year, date.second, date.first)
    : toIsoDate(date.year, date.first, date.second);
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

type ResolvedDate = { value: string | null; isInferred: boolean };

// Both dates of one document, each read alone and, when that is ambiguous, in the order the other
// date proves. As a control, an inferred date that puts the due date before the issue date is
// dropped: a wrong guess then escalates instead of passing.
export function resolveDocumentDates(
  issueRaw: string | null,
  dueRaw: string | null,
): { issueDate: ResolvedDate; dueDate: ResolvedDate } {
  const resolve = (raw: string | null, other: string | null): ResolvedDate => {
    if (raw === null) return { value: null, isInferred: false };
    const alone = normalizeDate(raw);
    if (alone !== null) return { value: alone, isInferred: false };
    const inferred = inferDateOrder(raw.trim(), other?.trim() ?? null);
    return { value: inferred, isInferred: inferred !== null };
  };
  const issueDate = resolve(issueRaw, dueRaw);
  const dueDate = resolve(dueRaw, issueRaw);

  const isInverted =
    issueDate.value !== null && dueDate.value !== null && dueDate.value < issueDate.value;
  const drop = (date: ResolvedDate): ResolvedDate =>
    date.isInferred && isInverted ? { value: null, isInferred: false } : date;
  return { issueDate: drop(issueDate), dueDate: drop(dueDate) };
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
  isResolved = false,
): NormalizedField<T> {
  const parsed = schema.safeParse(candidate);
  const value = parsed.success ? parsed.data : null;
  return {
    raw: source.raw,
    value,
    evidence: source.evidence,
    // A date resolved from the rest of the document no longer needs the reader's ambiguity flag.
    isUncertain: (source.isUncertain && !(isResolved && value !== null)) || value === null,
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
    lineItemAmountStrings,
  } = response;
  // Each item as printed; an unreadable one stays null in its place so R10 escalates it. R10 adds them up.
  const lineItemAmountsMinor = lineItemAmountStrings.map(normalizeAmount);
  const dates = resolveDocumentDates(issueDateString.raw, dueDateString.raw);

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
      dates.issueDate.value,
      dates.issueDate.isInferred,
    ),
    dueDate: buildField(
      dueDateString,
      IsoDateSchema,
      dates.dueDate.value,
      dates.dueDate.isInferred,
    ),
    reference: buildField(reference, ReferenceSchema, reference.value?.trim()),
    lineItemsSumMinor: null,
    lineItemAmountsMinor: lineItemAmountsMinor.length === 0 ? null : lineItemAmountsMinor,
    suspiciousText: response.suspiciousText,
  };
}
