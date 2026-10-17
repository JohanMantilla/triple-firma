import { z } from "zod";

// The single definition of "same payee name", shared by config validation and R3 so they never disagree.
// It ignores case, punctuation, extra spaces, invisible characters and compatibility forms ("Ｃｏｒｐ").
// It keeps accents and letters from other scripts, so "Cafe" vs "Café" or a Cyrillic "а" is not an
// exact match: R3 treats those as near matches and escalates them.
export function normalizePayee(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toLowerCase()
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const PayeeNameSchema = z
  .string()
  .max(200)
  .refine((name) => normalizePayee(name).length > 0, "Payee name must have visible characters");
