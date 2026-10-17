import { describe, expect, it } from "vitest";
import { type AuditEntry, AuditEntrySchema } from "@/contracts/audit-entry";
import { VALID_HASH } from "./fixtures";

function buildEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    seq: 2,
    type: "DECISION",
    payload: { decisionId: "dec-1", outcome: "PAY" },
    prevHash: VALID_HASH,
    hash: "b".repeat(64),
    createdAt: "2026-10-17T10:00:00-04:00",
    ...overrides,
  };
}

describe("AuditEntrySchema", () => {
  it("accepts a chained entry", () => {
    expect(AuditEntrySchema.safeParse(buildEntry()).success).toBe(true);
  });

  it("accepts the first entry without prevHash", () => {
    expect(AuditEntrySchema.safeParse(buildEntry({ seq: 1, prevHash: null })).success).toBe(true);
  });

  it("rejects a later entry without prevHash", () => {
    expect(AuditEntrySchema.safeParse(buildEntry({ prevHash: null })).success).toBe(false);
  });

  it("rejects the first entry with a prevHash", () => {
    expect(AuditEntrySchema.safeParse(buildEntry({ seq: 1 })).success).toBe(false);
  });

  it.each(["abc", "A".repeat(64), "g".repeat(64)])("rejects the hash %s", (hash) => {
    expect(AuditEntrySchema.safeParse(buildEntry({ hash })).success).toBe(false);
  });

  it("rejects a payload that is not JSON", () => {
    expect(
      AuditEntrySchema.safeParse(buildEntry({ payload: { at: new Date() } as never })).success,
    ).toBe(false);
  });
});
