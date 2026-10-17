import { z } from "zod";
import { IsoDateTimeSchema } from "./dates";
import { Sha256Schema } from "./invoice";

export const AuditEntryTypeSchema = z.enum(["DECISION", "APPROVAL", "RULES_CONFIG_CHANGE"]);
export type AuditEntryType = z.infer<typeof AuditEntryTypeSchema>;

// Append-only. hash = SHA-256 of the canonical JSON of the entry plus prevHash; the first entry has no prevHash.
export const AuditEntrySchema = z
  .object({
    seq: z.int().positive(),
    type: AuditEntryTypeSchema,
    payload: z.json(),
    prevHash: Sha256Schema.nullable(),
    hash: Sha256Schema,
    createdAt: IsoDateTimeSchema,
  })
  .refine((entry) => (entry.seq === 1) === (entry.prevHash === null), {
    message: "Only the first entry (seq 1) has no prevHash",
    path: ["prevHash"],
  });
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// Result of walking the chain. firstInvalidSeq is the position of the first entry whose position, link
// or hash does not match. lastHash is the hash stored in the last entry, shown in the UI as an external
// anchor; it is a plain string because a tampered row may hold anything.
export const AuditVerificationSchema = z
  .object({
    isValid: z.boolean(),
    entryCount: z.int().nonnegative(),
    firstInvalidSeq: z.int().positive().nullable(),
    lastHash: z.string().nullable(),
  })
  .refine((result) => result.isValid === (result.firstInvalidSeq === null), {
    message: "A chain is valid exactly when no entry is invalid",
    path: ["firstInvalidSeq"],
  })
  .refine((result) => (result.entryCount === 0) === (result.lastHash === null), {
    message: "lastHash is null exactly when the log is empty",
    path: ["lastHash"],
  });
export type AuditVerification = z.infer<typeof AuditVerificationSchema>;
