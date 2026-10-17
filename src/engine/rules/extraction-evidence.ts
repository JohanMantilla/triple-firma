import { normalizePayee } from "@/contracts/payee";
import { normalizeReference } from "@/contracts/reference";

// Deterministic checks that a field's evidence actually supports the value the reader extracted.
// They never trust the reader: a value that the evidence does not show makes R1 escalate.

// Case, invisible characters, compatibility forms and runs of whitespace do not change the text.
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// In emails and chats the original text is read from the file, not by the LLM, so evidence the reader
// invented or altered is caught when it is not in that text. Without original text (PDF, image or
// blank) there is nothing to search and the check passes.
export function isEvidenceInSource(evidence: string, sourceText: string | null): boolean {
  if (sourceText === null || sourceText.trim() === "") return true;
  return normalizeForSearch(sourceText).includes(normalizeForSearch(evidence));
}

// The payee must appear as whole words: "Acme Corp" is not supported by "Acme Corporation".
export function isPayeeSupported(value: string, evidence: string): boolean {
  return containsAsWords(normalizePayee(evidence), normalizePayee(value));
}

// The reference must equal one or a few consecutive words of the evidence, after normalizeReference:
// "Invoice INV 102" supports "INV-102", but "FAC-10" does not support "FAC-1".
export function isReferenceSupported(value: string, evidence: string): boolean {
  const target = normalizeReference(value);
  const words = evidence.split(/\s+/).filter((word) => word !== "");
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= Math.min(start + 3, words.length); end++) {
      if (normalizeReference(words.slice(start, end).join(" ")) === target) return true;
    }
  }
  return false;
}

// Some number in the evidence must be worth exactly amountMinor. A separator followed by 1 or 2
// digits is the decimal mark ("2.500,00", "2,500.00", "2.5"); otherwise separators group thousands
// ("2,500", "1.500", "2 500,00"). Whole numbers are compared, so "2500" never matches inside "250000".
// Numbers that cannot be a positive amount to pay are ignored: negative or in parentheses
// ("-2,500.00", "(2,500.00)") and parts of dates, percentages or codes ("30/10/2026", "19%", "INV-102").
export function isAmountSupported(amountMinor: number, evidence: string): boolean {
  const target = BigInt(amountMinor);
  const text = evidence.normalize("NFKC");
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const start = match.index;
    const end = start + match[0].length;
    if (isSignedOrPartOfOtherNumber(text, start, end)) continue;
    if (toMinorUnits(match[0]) === target) return true;
  }
  return false;
}

// Digits with "." or "," inside, or a space followed by exactly three digits (thousands grouping).
const AMOUNT_PATTERN = /\d(?:[\d.,]| (?=\d{3}(?!\d)))*\d|\d/g;

const CURRENCY_MARKER_AT_END = /(?:[A-Za-z]{0,3}\$|[A-Za-z]{3}|[€£¥])$/;

function isSignedOrPartOfOtherNumber(text: string, start: number, end: number): boolean {
  // Skip a currency symbol or code between the sign and the digits: "-$2,500.00", "(USD 2,500.00)".
  const prefix = text.slice(0, start).trimEnd().replace(CURRENCY_MARKER_AT_END, "").trimEnd();
  const before = prefix.at(-1) ?? "";
  const touchingBefore = text[start - 1] ?? "";
  const touchingAfter = text[end] ?? "";
  const isSigned = /^[\p{Pd}\u2212(]$/u.test(before);
  const isPartOfDateOrCode = touchingBefore === "/" || /^[\/%\p{Pd}]$/u.test(touchingAfter);
  return isSigned || isPartOfDateOrCode;
}

// The ISO code of the currency must appear as a word ("USD 2,500.00"); "US$" also means USD. A bare
// "$" is ambiguous (Colombia, Mexico and Argentina use it too), so it does not support any currency.
export function isCurrencySupported(currency: string, evidence: string): boolean {
  const text = evidence.normalize("NFKC").toUpperCase();
  if (currency === "USD" && /(^|[^A-Z])US\$/.test(text)) return true;
  return new RegExp(`(^|[^A-Z])${currency}([^A-Z]|$)`).test(text);
}

// Full names and abbreviations, in English and Spanish, matched as whole words ("sep" is September,
// but "separado" is not).
const MONTH_NAMES: readonly (readonly string[])[] = [
  ["jan", "january", "ene", "enero"],
  ["feb", "february", "febrero"],
  ["mar", "march", "marzo"],
  ["apr", "april", "abr", "abril"],
  ["may", "mayo"],
  ["jun", "june", "junio"],
  ["jul", "july", "julio"],
  ["aug", "august", "ago", "agosto"],
  ["sep", "sept", "september", "set", "septiembre", "setiembre"],
  ["oct", "october", "octubre"],
  ["nov", "november", "noviembre"],
  ["dec", "december", "dic", "diciembre"],
];

// The ISO date (due date or issue date) must be written as ONE date in the evidence, in a real date
// format, so pieces of two dates ("15/01/2026 ... 10/03/2026") never combine into a third one:
// - numbers joined by "/", "-" or ".", with a 4-digit year first or last: "30/10/2026", "2026-10-30";
// - day, then month name: "30 de octubre de 2026", "30 oct 2026";
// - month name, then day: "Oct 30, 2026", "Dec. 1, 2026".
// Whether "05/10/2026" means May or October is the extraction's call (it marks an ambiguous date as
// uncertain); here both readings are accepted.
export function isDateSupported(isoDate: string, evidence: string): boolean {
  const [year, month, day] = isoDate.split("-").map(Number);
  const text = normalizeForSearch(evidence);
  const isTarget = (y: string, m: number, d: string) =>
    Number(y) === year && m === month && Number(d) === day;

  for (const [, first, second, third] of text.matchAll(NUMERIC_DATE)) {
    if (first.length === 4 && isTarget(first, Number(second), third)) return true;
    if (third.length === 4 && isTarget(third, Number(second), first)) return true;
    if (third.length === 4 && isTarget(third, Number(first), second)) return true;
  }
  for (const [, dayPart, monthName, yearPart] of text.matchAll(DAY_MONTH_NAME_DATE)) {
    if (isTarget(yearPart, monthOf(monthName), dayPart)) return true;
  }
  for (const [, monthName, dayPart, yearPart] of text.matchAll(MONTH_NAME_DAY_DATE)) {
    if (isTarget(yearPart, monthOf(monthName), dayPart)) return true;
  }
  return false;
}

const NUMERIC_DATE = /(?<!\d)(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?!\d)/g;
const DAY_MONTH_NAME_DATE = /(?<!\d)(\d{1,2}) (?:de )?(\p{L}+)\.?,? (?:de |del )?(\d{4})(?!\d)/gu;
const MONTH_NAME_DAY_DATE = /(\p{L}+)\.? (\d{1,2}),? (\d{4})(?!\d)/gu;

// 1-12 for an English or Spanish month name or abbreviation, 0 for any other word.
function monthOf(word: string): number {
  return MONTH_NAMES.findIndex((names) => names.includes(word)) + 1;
}

function toMinorUnits(number: string): bigint {
  const lastSeparator = Math.max(number.lastIndexOf("."), number.lastIndexOf(","));
  const fraction = lastSeparator === -1 ? "" : number.slice(lastSeparator + 1);
  const hasDecimals = fraction.length === 1 || fraction.length === 2;
  const integerDigits = (hasDecimals ? number.slice(0, lastSeparator) : number).replace(
    /[., ]/g,
    "",
  );
  const cents = hasDecimals ? fraction.padEnd(2, "0") : "00";
  return BigInt(integerDigits + cents);
}

function containsAsWords(text: string, words: string): boolean {
  if (words === "") return false;
  let index = text.indexOf(words);
  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + words.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    index = text.indexOf(words, index + 1);
  }
  return false;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}
