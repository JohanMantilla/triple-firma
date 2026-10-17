// True when two strings are equal or differ in a single character, changed, added or removed
// ("Corp" vs "C0rp", "FAC102" vs "FAC1020"). Compares code points, so emoji and astral letters count
// as one character. Shared by R3 (lookalike payees) and R2 (near duplicate references).
export function isWithinOneEdit(a: string, b: string): boolean {
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
