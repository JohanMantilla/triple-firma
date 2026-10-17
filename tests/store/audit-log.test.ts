import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { appendAuditEntry, canonicalJson, hashAuditEntry } from "@/store/audit-log";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("appendAuditEntry", () => {
  it("numbers entries from 1 and links each one to the previous hash", async () => {
    const first = await appendAuditEntry(db, "RULES_CONFIG_CHANGE", { version: 1 }, NOW);
    const second = await appendAuditEntry(db, "DECISION", { decisionId: "decision-1" }, NOW);

    expect(first).toMatchObject({ seq: 1, prevHash: null });
    expect(second).toMatchObject({ seq: 2, prevHash: first.hash });
    expect(second.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hash).not.toBe(first.hash);
    expect(await countAuditEntries(db)).toBe(2);
  });

  it("hashes each entry together with the previous hash", async () => {
    const first = await appendAuditEntry(db, "RULES_CONFIG_CHANGE", { version: 1 }, NOW);
    const second = await appendAuditEntry(db, "DECISION", { decisionId: "decision-1" }, NOW);
    const expected = hashAuditEntry({
      seq: 2,
      type: "DECISION",
      payload: { decisionId: "decision-1" },
      prevHash: first.hash,
      createdAt: NOW,
    });
    expect(second.hash).toBe(expected);
  });

  it("refuses to store a payload that is not JSON", async () => {
    await expect(appendAuditEntry(db, "DECISION", { amount: 1n }, NOW)).rejects.toThrow();
    expect(await countAuditEntries(db)).toBe(0);
  });

  it("rejects UPDATE and DELETE on the log", async () => {
    await appendAuditEntry(db, "DECISION", { decisionId: "decision-1" }, NOW);
    await expect(db.execute("UPDATE audit_entries SET payload_json = '{}'")).rejects.toThrow(
      "append-only",
    );
    await expect(db.execute("DELETE FROM audit_entries")).rejects.toThrow("append-only");
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    const value = { b: 1, a: { d: [3, { f: 1, e: 2 }], c: null } };
    expect(canonicalJson(value)).toBe('{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}');
  });

  it("gives the same hash whatever order the keys were written in", () => {
    const fields = { seq: 1, type: "DECISION", prevHash: null, createdAt: NOW };
    expect(hashAuditEntry({ ...fields, payload: { a: 1, b: 2 } })).toBe(
      hashAuditEntry({ ...fields, payload: { b: 2, a: 1 } }),
    );
  });
});
