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
