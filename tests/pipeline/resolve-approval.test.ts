import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import type { ApprovalRequest } from "@/contracts/approval";
import { extractInvoice } from "@/extraction/extract-invoice";
import { processInvoice } from "@/pipeline/process-invoice";
import { resolveApproval } from "@/pipeline/resolve-approval";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { verifyAuditChain } from "@/store/audit-log";
import { findDecisionRecord, listHistoryEntries } from "@/store/decision-repository";
import { buildExtraction, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb } from "../store/fixtures";

vi.mock("@/extraction/extract-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/extraction/extract-invoice")>()),
  extractInvoice: vi.fn(),
}));

const extractMock = vi.mocked(extractInvoice);
const APPROVE: ApprovalRequest = { action: "APPROVE", approver: "Ana", comment: "Verificado" };
const REJECT: ApprovalRequest = { action: "REJECT", approver: "Ana", comment: "No corresponde" };

let db: Client;

// USD 2,500.00 is above the USD 2,000.00 threshold, so every upload below waits for a person.
async function escalate(name: string, reference = "INV-102"): Promise<string> {
  const extraction = buildExtraction();
  extraction.reference.value = reference;
  extractMock.mockResolvedValueOnce({ ok: true, extraction, cached: true, verification: null });
  const result = await processInvoice(
    db,
    {
      fileName: `dev/${name}.pdf`,
      fileBuffer: Buffer.from(`%PDF-1.4 ${name}`),
      sourceFormat: "PDF",
    },
    NOW,
  );
  if (!result.ok) throw new Error(result.reason);
  expect(result.record.status).toBe("PENDING_APPROVAL");
  return result.record.decision.id;
}

beforeEach(async () => {
  extractMock.mockReset();
  db = await openMemoryDb();
  await saveRulesConfig(db, buildRulesConfig(), NOW);
});

describe("resolveApproval", () => {
  it("pays an approved escalation, revalidating R2 and R6, and logs it", async () => {
    const decisionId = await escalate("a");
    const entriesBefore = await countAuditEntries(db);

    const result = await resolveApproval(db, decisionId, APPROVE, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.status).toBe("PAYABLE");
    expect(result.record.approval).toMatchObject({ resultingOutcome: "PAY", approver: "Ana" });
    expect(result.record.approval?.revalidationResults.map((r) => r.ruleId).sort()).toEqual([
      "R2",
      "R6",
    ]);
    expect(await countAuditEntries(db)).toBe(entriesBefore + 1);
    expect((await verifyAuditChain(db)).isValid).toBe(true);
  });

  it("ends a rejection in BLOCK without revalidating", async () => {
    const decisionId = await escalate("a");

    const result = await resolveApproval(db, decisionId, REJECT, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.status).toBe("REJECTED");
    expect(result.record.approval).toMatchObject({
      resultingOutcome: "BLOCK",
      revalidationResults: [],
    });
  });

  it("blocks an approval when the budget no longer fits, and keeps the reason", async () => {
    await saveRulesConfig(db, buildRulesConfig({ monthlyBudgetMinor: 400_000 }), NOW);
    const first = await escalate("a", "INV-1");
    const second = await escalate("b", "INV-2");
    await resolveApproval(db, first, APPROVE, NOW);

    const result = await resolveApproval(db, second, APPROVE, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.status).toBe("BLOCKED");
    expect(result.record.approval?.revalidationResults.some((r) => r.outcome === "BLOCK")).toBe(
      true,
    );
    const paid = (await listHistoryEntries(db)).filter((entry) => entry.status === "PAYABLE");
    expect(paid).toHaveLength(1);
  });

  it("refuses a second resolution and stores nothing", async () => {
    const decisionId = await escalate("a");
    await resolveApproval(db, decisionId, REJECT, NOW);
    const entriesBefore = await countAuditEntries(db);

    expect(await resolveApproval(db, decisionId, APPROVE, NOW)).toEqual({
      ok: false,
      reason: "ALREADY_RESOLVED",
    });
    expect(await countAuditEntries(db)).toBe(entriesBefore);
    expect((await findDecisionRecord(db, decisionId))?.status).toBe("REJECTED");
  });

  it("refuses a decision that did not escalate", async () => {
    const extraction = buildExtraction();
    extraction.payee.value = "Old Vendor LLC";
    extractMock.mockResolvedValueOnce({ ok: true, extraction, cached: true, verification: null });
    const blocked = await processInvoice(
      db,
      { fileName: "dev/blocked.pdf", fileBuffer: Buffer.from("%PDF-1.4 b"), sourceFormat: "PDF" },
      NOW,
    );
    if (!blocked.ok) throw new Error(blocked.reason);
    expect(blocked.record.decision.outcome).toBe("BLOCK");

    expect(await resolveApproval(db, blocked.record.decision.id, APPROVE, NOW)).toEqual({
      ok: false,
      reason: "NOT_ESCALATED",
    });
  });

  it("reports an unknown decision", async () => {
    expect(await resolveApproval(db, "missing", APPROVE, NOW)).toEqual({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("lets only one of two simultaneous approvals through", async () => {
    const decisionId = await escalate("a");

    const results = await Promise.all([
      resolveApproval(db, decisionId, APPROVE, NOW),
      resolveApproval(db, decisionId, REJECT, NOW),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "ALREADY_RESOLVED" },
    ]);
  });
});
