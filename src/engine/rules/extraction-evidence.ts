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

function isSignedOrPartOfOtherNumber(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).trimEnd().at(-1) ?? "";
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
  if (currency === "USD" && text.includes("US$")) return true;
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

// The year (4 digits), day and month of the ISO due date must all appear in the evidence; the month
// may be a number or an English or Spanish name ("Oct 30, 2026", "30/10/2026", "30 de octubre de 2026").
export function isDueDateSupported(isoDate: string, evidence: string): boolean {
  const [year, month, day] = isoDate.split("-");
  const text = normalizeForSearch(evidence);
  const numbers = text.match(/\d+/g) ?? [];
  const isDayOrMonth = (target: string) => (number: string) =>
    number.length <= 2 && Number(number) === Number(target);

  if (!removeFirst(numbers, (number) => number === year)) return false;
  if (!removeFirst(numbers, isDayOrMonth(day))) return false;
  return removeFirst(numbers, isDayOrMonth(month)) || hasMonthName(text, Number(month));
}

// Removes the first item that matches, so the same number cannot count as both day and month.
function removeFirst(items: string[], matches: (item: string) => boolean): boolean {
  const index = items.findIndex(matches);
  if (index === -1) return false;
  items.splice(index, 1);
  return true;
}

function hasMonthName(text: string, month: number): boolean {
  const words = text.split(/[^\p{L}]+/u);
  return MONTH_NAMES[month - 1].some((name) => words.includes(name));
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
