import { z } from "zod";

// The single definition of "same invoice reference", used by R2 so a resubmitted copy is caught even if
// it was retyped: it ignores case, invisible characters, compatibility forms and the separators people
// add or drop ("FAC-102", "fac 102", "FAC/102", "FAC.102" are the same). It keeps every other
// character, so a different digit ("FAC-103") or leading zeros ("FAC-0102") are near duplicates for R2.
export function normalizeReference(reference: string): string {
  return reference
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .toUpperCase()
    .replace(/[\s\-_./#:]/g, "");
}

export const ReferenceSchema = z
  .string()
  .max(100)
  .refine(
    (reference) => normalizeReference(reference).length > 0,
    "Reference must have visible characters",
  );
