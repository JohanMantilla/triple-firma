import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { insertApproval } from "@/store/approval-repository";
import {
  findDecisionByFileHash,
  findDecisionRecord,
  listDecisionRecords,
  listHistoryEntries,
} from "@/store/decision-repository";
import { buildApproval, buildDecision } from "../contracts/fixtures";
import { buildStoredInvoice, openMemoryDb, storeDecision } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("listHistoryEntries", () => {
  it("maps every decision and approval to the status the engine sees", async () => {
    const cases = [
      { id: "inv-pay", outcome: "PAY", approval: null, status: "PAYABLE" },
      { id: "inv-block", outcome: "BLOCK", approval: null, status: "BLOCKED" },
      { id: "inv-pending", outcome: "ESCALATE", approval: null, status: "PENDING_APPROVAL" },
      { id: "inv-rejected", outcome: "ESCALATE", approval: "REJECTED", status: "REJECTED" },
      { id: "inv-approved", outcome: "ESCALATE", approval: "APPROVED", status: "PAYABLE" },
      {
        id: "inv-revalidated",
        outcome: "ESCALATE",
        approval: "APPROVED_BUT_BLOCKED",
        status: "BLOCKED",
      },
    ] as const;
    for (const { id, outcome, approval } of cases) {
      const decision = buildDecision(id, outcome);
      await storeDecision(db, buildStoredInvoice(id), decision);
      if (approval !== null) await insertApproval(db, buildApproval(decision, approval), "2026-10");
    }

    const history = await listHistoryEntries(db);
    expect(history.map((entry) => [entry.invoiceId, entry.status])).toEqual(
      cases.map(({ id, status }) => [id, status]),
    );
  });

  it("counts an approved escalation in the period and at the time of its approval", async () => {
    const decision = buildDecision("inv-1", "ESCALATE");
    await storeDecision(db, buildStoredInvoice("inv-1"), decision, "2026-10");
    const approval = buildApproval(decision, "APPROVED", "2026-11-02T15:00:00Z");
    await insertApproval(db, approval, "2026-11");

    const [entry] = await listHistoryEntries(db);
    expect(entry).toMatchObject({
      status: "PAYABLE",
      period: "2026-11",
      decidedAt: "2026-11-02T15:00:00Z",
      amountMinor: 250_000,
      currency: "USD",
      exchangeRate: "1",
      baseAmountMinor: 250_000,
    });
  });

  it("keeps a rejected escalation in the period and at the time of its decision", async () => {
    const decision = buildDecision("inv-1", "ESCALATE");
    await storeDecision(db, buildStoredInvoice("inv-1"), decision, "2026-10");
    await insertApproval(
      db,
      buildApproval(decision, "REJECTED", "2026-11-02T15:00:00Z"),
      "2026-11",
    );

    const [entry] = await listHistoryEntries(db);
    expect(entry).toMatchObject({
      status: "REJECTED",
      period: "2026-10",
      decidedAt: decision.decidedAt,
    });
  });

  it("keeps certain payee and reference, and leaves uncertain ones out", async () => {
    const uncertain = buildStoredInvoice("inv-uncertain");
    uncertain.extraction.payee = { ...uncertain.extraction.payee, isUncertain: true };
    uncertain.extraction.reference = { ...uncertain.extraction.reference, isUncertain: true };
    await storeDecision(db, buildStoredInvoice("inv-certain"), buildDecision("inv-certain", "PAY"));
    await storeDecision(db, uncertain, buildDecision("inv-uncertain", "ESCALATE"));

    const [certain, unreadable] = await listHistoryEntries(db);
    expect(certain).toMatchObject({ payee: "Dev Partners SAS", reference: "INV-102" });
    expect(unreadable).toMatchObject({
      payee: "Dev Partners SAS",
      reference: "INV-102",
      amountMinor: 250_000,
    });
  });
});

describe("decision records", () => {
  it("finds a record by file hash, and null for a hash never seen", async () => {
    const invoice = buildStoredInvoice("inv-1");
    await storeDecision(db, invoice, buildDecision("inv-1", "PAY"));
    expect((await findDecisionByFileHash(db, invoice.fileHash))?.decision.id).toBe(
      "decision-inv-1",
    );
    expect(await findDecisionByFileHash(db, "f".repeat(64))).toBeNull();
  });

  it("returns a record with its approval and resulting status", async () => {
    const decision = buildDecision("inv-1", "ESCALATE");
    await storeDecision(db, buildStoredInvoice("inv-1"), decision);
    await insertApproval(db, buildApproval(decision, "REJECTED"), "2026-10");

    const record = await findDecisionRecord(db, "decision-inv-1");
    expect(record).toMatchObject({
      fileName: "dev/inv-1.pdf",
      status: "REJECTED",
      approval: { action: "REJECT" },
    });
    expect(await findDecisionRecord(db, "decision-missing")).toBeNull();
  });

  it("lists newest first and filters by resulting status", async () => {
    await storeDecision(db, buildStoredInvoice("inv-a"), buildDecision("inv-a", "PAY"));
    await storeDecision(db, buildStoredInvoice("inv-b"), buildDecision("inv-b", "ESCALATE"));
    await storeDecision(db, buildStoredInvoice("inv-c"), buildDecision("inv-c", "ESCALATE"));

    const all = await listDecisionRecords(db);
    expect(all.map((record) => record.invoice.id)).toEqual(["inv-c", "inv-b", "inv-a"]);
    const pending = await listDecisionRecords(db, "PENDING_APPROVAL");
    expect(pending.map((record) => record.invoice.id)).toEqual(["inv-c", "inv-b"]);
  });

  it("refuses a second resolution of the same decision", async () => {
    const decision = buildDecision("inv-1", "ESCALATE");
    await storeDecision(db, buildStoredInvoice("inv-1"), decision);
    await insertApproval(db, buildApproval(decision, "REJECTED"), "2026-10");
    await expect(
      insertApproval(db, buildApproval(decision, "APPROVED"), "2026-10"),
    ).rejects.toThrow();
  });
});
