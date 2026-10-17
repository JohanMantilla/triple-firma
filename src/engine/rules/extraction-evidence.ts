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
// ("2,500", "1.500"). Whole numbers are compared, so "2500" never matches inside "250000".
export function isAmountSupported(amountMinor: number, evidence: string): boolean {
  const target = BigInt(amountMinor);
  const numbers = evidence.normalize("NFKC").match(/\d[\d.,]*\d|\d/g) ?? [];
  return numbers.some((number) => toMinorUnits(number) === target);
}

// Currency and due date are normalized by the extraction, so their raw text must be in the evidence.
export function isRawSupported(raw: string | null, evidence: string): boolean {
  if (raw === null || raw.trim() === "") return false;
  return normalizeForSearch(evidence).includes(normalizeForSearch(raw));
}

function toMinorUnits(number: string): bigint {
  const lastSeparator = Math.max(number.lastIndexOf("."), number.lastIndexOf(","));
  const fraction = lastSeparator === -1 ? "" : number.slice(lastSeparator + 1);
  const hasDecimals = fraction.length === 1 || fraction.length === 2;
  const integerDigits = (hasDecimals ? number.slice(0, lastSeparator) : number).replace(
    /[.,]/g,
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
