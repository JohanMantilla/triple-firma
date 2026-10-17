import { normalizePayee } from "@/contracts/payee";

// Cyrillic and Greek letters that look like Latin ones, written as code points so the source has no
// lookalike characters: [code point, Latin letter].
const LOOKALIKE_LETTERS: readonly (readonly [number, string])[] = [
  [0x0430, "a"],
  [0x0435, "e"],
  [0x043e, "o"],
  [0x0440, "p"],
  [0x0441, "c"],
  [0x0443, "y"],
  [0x0445, "x"],
  [0x0456, "i"],
  [0x0458, "j"],
  [0x0455, "s"],
  [0x04bb, "h"],
  [0x03b1, "a"],
  [0x03b5, "e"],
  [0x03b9, "i"],
  [0x03ba, "k"],
  [0x03bd, "v"],
  [0x03bf, "o"],
  [0x03c1, "p"],
  [0x03c4, "t"],
  [0x03c5, "u"],
  [0x03c7, "x"],
];
const LATIN_FOR = new Map(
  LOOKALIKE_LETTERS.map(([codePoint, latin]) => [String.fromCodePoint(codePoint), latin]),
);

// A looser form than normalizePayee, only to detect names that look alike: no accents, lookalike
// letters from other scripts read as Latin, and no symbols or spaces ("Acmé C-orp" -> "acmecorp").
export function loosePayee(name: string): string {
  return [...normalizePayee(name).normalize("NFD").replace(/\p{M}/gu, "")]
    .map((character) => LATIN_FOR.get(character) ?? character)
    .join("")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

// Two names that are not identical look alike when their loose forms are equal or differ in a single
// character (changed, added or removed): "Acmé Corp", "A&B Corp" vs "AB Corp", "Acme C0rp".
export function isNearPayee(a: string, b: string): boolean {
  const looseA = loosePayee(a);
  const looseB = loosePayee(b);
  return looseA !== "" && looseB !== "" && isWithinOneEdit(looseA, looseB);
}

function isWithinOneEdit(a: string, b: string): boolean {
  const first = [...a];
  const second = [...b];
  if (Math.abs(first.length - second.length) > 1) return false;
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];

  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index++;
  if (index === shorter.length) return true;

  const restOfShorter = shorter.slice(shorter.length === longer.length ? index + 1 : index);
  const restOfLonger = longer.slice(index + 1);
  return restOfShorter.join("") === restOfLonger.join("");
}
