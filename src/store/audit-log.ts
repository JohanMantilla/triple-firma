import { createHash } from "node:crypto";
import {
  type AuditEntry,
  AuditEntrySchema,
  type AuditEntryType,
  type AuditVerification,
  AuditVerificationSchema,
} from "@/contracts/audit-entry";
import type { Row } from "@libsql/client";
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
  // Hash the payload as the schema keeps it (it can differ from the raw one, e.g. an own "__proto__"
  // key is dropped), so verifyAuditChain recomputes exactly what was hashed.
  const draft = AuditEntrySchema.parse({
    seq,
    type,
    payload,
    prevHash,
    createdAt,
    hash: "0".repeat(64),
  });
  const entry = AuditEntrySchema.parse({
    ...draft,
    hash: hashAuditEntry({ seq, type, payload: draft.payload, prevHash, createdAt }),
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

// JSON values only.
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

// Walks the log in order and stops at the first entry whose position, link or hash does not match.
// It detects edits to stored entries. Whoever controls the database can still rebuild the whole
// chain, which is why the UI shows lastHash as an external anchor (PROPUESTA section 10).
export async function verifyAuditChain(db: Executor): Promise<AuditVerification> {
  const { rows } = await db.execute(
    "SELECT seq, type, payload_json, prev_hash, hash, created_at FROM audit_entries ORDER BY seq",
  );
  let firstInvalidSeq: number | null = null;
  let prevHash: string | null = null;
  for (const [index, row] of rows.entries()) {
    const isValid =
      Number(row.seq) === index + 1 &&
      row.prev_hash === prevHash &&
      recomputeHash(row) === row.hash;
    if (!isValid) {
      firstInvalidSeq = index + 1;
      break;
    }
    prevHash = String(row.hash);
  }
  const last = rows.at(-1);
  return AuditVerificationSchema.parse({
    isValid: firstInvalidSeq === null,
    entryCount: rows.length,
    firstInvalidSeq,
    lastHash: last === undefined ? null : String(last.hash),
  });
}

// null when the stored payload is no longer JSON: that entry counts as broken.
function recomputeHash(row: Row): string | null {
  try {
    return hashAuditEntry({
      seq: Number(row.seq),
      type: String(row.type),
      payload: JSON.parse(String(row.payload_json)),
      prevHash: row.prev_hash === null ? null : String(row.prev_hash),
      createdAt: String(row.created_at),
    });
  } catch {
    return null;
  }
}
