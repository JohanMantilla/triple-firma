import { createHash } from "node:crypto";
import { type AuditEntry, AuditEntrySchema, type AuditEntryType } from "@/contracts/audit-entry";
import type { Executor } from "./db";

type HashedFields = {
  seq: number;
  type: string;
  payload: unknown;
  prevHash: string | null;
  createdAt: string;
};

// Appends one entry inside the caller's write transaction. AuditEntrySchema requires the hash and the
// link to the previous entry from the start, and validates that the payload is JSON. The table
// rejects UPDATE and DELETE, so the log only grows.
export async function appendAuditEntry(
  db: Executor,
  type: AuditEntryType,
  payload: unknown,
  createdAt: string,
): Promise<AuditEntry> {
  const { rows } = await db.execute(
    "SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1",
  );
  const last = rows[0];
  const seq = last === undefined ? 1 : Number(last.seq) + 1;
  const prevHash = last === undefined ? null : String(last.hash);
  const entry = AuditEntrySchema.parse({
    seq,
    type,
    payload,
    prevHash,
    createdAt,
    hash: hashAuditEntry({ seq, type, payload, prevHash, createdAt }),
  });
  await db.execute({
    sql: `INSERT INTO audit_entries (seq, type, payload_json, prev_hash, hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      entry.seq,
      entry.type,
      JSON.stringify(entry.payload),
      entry.prevHash,
      entry.hash,
      entry.createdAt,
    ],
  });
  return entry;
}

// SHA-256 of the canonical JSON of the whole entry except the hash itself. prevHash is included, so
// changing an earlier entry breaks every hash after it.
export function hashAuditEntry(fields: HashedFields): string {
  return createHash("sha256").update(canonicalJson(fields)).digest("hex");
}

// JSON with object keys sorted at every level: the same entry always hashes the same, whatever order
// its keys were built or stored in.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
