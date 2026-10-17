import { z } from "zod";

// The single definition of "same payee name", shared by config validation and R3 so they never disagree.
// It ignores case, extra spaces, invisible characters, compatibility forms (full-width "Corp") and the periods
// and commas of legal suffixes ("Corp." = "Corp", "S.A.S." = "SAS"). Every other character is kept:
// "A&B" vs "AB", "Dev-Partners" vs "Dev Partners", "Cafe" vs "Café" or a Cyrillic "a" (U+0430) are not exact
// matches, so R3 treats them as near matches and escalates them.
export function normalizePayee(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const PayeeNameSchema = z
  .string()
  .max(200)
  .refine(
    (name) => /[\p{L}\p{N}]/u.test(normalizePayee(name)),
    "Payee name must contain a letter or a digit",
  );
