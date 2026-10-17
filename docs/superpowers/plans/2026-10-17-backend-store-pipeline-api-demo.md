# Role E (store, pipeline, API and demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every invoice, decision, approval and rules version in Turso (libSQL). Orchestrate extraction (B) → engine (A) → hash-chained audit log. Expose the PROPUESTA API to D, and ship `npm run demo`, `demo:live` and `demo:tamper`, plus the metrics C's eval reuses.

**Architecture:**
- **Store:** each table keeps the validated contract object as JSON, with columns only where the database must enforce something. Repositories take an executor (client or open transaction) as their first parameter.
- **Pipeline:** functions take `db` and an explicit `now`. They run the LLM call outside the database lock, and everything else inside one queued write transaction.
- **Routes:** thin handlers that parse with contract schemas and map typed `{ ok: false, reason }` results to HTTP codes.

**Tech Stack:** Next.js 16 Route Handlers · TypeScript strict · Zod 4 · `@libsql/client` 0.18 (Turso; `:memory:` in tests) · Vitest · tsx · Node 24 · npm.

**Spec:** `docs/superpowers/specs/2026-10-17-backend-store-pipeline-api-demo-design.md`. Read it with this plan; the spec says *why*, this plan says *how*.

## Global Constraints

- **Language:** English for all code, identifiers, comments, commits, branches and PRs. Spanish only for UI text, `src/engine/messages.ts` and `README.md`.
- **Dependency rule (enforced by `npm run lint`):**
  - `src/store/` imports only `@/contracts/*` and `@libsql/client` (plus `node:` built-ins);
  - `src/pipeline/` imports anything except `app/`, `components/` and `lib/`;
  - `src/app/api/` imports `@/pipeline/*`, `@/store/*` (read) and `@/contracts/*`, never `@/engine/*` or `@/extraction/*`.
- **Imports:** across modules use the `@/` alias; relative imports only inside the same module.
- **Types:** they come only from `src/contracts/`. Local function parameter and result types are fine; never redefine an existing concept.
- **Glossary names only** (`CLAUDE.md`): `invoice`, `payee`, `amountMinor`, `history`, `HistoryEntry`, `auditEntry`, `approval`, `fileName`, `DecisionRecord`. Never `payments` or `ledger`, so PROPUESTA's `listPaymentHistory` is named `listHistoryEntries`.
- **Money and time:**
  - money is integer minor units; never `float` or `parseFloat`;
  - stored timestamps are ISO 8601 UTC (`...Z`);
  - `now` is always a parameter of pipeline functions; routes pass `new Date().toISOString()`, scripts pass `DATASET_NOW`.
- **Code hygiene:**
  - no `any`; external data (files, request bodies, DB rows) goes through `<Schema>.parse` / `safeParse`;
  - no `console.log` in `src/` (allowed in `scripts/`);
  - no new dependencies: everything below uses what `package.json` already has.
- **Fail-safe:** nothing in E's code may produce PAY. Decisions come only from `evaluateRules`, and approval outcomes only from `revalidateApproval` or from REJECT, which is BLOCK.
- **Tests:** `tests/<module>/<file>.test.ts`; the database is always `openDb(":memory:")`, or a temp file when two connections are needed. Tests never touch Turso.
- **Commits and branches:**
  - Conventional Commits with the exact titles from PROPUESTA §7 (copied into each task), branch `<type>/<scope>-<topic>`, one PR per task, squash merge with CI green;
  - commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`;
  - PRs that touch `src/contracts/` need A's approval, a second reviewer and the `rules-auditor` subagent.

### How every task ends (checks and shipping)

Every task's last steps are:
1. Run `npm run lint && npm run typecheck && npm test && npm run format:check`, and expect all green. If `format:check` fails, run `npx prettier --write <changed files>` and re-run.
2. Commit with the exact title the task gives.
3. **Ask the user before pushing** (pushing is outward-facing). Then run `git push -u origin <branch>` and `gh pr create --title "<commit title>" --body-file <file>`, with the body following `.github/pull_request_template.md` ("What and why" plus the ticked checklist) and ending with the Claude Code line.

Every task starts from an up-to-date `main` (`git switch main && git pull`). If the previous task's PR is not merged yet, branch from the previous task's branch instead, and rebase onto `main` after that PR merges.

## Review Focus

The five inputs the spec implies, but that no happy-path test exercises. Each is pinned by a test in the task that owns the code:

1. **Concurrent uploads.** The same file uploaded twice at the same time (double click, two tabs) yields exactly one decision; the second call gets `isResubmission: true`. Pinned in Task 4, `process-invoice.test.ts`, "decides a file uploaded twice at the same time only once".
2. **Concurrent approvals.** Two approvals of the same escalation at the same time yield one approval; the other answers `ALREADY_RESOLVED`, which is 409. Pinned in Task 6, `resolve-approval.test.ts`, "resolves a double click only once".
3. **Spreadsheet `expected.csv`.** A file saved by a spreadsheet, with a UTF-8 BOM, CRLF line ends, trailing blank lines and spaces around fields, parses the same as a clean file, and a duplicated file row is rejected. Pinned in Task 9, `compute-metrics.test.ts`.
4. **Byte-identical copies in a set.** Two identical files in one invoice set yield one decision; the copy returns the first file's record and appears in `missingFiles`, never as a second payment. Pinned in Task 4, `dataset.test.ts`, and Task 9, `compute-metrics.test.ts`.
5. **Damaged audit rows.** A tampered log row that is no longer valid JSON, or a deleted row, is reported as invalid at its position instead of crashing `/api/audit/verify`. Pinned in Task 7, `audit-log.test.ts`.

## Prerequisites from teammates (check before the task that needs them)

| Needed by | What | Check |
|---|---|---|
| Task 1 | A agrees that E opens the contracts PR | Ask A |
| Task 4 | B's `feat/extraction-module` merged into `main` | `test -f src/extraction/extract-invoice.ts` |
| Task 6 | A's `revalidateApproval({ invoice, decision, config, history, now }) → { resultingOutcome: "PAY" \| "BLOCK"; revalidationResults: RuleResult[] }` in `src/engine/revalidate-approval.ts` (a fail-safe placeholder is fine) | `grep -n "export function revalidateApproval" src/engine/revalidate-approval.ts` |
| Task 8 | C's `data/config/company.json` | `test -f data/config/company.json` |
| Task 9 | `expected.csv` format agreed with C: `file,expected_outcome,expected_rules` | Ask C |
| Task 10 | C's `npm run eval` script | `npm run | grep -w eval` |
| Task 11 | Turso database `triple-firma-demo` and access to the team's Vercel project | Ask the user |

If a check fails, stop and tell the user which teammate is blocking; do not write code in another owner's folder.

## File structure

```
src/contracts/decision-record.ts      DecisionRecordSchema, deriveHistoryStatus            (Task 1, A approves)
src/contracts/metrics.ts              ExpectedDecisionSchema, MetricsSchema                (Task 1)
src/contracts/api-error.ts            ApiErrorCodeSchema, ApiErrorSchema                   (Task 1)
src/contracts/audit-entry.ts          + AuditVerificationSchema                            (Task 1)
src/contracts/rules-config.ts         + RulesConfigVersionSchema                           (Task 1)
src/store/schema.ts                   SCHEMA, DROP_SCHEMA                                  (Task 2; audit table in Task 3)
src/store/db.ts                       Executor, openDb, getDb, resetDb, withWriteTransaction (Task 2)
src/store/config-repository.ts        findCurrentRulesConfig, insertRulesConfig            (Task 2)
src/store/invoice-repository.ts       insertInvoice, findInvoiceFile                       (Task 2)
src/store/decision-repository.ts      insertDecision, findDecisionByFileHash, findDecisionRecord,
                                      listDecisionRecords, listHistoryEntries              (Task 2)
src/store/approval-repository.ts      insertApproval                                       (Task 2)
src/store/audit-log.ts                appendAuditEntry, hashAuditEntry, canonicalJson      (Task 3)
                                      + verifyAuditChain                                   (Task 7)
src/pipeline/save-rules-config.ts     saveRulesConfig                                      (Task 4)
src/pipeline/process-invoice.ts       processInvoice, detectSourceFormat                   (Task 4)
src/pipeline/dataset.ts               DATASET_NOW, INVOICE_SETS, readCompanyConfig,
                                      processInvoiceSet                                    (Task 4)
                                      + readExpectedDecisions                              (Task 9)
src/pipeline/resolve-approval.ts      resolveApproval                                      (Task 6)
src/pipeline/compute-metrics.ts       parseExpectedCsv, computeMetrics                     (Task 9)
src/app/api/responses.ts              jsonError                                            (Task 5)
src/app/api/invoices/route.ts                 POST                                         (Task 5)
src/app/api/invoices/[id]/file/route.ts       GET                                          (Task 5)
src/app/api/decisions/route.ts                GET                                          (Task 5)
src/app/api/decisions/[id]/route.ts           GET                                          (Task 5)
src/app/api/config/route.ts                   GET, PUT                                     (Task 5)
src/app/api/approvals/[decisionId]/route.ts   POST                                         (Task 6)
src/app/api/audit/verify/route.ts             GET                                          (Task 7)
src/app/api/metrics/route.ts                  GET                                          (Task 9)
scripts/demo.ts, scripts/demo-tamper.ts                                                    (Task 8)
tests/contracts/fixtures.ts           + buildDecision, buildApproval                       (Task 1)
tests/store/fixtures.ts               openMemoryDb, openTempFileDb, buildStoredInvoice,
                                      storeDecision, countAuditEntries                     (Task 2, Task 3)
```

Existing helpers to reuse:
- **Contract fixtures** (`tests/contracts/fixtures.ts`): `buildRulesConfig`, `buildExtraction`, `buildRuleResults`, `VALID_HASH`.
- **Engine fixtures** (`tests/engine/fixtures.ts`): `buildInvoice` and `NOW` (`"2026-10-17T14:00:00Z"`).
- **Engine:** `evaluateRules` (`src/engine/evaluate-rules.ts`), `toPeriod` (`src/engine/rule-context.ts`).
- **Extraction (B):** `extractInvoice` and `makeUncertainExtraction` (`src/extraction/extract-invoice.ts`).

---

### Task 1: API response contracts (prerequisite, `src/contracts/`; A approves)

Not in E's commit list. `contracts/` is A's folder: confirm with A that E opens this PR, then get A's approval, a second reviewer and the `rules-auditor` pass.

**Files:**
- Create: `src/contracts/decision-record.ts`, `src/contracts/metrics.ts`, `src/contracts/api-error.ts`
- Modify: `src/contracts/audit-entry.ts` (append), `src/contracts/rules-config.ts` (append, plus one import), `tests/contracts/fixtures.ts` (append builders), `CLAUDE.md` (glossary rows)
- Test: `tests/contracts/decision-record.test.ts`, `tests/contracts/metrics.test.ts`, `tests/contracts/api-error.test.ts`, `tests/contracts/audit-verification.test.ts`, `tests/contracts/rules-config-version.test.ts`

**Interfaces:**
- Consumes: `ApprovalSchema`/`Approval` (`approval.ts`), `DecisionSchema`/`DecisionOutcome`/`DecisionOutcomeSchema`/`RuleIdSchema` (`decision.ts`), `HistoryEntryStatusSchema`/`HistoryEntryStatus` (`history.ts`), `InvoiceSchema` (`invoice.ts`), `IsoDateTimeSchema` (`dates.ts`), `RulesConfigSchema`.
- Produces:
  - `deriveHistoryStatus(outcome: DecisionOutcome, approval: Pick<Approval, "action" | "resultingOutcome"> | null): HistoryEntryStatus`
  - `DecisionRecordSchema`, `type DecisionRecord = { fileName: string; status: HistoryEntryStatus; invoice: Invoice; decision: Decision; approval: Approval | null; extractionFailure: string | null }`
  - `ExpectedDecisionSchema`, `type ExpectedDecision = { fileName: string; expectedOutcome: DecisionOutcome; expectedRuleIds: RuleId[] }`
  - `MetricsSchema`, `type Metrics = { total; leaks; leakFiles: string[]; missingFiles: string[]; accuracy; autonomy; overEscalation; explainability; ruleMatchRate }` (rates `number | null`)
  - `ApiErrorCodeSchema`, `type ApiErrorCode`, `ApiErrorSchema`, `type ApiError = { error: ApiErrorCode; issues?: { path: string; message: string }[] }`
  - `AuditVerificationSchema`, `type AuditVerification = { isValid: boolean; entryCount: number; firstInvalidSeq: number | null; lastHash: string | null }`
  - `RulesConfigVersionSchema`, `type RulesConfigVersion = { version: number; config: RulesConfig; createdAt: string }`
  - Test builders: `buildDecision(invoiceId: string, outcome?: DecisionOutcome, overrides?: Partial<Decision>): Decision`, `type ApprovalKind = "APPROVED" | "APPROVED_BUT_BLOCKED" | "REJECTED"`, `buildApproval(decision: Decision, kind: ApprovalKind, resolvedAt?: string): Approval`

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/contracts-api-responses
```

- [ ] **Step 2: Add the test builders to `tests/contracts/fixtures.ts`**

Replace the first import line, `import { RULE_IDS, type RuleResult } from "@/contracts/decision";`, with:

```ts
import type { Approval } from "@/contracts/approval";
import {
  type Decision,
  type DecisionOutcome,
  RULE_IDS,
  type RuleId,
  type RuleOutcome,
  type RuleResult,
} from "@/contracts/decision";
```

Append at the end of the file:

```ts
const OUTCOME_RULES: Record<DecisionOutcome, Partial<Record<RuleId, RuleOutcome>>> = {
  PAY: {},
  ESCALATE: { R5: "ESCALATE" },
  BLOCK: { R2: "BLOCK" },
};

// A decision that satisfies DecisionSchema for the given outcome (USD 2,500.00), for tests that store
// or compare decisions without running the engine.
export function buildDecision(
  invoiceId: string,
  outcome: DecisionOutcome = "PAY",
  overrides: Partial<Decision> = {},
): Decision {
  const ruleResults = buildRuleResults(OUTCOME_RULES[outcome]);
  const failed = ruleResults.filter((result) => result.outcome !== "PASS");
  return {
    id: `decision-${invoiceId}`,
    invoiceId,
    outcome,
    ruleResults,
    amountMinor: 250_000,
    currency: "USD",
    baseAmountMinor: 250_000,
    exchangeRate: "1",
    explanation:
      failed.length === 0
        ? "Pagada: todas las reglas pasaron."
        : failed.map((result) => result.message).join(" "),
    configVersion: 1,
    decidedAt: "2026-10-17T14:00:00Z",
    ...overrides,
  };
}

export type ApprovalKind = "APPROVED" | "APPROVED_BUT_BLOCKED" | "REJECTED";

// A resolution of the given decision that satisfies ApprovalSchema, carrying the decision's money.
export function buildApproval(
  decision: Decision,
  kind: ApprovalKind,
  resolvedAt = "2026-10-17T15:00:00Z",
): Approval {
  const resolution = {
    decisionId: decision.id,
    approver: "Ana Pérez",
    comment: "Revisado con el acuerdo.",
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    resolvedAt,
  };
  if (kind === "REJECTED") {
    return { ...resolution, action: "REJECT", resultingOutcome: "BLOCK", revalidationResults: [] };
  }
  const budgetOutcome = kind === "APPROVED" ? "PASS" : "BLOCK";
  return {
    ...resolution,
    action: "APPROVE",
    resultingOutcome: kind === "APPROVED" ? "PAY" : "BLOCK",
    revalidationResults: [
      { ruleId: "R2", outcome: "PASS", message: "R2 result", compared: {} },
      { ruleId: "R6", outcome: budgetOutcome, message: "R6 result", compared: {} },
    ],
  };
}
```

- [ ] **Step 3: Write the failing tests**

`tests/contracts/decision-record.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type DecisionRecord,
  DecisionRecordSchema,
  deriveHistoryStatus,
} from "@/contracts/decision-record";
import { buildApproval, buildDecision } from "./fixtures";
import { buildInvoice } from "../engine/fixtures";

function buildRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const invoice = buildInvoice();
  return {
    fileName: "dev/01-invoice.pdf",
    status: "PENDING_APPROVAL",
    invoice,
    decision: buildDecision(invoice.id, "ESCALATE"),
    approval: null,
    extractionFailure: null,
    ...overrides,
  };
}

describe("deriveHistoryStatus", () => {
  it.each([
    ["PAY", null, "PAYABLE"],
    ["BLOCK", null, "BLOCKED"],
    ["ESCALATE", null, "PENDING_APPROVAL"],
    ["ESCALATE", { action: "REJECT", resultingOutcome: "BLOCK" }, "REJECTED"],
    ["ESCALATE", { action: "APPROVE", resultingOutcome: "PAY" }, "PAYABLE"],
    ["ESCALATE", { action: "APPROVE", resultingOutcome: "BLOCK" }, "BLOCKED"],
  ] as const)("%s with approval %o is %s", (outcome, approval, status) => {
    expect(deriveHistoryStatus(outcome, approval)).toBe(status);
  });
});

describe("DecisionRecordSchema", () => {
  it("accepts a pending escalation", () => {
    expect(DecisionRecordSchema.safeParse(buildRecord()).success).toBe(true);
  });

  it("accepts an approved escalation as PAYABLE", () => {
    const record = buildRecord();
    const approval = buildApproval(record.decision, "APPROVED");
    const parsed = DecisionRecordSchema.safeParse({ ...record, approval, status: "PAYABLE" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a status that does not follow from the decision and its approval", () => {
    expect(DecisionRecordSchema.safeParse(buildRecord({ status: "PAYABLE" })).success).toBe(false);
  });

  it("rejects an approval on a decision that was not escalated", () => {
    const invoice = buildInvoice();
    const decision = buildDecision(invoice.id, "PAY");
    const record = buildRecord({ decision, status: "PAYABLE" });
    const approval = buildApproval(decision, "APPROVED");
    expect(DecisionRecordSchema.safeParse({ ...record, approval }).success).toBe(false);
  });

  it("rejects a decision of another invoice", () => {
    const record = buildRecord({ decision: buildDecision("inv-other", "ESCALATE") });
    expect(DecisionRecordSchema.safeParse(record).success).toBe(false);
  });

  it("rejects an approval of another decision", () => {
    const record = buildRecord();
    const approval = buildApproval(buildDecision("inv-other", "ESCALATE"), "REJECTED");
    const parsed = DecisionRecordSchema.safeParse({ ...record, approval, status: "REJECTED" });
    expect(parsed.success).toBe(false);
  });
});
```

`tests/contracts/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExpectedDecisionSchema, type Metrics, MetricsSchema } from "@/contracts/metrics";

const METRICS: Metrics = {
  total: 2,
  leaks: 1,
  leakFiles: ["dev/03-duplicate.pdf"],
  missingFiles: [],
  accuracy: 0.5,
  autonomy: null,
  overEscalation: null,
  explainability: 1,
  ruleMatchRate: 0.5,
};

describe("MetricsSchema", () => {
  it("accepts rates in [0, 1] and null when nothing was measured", () => {
    expect(MetricsSchema.safeParse(METRICS).success).toBe(true);
  });

  it("rejects a rate above 1", () => {
    expect(MetricsSchema.safeParse({ ...METRICS, accuracy: 1.5 }).success).toBe(false);
  });

  it("rejects a leak count that does not match the leaking files", () => {
    expect(MetricsSchema.safeParse({ ...METRICS, leaks: 0 }).success).toBe(false);
  });
});

describe("ExpectedDecisionSchema", () => {
  it("accepts an outcome and rule ids from the contracts", () => {
    const row = { fileName: "dev/01.pdf", expectedOutcome: "BLOCK", expectedRuleIds: ["R2"] };
    expect(ExpectedDecisionSchema.safeParse(row).success).toBe(true);
  });

  it("rejects an outcome outside PAY, BLOCK and ESCALATE", () => {
    const row = { fileName: "dev/01.pdf", expectedOutcome: "PAID", expectedRuleIds: [] };
    expect(ExpectedDecisionSchema.safeParse(row).success).toBe(false);
  });
});
```

`tests/contracts/api-error.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApiErrorSchema } from "@/contracts/api-error";

describe("ApiErrorSchema", () => {
  it("accepts a known code with the invalid fields", () => {
    const body = { error: "INVALID_REQUEST", issues: [{ path: "timezone", message: "Required" }] };
    expect(ApiErrorSchema.safeParse(body).success).toBe(true);
  });

  it("rejects free text instead of a code", () => {
    expect(ApiErrorSchema.safeParse({ error: "Algo salió mal" }).success).toBe(false);
  });
});
```

`tests/contracts/audit-verification.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AuditVerificationSchema } from "@/contracts/audit-entry";
import { VALID_HASH } from "./fixtures";

describe("AuditVerificationSchema", () => {
  it("accepts an empty log", () => {
    const empty = { isValid: true, entryCount: 0, firstInvalidSeq: null, lastHash: null };
    expect(AuditVerificationSchema.safeParse(empty).success).toBe(true);
  });

  it("accepts a broken chain that names its first invalid entry", () => {
    const broken = { isValid: false, entryCount: 3, firstInvalidSeq: 2, lastHash: VALID_HASH };
    expect(AuditVerificationSchema.safeParse(broken).success).toBe(true);
  });

  it("rejects a valid chain that names an invalid entry", () => {
    const wrong = { isValid: true, entryCount: 3, firstInvalidSeq: 2, lastHash: VALID_HASH };
    expect(AuditVerificationSchema.safeParse(wrong).success).toBe(false);
  });

  it("rejects entries without a last hash", () => {
    const wrong = { isValid: true, entryCount: 1, firstInvalidSeq: null, lastHash: null };
    expect(AuditVerificationSchema.safeParse(wrong).success).toBe(false);
  });
});
```

`tests/contracts/rules-config-version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RulesConfigVersionSchema } from "@/contracts/rules-config";
import { buildRulesConfig } from "./fixtures";

const VERSION = { version: 1, config: buildRulesConfig(), createdAt: "2026-10-17T14:00:00Z" };

describe("RulesConfigVersionSchema", () => {
  it("accepts a stored version of a valid config", () => {
    expect(RulesConfigVersionSchema.safeParse(VERSION).success).toBe(true);
  });

  it("rejects version 0", () => {
    expect(RulesConfigVersionSchema.safeParse({ ...VERSION, version: 0 }).success).toBe(false);
  });

  it("rejects a version whose config is invalid", () => {
    const config = buildRulesConfig({ approvalThresholdMinor: 0 });
    expect(RulesConfigVersionSchema.safeParse({ ...VERSION, config }).success).toBe(false);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/contracts`
Expected: FAIL. The new files fail with `Failed to resolve import "@/contracts/decision-record"` (and the same for `metrics` and `api-error`), and with `AuditVerificationSchema` / `RulesConfigVersionSchema` undefined. The existing contract tests still pass.

- [ ] **Step 5: Implement the contracts**

`src/contracts/decision-record.ts`:

```ts
import { z } from "zod";
import { type Approval, ApprovalSchema } from "./approval";
import { type DecisionOutcome, DecisionSchema } from "./decision";
import { type HistoryEntryStatus, HistoryEntryStatusSchema } from "./history";
import { InvoiceSchema } from "./invoice";

// The status of a decision once its approval (if any) is applied. It is the status the engine sees in
// history, so the API and the rules never disagree on what is pending, payable or rejected.
export function deriveHistoryStatus(
  outcome: DecisionOutcome,
  approval: Pick<Approval, "action" | "resultingOutcome"> | null,
): HistoryEntryStatus {
  if (outcome === "PAY") return "PAYABLE";
  if (outcome === "BLOCK") return "BLOCKED";
  if (approval === null) return "PENDING_APPROVAL";
  if (approval.action === "REJECT") return "REJECTED";
  return approval.resultingOutcome === "PAY" ? "PAYABLE" : "BLOCKED";
}

// One invoice as the API returns it: its decision, the human resolution if any, and the resulting
// status. fileName is the name the file arrived with; for the dataset it is "<set>/<name>", the key of
// data/expected.csv.
export const DecisionRecordSchema = z
  .object({
    fileName: z.string().min(1),
    status: HistoryEntryStatusSchema,
    invoice: InvoiceSchema,
    decision: DecisionSchema,
    approval: ApprovalSchema.nullable(),
    extractionFailure: z.string().nullable(),
  })
  .superRefine((record, ctx) => {
    if (record.decision.invoiceId !== record.invoice.id) {
      ctx.addIssue({
        code: "custom",
        message: "The decision must belong to the invoice",
        path: ["decision", "invoiceId"],
      });
    }
    if (record.approval !== null && record.decision.outcome !== "ESCALATE") {
      ctx.addIssue({
        code: "custom",
        message: "Only an escalated decision can have an approval",
        path: ["approval"],
      });
    }
    if (record.approval !== null && record.approval.decisionId !== record.decision.id) {
      ctx.addIssue({
        code: "custom",
        message: "The approval must belong to the decision",
        path: ["approval", "decisionId"],
      });
    }
    const expected = deriveHistoryStatus(record.decision.outcome, record.approval);
    if (record.status !== expected) {
      ctx.addIssue({ code: "custom", message: `Status must be ${expected}`, path: ["status"] });
    }
  });
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
```

`src/contracts/metrics.ts`:

```ts
import { z } from "zod";
import { DecisionOutcomeSchema, RuleIdSchema } from "./decision";

// One row of data/expected.csv, written by hand by C without looking at the engine's output.
export const ExpectedDecisionSchema = z.object({
  fileName: z.string().min(1),
  expectedOutcome: DecisionOutcomeSchema,
  expectedRuleIds: z.array(RuleIdSchema),
});
export type ExpectedDecision = z.infer<typeof ExpectedDecisionSchema>;

const CountSchema = z.int().nonnegative();

// null when nothing was measured (the denominator is 0), never a misleading 0 or 1.
const RateSchema = z.number().min(0).max(1).nullable();

// The automatic decisions measured against expected.csv (PROPUESTA section 5). A leak is a PAY where
// BLOCK or ESCALATE was expected: a single one disqualifies.
export const MetricsSchema = z
  .object({
    total: CountSchema,
    leaks: CountSchema,
    leakFiles: z.array(z.string()),
    missingFiles: z.array(z.string()),
    accuracy: RateSchema,
    autonomy: RateSchema,
    overEscalation: RateSchema,
    explainability: RateSchema,
    ruleMatchRate: RateSchema,
  })
  .refine((metrics) => metrics.leaks === metrics.leakFiles.length, {
    message: "leaks must equal the number of leakFiles",
    path: ["leaks"],
  });
export type Metrics = z.infer<typeof MetricsSchema>;
```

`src/contracts/api-error.ts`:

```ts
import { z } from "zod";

// Stable codes the UI translates into Spanish: the API never sends user-facing text.
export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "MISSING_FILE",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "EMPTY_SOURCE_TEXT",
  "SOURCE_TEXT_TOO_LONG",
  "NO_RULES_CONFIG",
  "NOT_FOUND",
  "NOT_ESCALATED",
  "ALREADY_RESOLVED",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

// Body of every 4xx response. issues lists the invalid fields of a rejected body, such as a rules config.
export const ApiErrorSchema = z.object({
  error: ApiErrorCodeSchema,
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
```

Append to `src/contracts/audit-entry.ts`:

```ts
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
```

In `src/contracts/rules-config.ts`, change `import { IsoDateSchema, TimezoneSchema } from "./dates";` to `import { IsoDateSchema, IsoDateTimeSchema, TimezoneSchema } from "./dates";`, then append at the end of the file:

```ts
// A stored configuration. Every change creates a new version; the engine always reads the latest.
export const RulesConfigVersionSchema = z.object({
  version: z.int().positive(),
  config: RulesConfigSchema,
  createdAt: IsoDateTimeSchema,
});
export type RulesConfigVersion = z.infer<typeof RulesConfigVersionSchema>;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/contracts`
Expected: PASS, all contract tests including the 5 new files.

- [ ] **Step 7: Add the glossary rows to `CLAUDE.md`**

Append these rows at the end of the Glossary table, after the `sourceText` row, then run `npx prettier --write CLAUDE.md` to realign the table:

```markdown
| File name as received (`<set>/<name>` for the dataset, the key of `data/expected.csv`) | `fileName` | `filename`, `path`, `name` | Archivo |
| A decision with its invoice, approval and resulting status, as the API returns it | `DecisionRecord`; `status` from `deriveHistoryStatus` | `DecisionView`, `DecisionDto`, `result` | Decisión |
| One expected outcome from `data/expected.csv`, and the metrics measured against them | `ExpectedDecision`, `Metrics` | `stats`, `score`, `groundTruth` | Métricas |
| Result of checking the audit hash chain | `AuditVerification` | `integrityCheck`, `auditResult` | Verificar integridad |
| Error code of an API response (the UI translates it) | `ApiError` with `error`: `ApiErrorCode` | `errorMessage`, `errCode` | — |
| A stored rules configuration | `RulesConfigVersion` (`version`, `config`, `createdAt`) | `configRevision`, `settingsVersion` | Versión de reglas |
```

- [ ] **Step 8: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`
Expected: all green.

```bash
git add src/contracts tests/contracts CLAUDE.md
git commit -F - <<'EOF'
feat(contracts): add api response schemas

D's mocks and E's endpoints need one shape per response so mock and real data
cannot drift: decision records with their status, metrics, audit verification,
rules versions and error codes. Additive only; no existing schema changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 9: Review and ship.** Run the `rules-auditor` subagent on this diff and fix anything it finds. Then follow "How every task ends" step 3, with A and a second person as reviewers.

---

### Task 2: libSQL schema and repositories (commit 3: `feat(store): add libsql schema and repositories`)

**Files:**
- Create: `src/store/schema.ts`, `src/store/db.ts`, `src/store/config-repository.ts`, `src/store/invoice-repository.ts`, `src/store/decision-repository.ts`, `src/store/approval-repository.ts`, `tests/store/fixtures.ts`
- Modify: `.env.example`, `CLAUDE.md` ("Getting started" and "Stack"), `README.md` (step 2 of "Puesta en marcha")
- Test: `tests/store/db.test.ts`, `tests/store/config-repository.test.ts`, `tests/store/invoice-repository.test.ts`, `tests/store/decision-repository.test.ts`

**Interfaces:**
- Consumes: everything from Task 1; `HistoryEntrySchema` (`history.ts`), `InvoiceSchema`/`SourceFormatSchema` (`invoice.ts`), `PeriodSchema`/`IsoDateTimeSchema` (`dates.ts`), `buildInvoice` (`tests/engine/fixtures.ts`).
- Produces:
  - `type Executor = Pick<Transaction, "execute">`
  - `openDb(url?: string): Promise<Client>`, `getDb(): Promise<Client>`, `resetDb(db: Client): Promise<void>`, `withWriteTransaction<T>(db: Client, fn: (tx: Transaction) => Promise<T>): Promise<T>`
  - `SCHEMA: string`, `DROP_SCHEMA: string`
  - `findCurrentRulesConfig(db: Executor): Promise<RulesConfigVersion | null>`, `insertRulesConfig(db: Executor, config: RulesConfig, createdAt: string): Promise<RulesConfigVersion>`
  - `insertInvoice(db: Executor, stored: { invoice: Invoice; fileName: string; fileBytes: Uint8Array; extractionFailure: string | null }): Promise<void>`, `type StoredInvoiceFile = { fileName: string; sourceFormat: SourceFormat; fileBytes: Uint8Array<ArrayBuffer> }`, `findInvoiceFile(db: Executor, invoiceId: string): Promise<StoredInvoiceFile | null>`
  - `insertDecision(db: Executor, decision: Decision, period: Period): Promise<void>`, `findDecisionByFileHash(db: Executor, fileHash: string): Promise<DecisionRecord | null>`, `findDecisionRecord(db: Executor, decisionId: string): Promise<DecisionRecord | null>`, `listDecisionRecords(db: Executor, status?: HistoryEntryStatus): Promise<DecisionRecord[]>` (newest first), `listHistoryEntries(db: Executor): Promise<HistoryEntry[]>` (oldest first)
  - `insertApproval(db: Executor, approval: Approval, period: Period): Promise<void>`
  - Test fixtures: `openMemoryDb()`, `openTempFileDb()`, `buildStoredInvoice(id, overrides?)`, `storeDecision(db, invoice, decision, period?)`

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/store-schema-repositories
```

- [ ] **Step 2: Write the shared store test fixtures**

`tests/store/fixtures.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { Decision } from "@/contracts/decision";
import type { Invoice } from "@/contracts/invoice";
import { openDb, withWriteTransaction } from "@/store/db";
import { insertDecision } from "@/store/decision-repository";
import { insertInvoice } from "@/store/invoice-repository";
import { buildInvoice } from "../engine/fixtures";

export function openMemoryDb(): Promise<Client> {
  return openDb(":memory:");
}

// A real file, for tests that need two connections at once (concurrent requests).
export function openTempFileDb(): Promise<Client> {
  const directory = mkdtempSync(path.join(tmpdir(), "triple-firma-"));
  return openDb(`file:${path.join(directory, "test.db")}`);
}

// An invoice with its own id and file hash, so several can be stored side by side.
export function buildStoredInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
  const fileHash = createHash("sha256").update(id).digest("hex");
  return buildInvoice({ id, fileHash, ...overrides });
}

// Stores an invoice and its decision directly, without the engine, so tests control every outcome.
export async function storeDecision(
  db: Client,
  invoice: Invoice,
  decision: Decision,
  period = "2026-10",
): Promise<void> {
  await withWriteTransaction(db, async (tx) => {
    await insertInvoice(tx, {
      invoice,
      fileName: `dev/${invoice.id}.pdf`,
      fileBytes: new Uint8Array([37, 80, 68, 70]),
      extractionFailure: null,
    });
    await insertDecision(tx, decision, period);
  });
}
```

- [ ] **Step 3: Write the failing tests**

`tests/store/db.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { findCurrentRulesConfig, insertRulesConfig } from "@/store/config-repository";
import { openDb, resetDb, withWriteTransaction } from "@/store/db";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb, openTempFileDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openDb", () => {
  it("refuses to start without a database URL instead of falling back to a local file", async () => {
    vi.stubEnv("TURSO_DATABASE_URL", "");
    await expect(openDb()).rejects.toThrow("TURSO_DATABASE_URL is not set");
  });
});

describe("withWriteTransaction", () => {
  it("commits what the function wrote", async () => {
    await withWriteTransaction(db, (tx) => insertRulesConfig(tx, buildRulesConfig(), NOW));
    expect((await findCurrentRulesConfig(db))?.version).toBe(1);
  });

  it("rolls back everything when the function throws", async () => {
    const failing = withWriteTransaction(db, async (tx) => {
      await insertRulesConfig(tx, buildRulesConfig(), NOW);
      throw new Error("boom");
    });
    await expect(failing).rejects.toThrow("boom");
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });

  it("runs concurrent write transactions one after another on a local file", async () => {
    const fileDb = await openTempFileDb();
    const saved = await Promise.all(
      [1, 2, 3].map(() =>
        withWriteTransaction(fileDb, (tx) => insertRulesConfig(tx, buildRulesConfig(), NOW)),
      ),
    );
    expect(saved.map((version) => version.version).sort()).toEqual([1, 2, 3]);
  });
});

describe("resetDb", () => {
  it("erases every table and leaves the schema ready", async () => {
    await insertRulesConfig(db, buildRulesConfig(), NOW);
    await resetDb(db);
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });
});
```

`tests/store/config-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { findCurrentRulesConfig, insertRulesConfig } from "@/store/config-repository";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("rules config versions", () => {
  it("has no config before the first save", async () => {
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });

  it("numbers every save and returns the latest one", async () => {
    const first = await insertRulesConfig(db, buildRulesConfig(), NOW);
    const second = await insertRulesConfig(
      db,
      buildRulesConfig({ approvalThresholdMinor: 150_000 }),
      "2026-10-17T15:00:00Z",
    );
    expect([first.version, second.version]).toEqual([1, 2]);
    expect(await findCurrentRulesConfig(db)).toEqual(second);
  });

  it("never stores an invalid config", async () => {
    const invalid = buildRulesConfig({ approvalThresholdMinor: 0 });
    await expect(insertRulesConfig(db, invalid, NOW)).rejects.toThrow();
    expect(await findCurrentRulesConfig(db)).toBeNull();
  });
});
```

`tests/store/invoice-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { findInvoiceFile, insertInvoice } from "@/store/invoice-repository";
import { buildStoredInvoice, openMemoryDb } from "./fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("invoice files", () => {
  it("returns the original bytes, name and format of a stored invoice", async () => {
    const invoice = buildStoredInvoice("inv-1");
    const fileBytes = Buffer.from("%PDF-1.4 factura");
    await insertInvoice(db, { invoice, fileName: "dev/01.pdf", fileBytes, extractionFailure: null });
    const file = await findInvoiceFile(db, "inv-1");
    expect(file?.fileName).toBe("dev/01.pdf");
    expect(file?.sourceFormat).toBe("PDF");
    expect(Buffer.from(file?.fileBytes ?? []).toString()).toBe("%PDF-1.4 factura");
  });

  it("returns null for an unknown invoice", async () => {
    expect(await findInvoiceFile(db, "inv-missing")).toBeNull();
  });

  it("rejects a second invoice with the same file hash", async () => {
    const stored = {
      fileName: "dev/01.pdf",
      fileBytes: new Uint8Array([1]),
      extractionFailure: null,
    };
    await insertInvoice(db, { ...stored, invoice: buildStoredInvoice("inv-1") });
    const copy = buildStoredInvoice("inv-2", { fileHash: buildStoredInvoice("inv-1").fileHash });
    await expect(insertInvoice(db, { ...stored, invoice: copy })).rejects.toThrow();
  });
});
```

`tests/store/decision-repository.test.ts`:

```ts
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
    await insertApproval(db, buildApproval(decision, "REJECTED", "2026-11-02T15:00:00Z"), "2026-11");

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
    expect(unreadable).toMatchObject({ payee: null, reference: null, amountMinor: 250_000 });
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/store`
Expected: FAIL with `Failed to resolve import "@/store/db"` (the other store modules too).

- [ ] **Step 5: Implement the schema and the client**

`src/store/schema.ts`:

```ts
// Each table keeps the validated contract object as JSON. Columns exist only where the database must
// enforce something: one invoice per file hash, one decision per invoice, one approval per decision.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS config_versions (
  version INTEGER PRIMARY KEY,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_bytes BLOB NOT NULL,
  invoice_json TEXT NOT NULL,
  extraction_failure TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  period TEXT NOT NULL,
  decision_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  decision_id TEXT PRIMARY KEY REFERENCES decisions(id),
  period TEXT NOT NULL,
  approval_json TEXT NOT NULL
);
`;

// Children first, so it also works with foreign keys enforced. Triggers are dropped with their table.
export const DROP_SCHEMA = `
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS config_versions;
`;
```

`src/store/db.ts`:

```ts
import { type Client, createClient, type Transaction } from "@libsql/client";
import { DROP_SCHEMA, SCHEMA } from "./schema";

// Repositories take a client or an open transaction, so the same query runs inside or outside one.
export type Executor = Pick<Transaction, "execute">;

// Turso in development, demo and deploy; ":memory:" in tests and eval; "file:local.db" is the offline
// Plan B. timeout is the busy timeout of local files, so another process's write waits instead of
// failing at once; Turso ignores it.
export async function openDb(url = process.env.TURSO_DATABASE_URL): Promise<Client> {
  if (!url) throw new Error("TURSO_DATABASE_URL is not set: see README");
  const db = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    timeout: 5_000,
  });
  await db.executeMultiple(SCHEMA);
  return db;
}

const globalForDb = globalThis as typeof globalThis & { tripleFirmaDb?: Promise<Client> };

// One client per server process, kept on globalThis so dev hot reload does not open one per reload.
// A failed open is forgotten, so the next request retries instead of failing until a restart.
export function getDb(): Promise<Client> {
  globalForDb.tripleFirmaDb ??= openDb().catch((error: unknown) => {
    globalForDb.tripleFirmaDb = undefined;
    throw error;
  });
  return globalForDb.tripleFirmaDb;
}

// Erases everything in the database the client points at. Only for the demo script and tests.
export async function resetDb(db: Client): Promise<void> {
  await db.executeMultiple(DROP_SCHEMA);
  await db.executeMultiple(SCHEMA);
}

let writeQueue: Promise<unknown> = Promise.resolve();

// Runs fn in one write transaction (BEGIN IMMEDIATE): commits when it returns, rolls back when it throws.
// ponytail: one queue per process, because a local file blocks the event loop while it waits for a lock
// that this same process holds, and fails with SQLITE_BUSY. Turso queues writers across processes on
// its own. Use one queue per database if the app ever opens two.
export function withWriteTransaction<T>(
  db: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const run = writeQueue.then(async () => {
    const tx = await db.transaction("write");
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } finally {
      tx.close();
    }
  });
  writeQueue = run.catch(() => undefined);
  return run;
}
```

- [ ] **Step 6: Implement the repositories**

`src/store/config-repository.ts`:

```ts
import { IsoDateTimeSchema } from "@/contracts/dates";
import {
  type RulesConfig,
  RulesConfigSchema,
  type RulesConfigVersion,
  RulesConfigVersionSchema,
} from "@/contracts/rules-config";
import type { Executor } from "./db";

export async function findCurrentRulesConfig(db: Executor): Promise<RulesConfigVersion | null> {
  const { rows } = await db.execute(
    "SELECT version, config_json, created_at FROM config_versions ORDER BY version DESC LIMIT 1",
  );
  const row = rows[0];
  if (row === undefined) return null;
  return RulesConfigVersionSchema.parse({
    version: row.version,
    config: JSON.parse(String(row.config_json)),
    createdAt: row.created_at,
  });
}

// SQLite assigns the next version (INTEGER PRIMARY KEY). Run it inside the caller's write transaction.
export async function insertRulesConfig(
  db: Executor,
  config: RulesConfig,
  createdAt: string,
): Promise<RulesConfigVersion> {
  const validConfig = RulesConfigSchema.parse(config);
  const validCreatedAt = IsoDateTimeSchema.parse(createdAt);
  const { rows } = await db.execute({
    sql: "INSERT INTO config_versions (config_json, created_at) VALUES (?, ?) RETURNING version",
    args: [JSON.stringify(validConfig), validCreatedAt],
  });
  return RulesConfigVersionSchema.parse({
    version: rows[0]?.version,
    config: validConfig,
    createdAt: validCreatedAt,
  });
}
```

`src/store/invoice-repository.ts`:

```ts
import {
  type Invoice,
  InvoiceSchema,
  type SourceFormat,
  SourceFormatSchema,
} from "@/contracts/invoice";
import type { Executor } from "./db";

export type StoredInvoiceFile = {
  fileName: string;
  sourceFormat: SourceFormat;
  fileBytes: Uint8Array<ArrayBuffer>;
};

export async function insertInvoice(
  db: Executor,
  stored: {
    invoice: Invoice;
    fileName: string;
    fileBytes: Uint8Array;
    extractionFailure: string | null;
  },
): Promise<void> {
  const invoice = InvoiceSchema.parse(stored.invoice);
  await db.execute({
    sql: `INSERT INTO invoices (id, file_hash, file_name, file_bytes, invoice_json, extraction_failure)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      invoice.id,
      invoice.fileHash,
      stored.fileName,
      stored.fileBytes,
      JSON.stringify(invoice),
      stored.extractionFailure,
    ],
  });
}

// The original file, for the document viewer.
export async function findInvoiceFile(
  db: Executor,
  invoiceId: string,
): Promise<StoredInvoiceFile | null> {
  const { rows } = await db.execute({
    sql: `SELECT file_name, file_bytes, json_extract(invoice_json, '$.sourceFormat') AS source_format
          FROM invoices WHERE id = ?`,
    args: [invoiceId],
  });
  const row = rows[0];
  if (row === undefined) return null;
  if (!(row.file_bytes instanceof ArrayBuffer)) {
    throw new Error(`Invoice ${invoiceId} has no stored file`);
  }
  return {
    fileName: String(row.file_name),
    sourceFormat: SourceFormatSchema.parse(row.source_format),
    fileBytes: new Uint8Array(row.file_bytes),
  };
}
```

`src/store/decision-repository.ts`:

```ts
import type { InArgs, Row } from "@libsql/client";
import { ApprovalSchema } from "@/contracts/approval";
import { type Period, PeriodSchema } from "@/contracts/dates";
import { type Decision, DecisionSchema } from "@/contracts/decision";
import {
  type DecisionRecord,
  DecisionRecordSchema,
  deriveHistoryStatus,
} from "@/contracts/decision-record";
import { type HistoryEntry, HistoryEntrySchema, type HistoryEntryStatus } from "@/contracts/history";
import type { Executor } from "./db";

type StoredDecision = {
  record: DecisionRecord;
  decisionPeriod: Period;
  approvalPeriod: Period | null;
};

const SELECT_STORED_DECISIONS = `
SELECT i.file_name, i.invoice_json, i.extraction_failure,
       d.decision_json, d.period AS decision_period,
       a.approval_json, a.period AS approval_period
FROM decisions d
JOIN invoices i ON i.id = d.invoice_id
LEFT JOIN approvals a ON a.decision_id = d.id`;

// period is the budget period of the decision, in the configured time zone (toPeriod in the engine).
export async function insertDecision(
  db: Executor,
  decision: Decision,
  period: Period,
): Promise<void> {
  const valid = DecisionSchema.parse(decision);
  await db.execute({
    sql: "INSERT INTO decisions (id, invoice_id, period, decision_json) VALUES (?, ?, ?, ?)",
    args: [valid.id, valid.invoiceId, PeriodSchema.parse(period), JSON.stringify(valid)],
  });
}

// Idempotency: a file already processed returns its record instead of being decided again.
export async function findDecisionByFileHash(
  db: Executor,
  fileHash: string,
): Promise<DecisionRecord | null> {
  const [stored] = await selectStoredDecisions(db, "WHERE i.file_hash = ?", [fileHash]);
  return stored?.record ?? null;
}

export async function findDecisionRecord(
  db: Executor,
  decisionId: string,
): Promise<DecisionRecord | null> {
  const [stored] = await selectStoredDecisions(db, "WHERE d.id = ?", [decisionId]);
  return stored?.record ?? null;
}

// Newest first, optionally only one resulting status (the inbox asks for PENDING_APPROVAL).
// ponytail: reads every decision and filters here; add indexed columns past a few thousand invoices.
export async function listDecisionRecords(
  db: Executor,
  status?: HistoryEntryStatus,
): Promise<DecisionRecord[]> {
  const stored = await selectStoredDecisions(db, "ORDER BY d.rowid DESC", []);
  return stored
    .map(({ record }) => record)
    .filter((record) => status === undefined || record.status === status);
}

// Every past invoice the engine compares against, from every period: R2 also needs earlier months.
export async function listHistoryEntries(db: Executor): Promise<HistoryEntry[]> {
  const stored = await selectStoredDecisions(db, "ORDER BY d.rowid", []);
  return stored.map(toHistoryEntry);
}

async function selectStoredDecisions(
  db: Executor,
  clause: string,
  args: InArgs,
): Promise<StoredDecision[]> {
  const { rows } = await db.execute({ sql: `${SELECT_STORED_DECISIONS} ${clause}`, args });
  return rows.map(toStoredDecision);
}

function toStoredDecision(row: Row): StoredDecision {
  const decision = DecisionSchema.parse(JSON.parse(String(row.decision_json)));
  const approval =
    row.approval_json === null
      ? null
      : ApprovalSchema.parse(JSON.parse(String(row.approval_json)));
  const record = DecisionRecordSchema.parse({
    fileName: row.file_name,
    status: deriveHistoryStatus(decision.outcome, approval),
    invoice: JSON.parse(String(row.invoice_json)),
    decision,
    approval,
    extractionFailure: row.extraction_failure,
  });
  return {
    record,
    decisionPeriod: PeriodSchema.parse(row.decision_period),
    approvalPeriod: row.approval_period === null ? null : PeriodSchema.parse(row.approval_period),
  };
}

// An approved escalation counts in the period and at the time of its approval (HistoryEntry contract).
// Money is always the decision's, never recomputed. An uncertain payee or reference is null, the same
// way rule-context.ts treats uncertain money, so R2 compares only on what was read with certainty.
function toHistoryEntry({ record, decisionPeriod, approvalPeriod }: StoredDecision): HistoryEntry {
  const { invoice, decision, approval, status } = record;
  const { payee, reference } = invoice.extraction;
  const approvedPayment = approval?.resultingOutcome === "PAY" ? approval : null;
  return HistoryEntrySchema.parse({
    invoiceId: invoice.id,
    fileHash: invoice.fileHash,
    payee: payee.isUncertain ? null : payee.value,
    reference: reference.isUncertain ? null : reference.value,
    amountMinor: decision.amountMinor,
    currency: decision.currency,
    exchangeRate: decision.exchangeRate,
    baseAmountMinor: decision.baseAmountMinor,
    status,
    period: approvedPayment === null ? decisionPeriod : approvalPeriod,
    decidedAt: approvedPayment === null ? decision.decidedAt : approvedPayment.resolvedAt,
  });
}
```

`src/store/approval-repository.ts`:

```ts
import { type Approval, ApprovalSchema } from "@/contracts/approval";
import { type Period, PeriodSchema } from "@/contracts/dates";
import type { Executor } from "./db";

// period is the budget period of the approval (configured time zone), fixed when it is resolved.
// The primary key on decision_id refuses a second resolution of the same decision.
export async function insertApproval(
  db: Executor,
  approval: Approval,
  period: Period,
): Promise<void> {
  const valid = ApprovalSchema.parse(approval);
  await db.execute({
    sql: "INSERT INTO approvals (decision_id, period, approval_json) VALUES (?, ?, ?)",
    args: [valid.decisionId, PeriodSchema.parse(period), JSON.stringify(valid)],
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/store`
Expected: PASS, 4 files.

- [ ] **Step 8: Document Turso as the development database**

Replace the database block of `.env.example` (the comment `# Local development uses a file...` and its two variables) with:

```bash
# Your own Turso database (one per developer: npm run demo resets it). Steps in README.md.
# Offline Plan B: TURSO_DATABASE_URL=file:local.db
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

In `CLAUDE.md`, "Getting started": replace the sentence `No secrets are needed to start: the database is a local file (\`file:local.db\`) and the UI uses mocks (\`NEXT_PUBLIC_USE_MOCK_API=true\`). \`ANTHROPIC_API_KEY\` is only needed for live extraction.` with:

```markdown
No secrets are needed to start the UI: it uses mocks (`NEXT_PUBLIC_USE_MOCK_API=true`). The backend needs your own Turso database in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, one per developer because `npm run demo` resets it (steps in `README.md`); `TURSO_DATABASE_URL=file:local.db` is the offline Plan B. Tests use `:memory:`. `ANTHROPIC_API_KEY` is only needed for live extraction.
```

Also in `CLAUDE.md`, "Stack": replace `` `@libsql/client` (local file, Turso on deploy) `` with `` `@libsql/client` (Turso; `:memory:` in tests) ``.

In `README.md`, step 2 of "Puesta en marcha": replace the paragraph `Para empezar no hace falta llenar nada: la base de datos es un archivo local y la UI usa datos de ejemplo. \`ANTHROPIC_API_KEY\` solo se necesita para leer facturas con el modelo de verdad.` with:

````markdown
Con eso ya puedes trabajar en la UI: usa datos de ejemplo (`NEXT_PUBLIC_USE_MOCK_API=true`) y no necesita secretos. `ANTHROPIC_API_KEY` solo se necesita para leer facturas con el modelo de verdad.

**Si vas a correr el backend** (la API o `npm run demo`), crea **tu propia** base de datos en Turso. Es gratis, y cada persona usa la suya porque `npm run demo` la borra y la vuelve a cargar:

1. Crea una cuenta en https://turso.tech e instala la CLI `turso` (en Windows, úsala desde WSL o crea la base en el panel web).
2. Crea la base y copia sus datos en `.env.local`:

```bash
turso auth login
turso db create triple-firma-<tu-nombre>
turso db show triple-firma-<tu-nombre> --url     # va en TURSO_DATABASE_URL
turso db tokens create triple-firma-<tu-nombre>  # va en TURSO_AUTH_TOKEN
```

> **¿Sin internet?** Pon `TURSO_DATABASE_URL=file:local.db` en `.env.local`: todo funciona igual con un archivo local (es el plan B de la presentación).
````

Run: `npx prettier --write CLAUDE.md README.md`

- [ ] **Step 9: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`
Expected: all green.

```bash
git add src/store tests/store .env.example CLAUDE.md README.md
git commit -F - <<'EOF'
feat(store): add libsql schema and repositories

Rows keep each validated contract object as JSON, with columns only where the
database enforces something (unique file hash, one decision per invoice, one
approval per decision), so contract changes need no migration. The history
status comes from deriveHistoryStatus, the same function the API uses.
Development now runs on each developer's own Turso database.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 10: Ship.** Follow "How every task ends" step 3.

---

### Task 3: Append-only audit log (commit 4: `feat(store): add append-only audit log`)

**Files:**
- Modify: `src/store/schema.ts`, `tests/store/fixtures.ts`
- Create: `src/store/audit-log.ts`
- Test: `tests/store/audit-log.test.ts`

**Interfaces:**
- Consumes: `AuditEntrySchema`, `AuditEntry`, `AuditEntryType` (`src/contracts/audit-entry.ts`); `Executor` (Task 2).
- Produces:
  - `appendAuditEntry(db: Executor, type: AuditEntryType, payload: unknown, createdAt: string): Promise<AuditEntry>`; `payload` is validated as JSON by `AuditEntrySchema`;
  - `hashAuditEntry(fields: { seq: number; type: string; payload: unknown; prevHash: string | null; createdAt: string }): string`;
  - `canonicalJson(value: unknown): string`;
  - test fixture `countAuditEntries(db: Executor): Promise<number>`.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/store-audit-log
```

- [ ] **Step 2: Write the failing test**

Append to `tests/store/fixtures.ts`. Add `import type { Executor } from "@/store/db";` to its imports, and add this function:

```ts
export async function countAuditEntries(db: Executor): Promise<number> {
  const { rows } = await db.execute("SELECT count(*) AS n FROM audit_entries");
  return Number(rows[0]?.n);
}
```

`tests/store/audit-log.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/store/audit-log.test.ts`
Expected: FAIL with `Failed to resolve import "@/store/audit-log"`.

- [ ] **Step 4: Add the table and triggers**

In `src/store/schema.ts`, insert before the closing backtick of `SCHEMA`, after the `approvals` table:

```sql
CREATE TABLE IF NOT EXISTS audit_entries (
  seq INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_entries_no_update BEFORE UPDATE ON audit_entries
  BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_entries_no_delete BEFORE DELETE ON audit_entries
  BEGIN SELECT RAISE(ABORT, 'audit_entries is append-only'); END;
```

In `DROP_SCHEMA`, add `DROP TABLE IF EXISTS audit_entries;` as its first line.

- [ ] **Step 5: Implement the log**

`src/store/audit-log.ts`:

```ts
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
  const { rows } = await db.execute("SELECT seq, hash FROM audit_entries ORDER BY seq DESC LIMIT 1");
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/store`
Expected: PASS, including the 4 files from Task 2 (`resetDb` now also drops `audit_entries`).

- [ ] **Step 7: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`

```bash
git add src/store tests/store
git commit -F - <<'EOF'
feat(store): add append-only audit log

Triggers reject UPDATE and DELETE, so the log only grows. Entries already carry
their SHA-256 hash and the link to the previous one, because AuditEntrySchema
requires both from the first entry; verifying the chain comes in its own commit.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8: Ship.** Follow "How every task ends" step 3.

---

### Task 4: Invoice processing pipeline (commit 5: `feat(pipeline): add invoice processing pipeline`)

**Gate:** `test -f src/extraction/extract-invoice.ts` must succeed on `main` (B merged). If it fails, stop and tell the user that B's `feat/extraction-module` must merge first.

**Files:**
- Create: `src/pipeline/save-rules-config.ts`, `src/pipeline/process-invoice.ts`, `src/pipeline/dataset.ts`
- Test: `tests/pipeline/save-rules-config.test.ts`, `tests/pipeline/process-invoice.test.ts`, `tests/pipeline/dataset.test.ts`

**Interfaces:**
- Consumes:
  - `extractInvoice(input: { fileHash: string; fileBuffer: Buffer; sourceFormat: SourceFormat; sourceText: string | null }): Promise<{ ok: true; extraction: Extraction; cached: boolean } | { ok: false; extraction: Extraction; reason: string }>` and `makeUncertainExtraction(): Extraction` (B);
  - `evaluateRules({ invoice, config, history, now, configVersion }): Decision` and `toPeriod(isoUtc, timezone): Period` (A);
  - the store functions from Tasks 2 and 3.
- Produces:
  - `saveRulesConfig(db: Client, config: RulesConfig, now: string): Promise<RulesConfigVersion>`;
  - `type InvoiceUpload = { fileName: string; fileBuffer: Buffer; sourceFormat: SourceFormat }`;
  - `type ProcessInvoiceResult = { ok: true; record: DecisionRecord; isResubmission: boolean } | { ok: false; reason: "NO_RULES_CONFIG" | "EMPTY_SOURCE_TEXT" | "SOURCE_TEXT_TOO_LONG" }`;
  - `processInvoice(db: Client, upload: InvoiceUpload, now: string): Promise<ProcessInvoiceResult>`;
  - `detectSourceFormat(fileName: string): SourceFormat | null`;
  - `DATASET_NOW = "2026-10-15T15:00:00Z"`, `INVOICE_SETS = ["dev", "adversarial", "holdout"] as const`, `type InvoiceSet`, `DATA_DIR`;
  - `readCompanyConfig(dataDir?: string): Promise<RulesConfig>`;
  - `processInvoiceSet(db: Client, set: InvoiceSet, now: string, dataDir?: string): Promise<{ fileName: string; result: ProcessInvoiceResult }[]>`.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && test -f src/extraction/extract-invoice.ts && git switch -c feat/pipeline-process-invoice
```

- [ ] **Step 2: Write the failing tests**

`tests/pipeline/save-rules-config.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb } from "../store/fixtures";

let db: Client;
beforeEach(async () => {
  db = await openMemoryDb();
});

describe("saveRulesConfig", () => {
  it("creates a new version with its audit entry on every save", async () => {
    await saveRulesConfig(db, buildRulesConfig(), NOW);
    const second = await saveRulesConfig(db, buildRulesConfig({ approvalThresholdMinor: 150_000 }), NOW);

    expect(second.version).toBe(2);
    expect((await findCurrentRulesConfig(db))?.config.approvalThresholdMinor).toBe(150_000);
    const { rows } = await db.execute(
      "SELECT type, json_extract(payload_json, '$.version') AS version FROM audit_entries ORDER BY seq",
    );
    expect(rows.map((row) => [row.type, row.version])).toEqual([
      ["RULES_CONFIG_CHANGE", 1],
      ["RULES_CONFIG_CHANGE", 2],
    ]);
  });

  it("stores nothing for an invalid config", async () => {
    const invalid = buildRulesConfig({ approvalThresholdMinor: 0 });
    await expect(saveRulesConfig(db, invalid, NOW)).rejects.toThrow();
    expect(await findCurrentRulesConfig(db)).toBeNull();
    expect(await countAuditEntries(db)).toBe(0);
  });
});
```

`tests/pipeline/process-invoice.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { extractInvoice, makeUncertainExtraction } from "@/extraction/extract-invoice";
import { detectSourceFormat, processInvoice } from "@/pipeline/process-invoice";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { listDecisionRecords } from "@/store/decision-repository";
import { buildExtraction, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { countAuditEntries, openMemoryDb, openTempFileDb } from "../store/fixtures";

vi.mock("@/extraction/extract-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/extraction/extract-invoice")>()),
  extractInvoice: vi.fn(),
}));

const extractMock = vi.mocked(extractInvoice);
const PDF = {
  fileName: "dev/01-invoice.pdf",
  fileBuffer: Buffer.from("%PDF-1.4 factura 01"),
  sourceFormat: "PDF" as const,
};

let db: Client;
beforeEach(async () => {
  extractMock.mockReset();
  extractMock.mockResolvedValue({ ok: true, extraction: buildExtraction(), cached: true });
  db = await openMemoryDb();
  await saveRulesConfig(db, buildRulesConfig(), NOW);
});

describe("processInvoice", () => {
  it("decides a new invoice and records it with one audit entry", async () => {
    const result = await processInvoice(db, PDF, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.isResubmission).toBe(false);
    expect(result.record).toMatchObject({
      fileName: "dev/01-invoice.pdf",
      approval: null,
      extractionFailure: null,
    });
    expect(result.record.invoice.receivedAt).toBe(NOW);
    expect(result.record.decision.ruleResults).toHaveLength(10);
    expect(await countAuditEntries(db)).toBe(2); // the rules config, then the decision
  });

  it("returns the same record for the same file without deciding again", async () => {
    const first = await processInvoice(db, PDF, NOW);
    const second = await processInvoice(db, { ...PDF, fileName: "dev/02-resend.pdf" }, NOW);

    if (!first.ok || !second.ok) throw new Error("both uploads should succeed");
    expect(second.isResubmission).toBe(true);
    expect(second.record.decision.id).toBe(first.record.decision.id);
    expect(second.record.fileName).toBe("dev/01-invoice.pdf");
    expect(extractMock).toHaveBeenCalledTimes(1);
    expect(await countAuditEntries(db)).toBe(2);
  });

  it("stores the extraction failure and never pays an unreadable invoice", async () => {
    extractMock.mockResolvedValue({
      ok: false,
      extraction: makeUncertainExtraction(),
      reason: "Reader error: timeout",
    });
    const result = await processInvoice(db, PDF, NOW);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.extractionFailure).toBe("Reader error: timeout");
    expect(result.record.decision.outcome).not.toBe("PAY");
  });

  it("refuses to decide without a rules config and stores nothing", async () => {
    const empty = await openMemoryDb();
    expect(await processInvoice(empty, PDF, NOW)).toEqual({ ok: false, reason: "NO_RULES_CONFIG" });
    expect(await listDecisionRecords(empty)).toEqual([]);
    expect(await countAuditEntries(empty)).toBe(0);
  });

  it("passes the original text of emails and chats to the reader", async () => {
    const chat = {
      fileName: "dev/03-chat.txt",
      fileBuffer: Buffer.from("[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00"),
      sourceFormat: "CHAT" as const,
    };
    const result = await processInvoice(db, chat, NOW);

    expect(extractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFormat: "CHAT",
        sourceText: "[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00",
      }),
    );
    expect(result.ok && result.record.invoice.sourceText).toBe(
      "[10:02] Dev Partners SAS: cobro INV-102 por USD 2,500.00",
    );
  });

  it("rejects an empty email or chat before calling the reader", async () => {
    const blank = { fileName: "dev/04.txt", fileBuffer: Buffer.from(" \n "), sourceFormat: "CHAT" as const };
    expect(await processInvoice(db, blank, NOW)).toEqual({ ok: false, reason: "EMPTY_SOURCE_TEXT" });
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("rejects a text longer than the invoice contract allows", async () => {
    const long = {
      fileName: "dev/05.txt",
      fileBuffer: Buffer.from("a".repeat(200_001)),
      sourceFormat: "CHAT" as const,
    };
    expect(await processInvoice(db, long, NOW)).toEqual({
      ok: false,
      reason: "SOURCE_TEXT_TOO_LONG",
    });
  });

  it("decides a file uploaded twice at the same time only once", async () => {
    const fileDb = await openTempFileDb();
    await saveRulesConfig(fileDb, buildRulesConfig(), NOW);

    const results = await Promise.all([
      processInvoice(fileDb, PDF, NOW),
      processInvoice(fileDb, PDF, NOW),
    ]);

    expect(results.map((result) => result.ok && result.isResubmission).sort()).toEqual([false, true]);
    expect(await listDecisionRecords(fileDb)).toHaveLength(1);
  });
});

describe("detectSourceFormat", () => {
  it.each([
    ["factura.pdf", "PDF"],
    ["SCAN.PDF", "PDF"],
    ["foto.jpeg", "IMAGE"],
    ["foto.PNG", "IMAGE"],
    ["correo.eml", "EMAIL"],
    ["chat.txt", "CHAT"],
    ["notas.md", null],
    ["README", null],
    [".gitkeep", null],
    ["x.constructor", null],
  ])("%s is %s", (fileName, sourceFormat) => {
    expect(detectSourceFormat(fileName)).toBe(sourceFormat);
  });
});
```

`tests/pipeline/dataset.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import { extractInvoice } from "@/extraction/extract-invoice";
import { processInvoiceSet, readCompanyConfig } from "@/pipeline/dataset";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { listDecisionRecords } from "@/store/decision-repository";
import { buildExtraction, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { openMemoryDb } from "../store/fixtures";

vi.mock("@/extraction/extract-invoice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/extraction/extract-invoice")>()),
  extractInvoice: vi.fn(),
}));

const extractMock = vi.mocked(extractInvoice);

// A data directory like data/ with one invoice set holding the given files.
function buildDataDir(files: Record<string, string>): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
  const setDir = path.join(dataDir, "invoices", "dev");
  mkdirSync(setDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(setDir, name), content);
  return dataDir;
}

let db: Client;
beforeEach(async () => {
  extractMock.mockReset();
  extractMock.mockResolvedValue({ ok: true, extraction: buildExtraction(), cached: true });
  db = await openMemoryDb();
  await saveRulesConfig(db, buildRulesConfig(), NOW);
});

describe("processInvoiceSet", () => {
  it("processes a set in file name order, one file at a time, skipping other files", async () => {
    const dataDir = buildDataDir({
      "b-second.txt": "chat b",
      "a-first.txt": "chat a",
      ".gitkeep": "",
      "notes.md": "not an invoice",
    });

    const results = await processInvoiceSet(db, "dev", NOW, dataDir);

    expect(results.map((item) => item.fileName)).toEqual(["dev/a-first.txt", "dev/b-second.txt"]);
    expect(extractMock.mock.calls.map(([input]) => input.sourceText)).toEqual(["chat a", "chat b"]);
  });

  it("returns the first file's record for a byte-identical copy in the set", async () => {
    const dataDir = buildDataDir({ "a-original.txt": "same bytes", "b-copy.txt": "same bytes" });

    const [original, copy] = await processInvoiceSet(db, "dev", NOW, dataDir);

    expect(original?.result).toMatchObject({ ok: true, isResubmission: false });
    expect(copy?.result).toMatchObject({
      ok: true,
      isResubmission: true,
      record: { fileName: "dev/a-original.txt" },
    });
    expect(await listDecisionRecords(db)).toHaveLength(1);
  });
});

describe("readCompanyConfig", () => {
  it("reads and validates data/config/company.json", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
    mkdirSync(path.join(dataDir, "config"));
    writeFileSync(path.join(dataDir, "config", "company.json"), JSON.stringify(buildRulesConfig()));
    expect(await readCompanyConfig(dataDir)).toEqual(buildRulesConfig());
  });

  it("rejects an invalid company config", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "triple-firma-data-"));
    mkdirSync(path.join(dataDir, "config"));
    writeFileSync(path.join(dataDir, "config", "company.json"), JSON.stringify({ baseCurrency: "USD" }));
    await expect(readCompanyConfig(dataDir)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/pipeline`
Expected: FAIL with `Failed to resolve import "@/pipeline/save-rules-config"` (and `process-invoice`, `dataset`).

- [ ] **Step 4: Implement `saveRulesConfig`**

`src/pipeline/save-rules-config.ts`:

```ts
import type { Client } from "@libsql/client";
import type { RulesConfig, RulesConfigVersion } from "@/contracts/rules-config";
import { appendAuditEntry } from "@/store/audit-log";
import { insertRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";

// Every change creates a new version with its audit entry; the engine always reads the latest one.
export function saveRulesConfig(
  db: Client,
  config: RulesConfig,
  now: string,
): Promise<RulesConfigVersion> {
  return withWriteTransaction(db, async (tx) => {
    const saved = await insertRulesConfig(tx, config, now);
    await appendAuditEntry(tx, "RULES_CONFIG_CHANGE", { version: saved.version, config: saved.config }, now);
    return saved;
  });
}
```

- [ ] **Step 5: Implement `processInvoice`**

`src/pipeline/process-invoice.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { Client } from "@libsql/client";
import type { DecisionRecord } from "@/contracts/decision-record";
import { InvoiceSchema, type SourceFormat } from "@/contracts/invoice";
import { evaluateRules } from "@/engine/evaluate-rules";
import { toPeriod } from "@/engine/rule-context";
import { extractInvoice } from "@/extraction/extract-invoice";
import { appendAuditEntry } from "@/store/audit-log";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";
import {
  findDecisionByFileHash,
  findDecisionRecord,
  insertDecision,
  listHistoryEntries,
} from "@/store/decision-repository";
import { insertInvoice } from "@/store/invoice-repository";

export type InvoiceUpload = { fileName: string; fileBuffer: Buffer; sourceFormat: SourceFormat };

export type ProcessInvoiceResult =
  | { ok: true; record: DecisionRecord; isResubmission: boolean }
  | { ok: false; reason: "NO_RULES_CONFIG" | "EMPTY_SOURCE_TEXT" | "SOURCE_TEXT_TOO_LONG" };

const SOURCE_FORMATS_BY_EXTENSION = new Map<string, SourceFormat>([
  [".pdf", "PDF"],
  [".png", "IMAGE"],
  [".jpg", "IMAGE"],
  [".jpeg", "IMAGE"],
  [".webp", "IMAGE"],
  [".gif", "IMAGE"],
  [".eml", "EMAIL"],
  [".txt", "CHAT"],
]);
const TEXT_FORMATS: readonly SourceFormat[] = ["EMAIL", "CHAT"];
const MAX_SOURCE_TEXT_LENGTH = 200_000; // InvoiceSchema's limit for sourceText

// By extension only: emails are .eml and chats are .txt (agreed with C). A Map, so a name such as
// "x.constructor" can never match an Object prototype key.
export function detectSourceFormat(fileName: string): SourceFormat | null {
  return SOURCE_FORMATS_BY_EXTENSION.get(path.extname(fileName).toLowerCase()) ?? null;
}

// hash → extraction (B) → engine (A) → decision and audit entry. The same file twice returns its first
// record, so a resubmission can never become a second payment.
export async function processInvoice(
  db: Client,
  upload: InvoiceUpload,
  now: string,
): Promise<ProcessInvoiceResult> {
  const fileHash = createHash("sha256").update(upload.fileBuffer).digest("hex");
  const previous = await findDecisionByFileHash(db, fileHash);
  if (previous !== null) return { ok: true, record: previous, isResubmission: true };

  // ponytail: .eml is read as raw text, without MIME decoding; decode it if real emails arrive.
  const sourceText = TEXT_FORMATS.includes(upload.sourceFormat)
    ? upload.fileBuffer.toString("utf8")
    : null;
  if (sourceText !== null && sourceText.trim() === "") return { ok: false, reason: "EMPTY_SOURCE_TEXT" };
  if (sourceText !== null && sourceText.length > MAX_SOURCE_TEXT_LENGTH) {
    return { ok: false, reason: "SOURCE_TEXT_TOO_LONG" };
  }

  // The LLM call runs before the transaction: a slow read must never hold the database write lock.
  const extracted = await extractInvoice({
    fileHash,
    fileBuffer: upload.fileBuffer,
    sourceFormat: upload.sourceFormat,
    sourceText,
  });
  const invoice = InvoiceSchema.parse({
    id: randomUUID(),
    fileHash,
    sourceFormat: upload.sourceFormat,
    sourceText,
    receivedAt: now,
    extraction: extracted.extraction,
  });
  const extractionFailure = extracted.ok ? null : extracted.reason;

  return withWriteTransaction<ProcessInvoiceResult>(db, async (tx) => {
    // Checked again inside the lock: two uploads of the same file at once end with one decision.
    const concurrent = await findDecisionByFileHash(tx, fileHash);
    if (concurrent !== null) return { ok: true, record: concurrent, isResubmission: true };

    const current = await findCurrentRulesConfig(tx);
    if (current === null) return { ok: false, reason: "NO_RULES_CONFIG" };

    // Config and history are read in the same write transaction that stores the decision, so two
    // invoices processed at once can never both spend the same remaining budget.
    const history = await listHistoryEntries(tx);
    const decision = evaluateRules({
      invoice,
      config: current.config,
      history,
      now,
      configVersion: current.version,
    });
    await insertInvoice(tx, { invoice, fileName: upload.fileName, fileBytes: upload.fileBuffer, extractionFailure });
    await insertDecision(tx, decision, toPeriod(now, current.config.timezone));
    await appendAuditEntry(
      tx,
      "DECISION",
      {
        invoiceId: invoice.id,
        fileHash,
        fileName: upload.fileName,
        sourceFormat: invoice.sourceFormat,
        extraction: invoice.extraction,
        extractionFailure,
        decision,
      },
      now,
    );

    const record = await findDecisionRecord(tx, decision.id);
    if (record === null) throw new Error(`Decision ${decision.id} was not stored`);
    return { ok: true, record, isResubmission: false };
  });
}
```

- [ ] **Step 6: Implement the dataset helpers**

`src/pipeline/dataset.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "@libsql/client";
import { type RulesConfig, RulesConfigSchema } from "@/contracts/rules-config";
import { detectSourceFormat, processInvoice, type ProcessInvoiceResult } from "./process-invoice";

// The dataset's fixed clock, agreed with C. Demo, eval and CI decide every dataset invoice at this
// instant, so results never depend on the day they run. UI uploads use the real clock; keep this in
// the month of the presentation so both share one budget period.
export const DATASET_NOW = "2026-10-15T15:00:00Z";

export const INVOICE_SETS = ["dev", "adversarial", "holdout"] as const;
export type InvoiceSet = (typeof INVOICE_SETS)[number];

export const DATA_DIR = path.join(process.cwd(), "data");

export async function readCompanyConfig(dataDir = DATA_DIR): Promise<RulesConfig> {
  const text = await readFile(path.join(dataDir, "config", "company.json"), "utf8");
  return RulesConfigSchema.parse(JSON.parse(text));
}

// One file at a time, sorted by name: duplicates and the budget depend on the order. Files that are
// not invoices (.gitkeep, notes) are skipped.
export async function processInvoiceSet(
  db: Client,
  set: InvoiceSet,
  now: string,
  dataDir = DATA_DIR,
): Promise<{ fileName: string; result: ProcessInvoiceResult }[]> {
  const directory = path.join(dataDir, "invoices", set);
  const results: { fileName: string; result: ProcessInvoiceResult }[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const sourceFormat = detectSourceFormat(name);
    if (sourceFormat === null) continue;
    const fileName = `${set}/${name}`;
    const fileBuffer = await readFile(path.join(directory, name));
    results.push({ fileName, result: await processInvoice(db, { fileName, fileBuffer, sourceFormat }, now) });
  }
  return results;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline tests/store`
Expected: PASS.

- [ ] **Step 8: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`. If Prettier rewraps long lines, run `npx prettier --write src/pipeline tests/pipeline` and re-run.

```bash
git add src/pipeline tests/pipeline
git commit -F - <<'EOF'
feat(pipeline): add invoice processing pipeline

The LLM call runs before the write transaction; config, history, decision and
audit entry share one transaction, so two invoices processed at once cannot
spend the same budget. The same file twice returns its first record. The
dataset clock is fixed (DATASET_NOW, agreed with C) so demo and eval are
reproducible.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 9: Ship.** Follow "How every task ends" step 3. In the PR description, ask C to confirm `DATASET_NOW`.

---

### Task 5: Invoice, decision and config endpoints (commit 6: `feat(api): add invoice, decision and config endpoints`)

**Files:**
- Create: `src/app/api/responses.ts`, `src/app/api/invoices/route.ts`, `src/app/api/invoices/[id]/file/route.ts`, `src/app/api/decisions/route.ts`, `src/app/api/decisions/[id]/route.ts`, `src/app/api/config/route.ts`

**Interfaces:**
- Consumes: `processInvoice`, `detectSourceFormat`, `saveRulesConfig` (Task 4); `getDb`, `listDecisionRecords`, `findDecisionRecord`, `findCurrentRulesConfig`, `findInvoiceFile` (Task 2); `ApiError`, `ApiErrorCode` (Task 1); `RulesConfigSchema`, `HistoryEntryStatusSchema`.
- Produces: `jsonError(status: number, error: ApiErrorCode, issues?: readonly { path: readonly PropertyKey[]; message: string }[]): Response`, plus the HTTP endpoints in the spec's API table.

Route handlers are thin and have no unit tests (spec, "Testing"). They are verified with `typecheck`, `lint`, `build` and `curl` below. `RouteContext<"...">` is a global type generated by `next typegen`, which `npm run typecheck` runs.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/api-invoice-decision-config
```

- [ ] **Step 2: Write the error helper**

`src/app/api/responses.ts`:

```ts
import type { ApiError, ApiErrorCode } from "@/contracts/api-error";

type ValidationIssue = { path: readonly PropertyKey[]; message: string };

// Every 4xx body is an ApiError: a stable code the UI translates, plus the invalid fields, if any.
export function jsonError(
  status: number,
  error: ApiErrorCode,
  issues?: readonly ValidationIssue[],
): Response {
  const body: ApiError = { error };
  if (issues !== undefined) {
    body.issues = issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }
  return Response.json(body, { status });
}
```

- [ ] **Step 3: Write `POST /api/invoices`**

`src/app/api/invoices/route.ts`:

```ts
import { detectSourceFormat, processInvoice } from "@/pipeline/process-invoice";
import { getDb } from "@/store/db";
import { jsonError } from "../responses";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const STATUS_BY_REASON = {
  EMPTY_SOURCE_TEXT: 400,
  SOURCE_TEXT_TOO_LONG: 413,
  NO_RULES_CONFIG: 409,
} as const;

// Upload one invoice as multipart field "file". 201 for a new decision, 200 for a file already decided.
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "MISSING_FILE");
  if (file.size > MAX_FILE_BYTES) return jsonError(413, "FILE_TOO_LARGE");
  const sourceFormat = detectSourceFormat(file.name);
  if (sourceFormat === null) return jsonError(400, "UNSUPPORTED_FILE_TYPE");

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const result = await processInvoice(
    await getDb(),
    { fileName: file.name, fileBuffer, sourceFormat },
    new Date().toISOString(),
  );
  if (!result.ok) return jsonError(STATUS_BY_REASON[result.reason], result.reason);
  return Response.json(result.record, { status: result.isResubmission ? 200 : 201 });
}
```

- [ ] **Step 4: Write `GET /api/invoices/[id]/file`**

`src/app/api/invoices/[id]/file/route.ts`:

```ts
import path from "node:path";
import { connection } from "next/server";
import { getDb } from "@/store/db";
import { findInvoiceFile } from "@/store/invoice-repository";
import { jsonError } from "../../../responses";

const CONTENT_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".eml", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

// The original file, shown inline by the document viewer. nosniff stops the browser from treating it
// as anything but the declared type.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/invoices/[id]/file">,
): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const file = await findInvoiceFile(await getDb(), id);
  if (file === null) return jsonError(404, "NOT_FOUND");

  const extension = path.extname(file.fileName).toLowerCase();
  return new Response(file.fileBytes, {
    headers: {
      "content-type": CONTENT_TYPES.get(extension) ?? "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file.fileName))}`,
      "x-content-type-options": "nosniff",
    },
  });
}
```

- [ ] **Step 5: Write the decision endpoints**

`src/app/api/decisions/route.ts`:

```ts
import { connection } from "next/server";
import { HistoryEntryStatusSchema } from "@/contracts/history";
import { getDb } from "@/store/db";
import { listDecisionRecords } from "@/store/decision-repository";
import { jsonError } from "../responses";

// Every decision, newest first. ?status=PAYABLE|PENDING_APPROVAL|REJECTED|BLOCKED filters by the
// resulting status; the inbox asks for PENDING_APPROVAL.
export async function GET(request: Request): Promise<Response> {
  await connection();
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const parsed = HistoryEntryStatusSchema.optional().safeParse(status);
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);
  return Response.json(await listDecisionRecords(await getDb(), parsed.data));
}
```

`src/app/api/decisions/[id]/route.ts`:

```ts
import { connection } from "next/server";
import { getDb } from "@/store/db";
import { findDecisionRecord } from "@/store/decision-repository";
import { jsonError } from "../../responses";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/decisions/[id]">,
): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const record = await findDecisionRecord(await getDb(), id);
  return record === null ? jsonError(404, "NOT_FOUND") : Response.json(record);
}
```

- [ ] **Step 6: Write the config endpoint**

`src/app/api/config/route.ts`:

```ts
import { connection } from "next/server";
import { RulesConfigSchema } from "@/contracts/rules-config";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { getDb } from "@/store/db";
import { jsonError } from "../responses";

export async function GET(): Promise<Response> {
  await connection();
  const current = await findCurrentRulesConfig(await getDb());
  return current === null ? jsonError(404, "NOT_FOUND") : Response.json(current);
}

// Saves a new version. An invalid config is never stored: 400 lists the invalid fields.
export async function PUT(request: Request): Promise<Response> {
  const parsed = RulesConfigSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);
  return Response.json(await saveRulesConfig(await getDb(), parsed.data, new Date().toISOString()));
}
```

- [ ] **Step 7: Typecheck, lint and build**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green. In the build output, the API routes are listed as dynamic (`ƒ`); the build opens no database.

- [ ] **Step 8: Verify with curl on a throwaway local file (Plan B)**

```bash
rm -f /tmp/triple-firma-e2e.db
TURSO_DATABASE_URL=file:/tmp/triple-firma-e2e.db npm run dev   # in a second terminal
npx tsx -e 'import("./tests/contracts/fixtures.ts").then((m) => console.log(JSON.stringify(m.buildRulesConfig())))' > /tmp/config.json
curl -s localhost:3000/api/config                                           # expect 404 {"error":"NOT_FOUND"}
curl -s -X PUT localhost:3000/api/config -H 'content-type: application/json' -d @/tmp/config.json   # expect {"version":1,...}
curl -s -X PUT localhost:3000/api/config -H 'content-type: application/json' -d '{"baseCurrency":"USD"}'   # expect 400 INVALID_REQUEST with issues
printf 'Dev Partners SAS cobra INV-900 por USD 100.00, vence 2026-10-30' > /tmp/chat.txt
curl -s -o /dev/null -w '%{http_code}\n' -F file=@/tmp/chat.txt localhost:3000/api/invoices   # expect 201
curl -s -o /dev/null -w '%{http_code}\n' -F file=@/tmp/chat.txt localhost:3000/api/invoices   # expect 200 (same decision)
curl -s -F file=@/tmp/config.json localhost:3000/api/invoices                # expect 400 UNSUPPORTED_FILE_TYPE
curl -s 'localhost:3000/api/decisions?status=PENDING_APPROVAL' | head -c 300 # expect one record (no API key -> uncertain -> escalated)
curl -s 'localhost:3000/api/decisions?status=PAID'                           # expect 400 INVALID_REQUEST
```

Then take the `invoice.id` from the list and run `curl -si localhost:3000/api/invoices/<id>/file`. Expect `content-type: text/plain; charset=utf-8` and the chat text. Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add src/app/api
git commit -F - <<'EOF'
feat(api): add invoice, decision and config endpoints

Handlers only parse with contract schemas, call the pipeline or the store, and
map typed failures to status codes with stable error codes the UI translates.
GET handlers call connection() so the build never prerenders them or opens the
database. Includes the original file endpoint for the document viewer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 10: Ship.** Follow "How every task ends" step 3. Tell D in the PR that the endpoints exist and that errors are `ApiErrorCode` values.

---

### Task 6: Approval endpoint with revalidation (commit 7: `feat(api): add approval endpoint with revalidation`)

**Gate:** `grep -n "export function revalidateApproval" src/engine/revalidate-approval.ts` must match on `main`, with the signature from "Prerequisites". If it does not, stop and ask A for the placeholder.

**Files:**
- Create: `src/pipeline/resolve-approval.ts`, `src/app/api/approvals/[decisionId]/route.ts`
- Test: `tests/pipeline/resolve-approval.test.ts`

**Interfaces:**
- Consumes: `revalidateApproval(input: { invoice: Invoice; decision: Decision; config: RulesConfig; history: readonly HistoryEntry[]; now: string }): { resultingOutcome: "PAY" | "BLOCK"; revalidationResults: RuleResult[] }` (A); `ApprovalSchema`, `ApprovalRequestSchema`, `ApprovalRequest`; the store functions; `toPeriod`.
- Produces: `type ResolveApprovalResult = { ok: true; record: DecisionRecord } | { ok: false; reason: "NOT_FOUND" | "NOT_ESCALATED" | "ALREADY_RESOLVED" }`, `resolveApproval(db: Client, decisionId: string, request: ApprovalRequest, now: string): Promise<ResolveApprovalResult>`, and `POST /api/approvals/[decisionId]`.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/api-approval-endpoint
```

- [ ] **Step 2: Write the failing test**

`tests/pipeline/resolve-approval.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@libsql/client";
import type { ApprovalRequest } from "@/contracts/approval";
import type { RuleResult } from "@/contracts/decision";
import { revalidateApproval } from "@/engine/revalidate-approval";
import { resolveApproval } from "@/pipeline/resolve-approval";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { listHistoryEntries } from "@/store/decision-repository";
import { buildDecision, buildRulesConfig } from "../contracts/fixtures";
import { NOW } from "../engine/fixtures";
import { buildStoredInvoice, openMemoryDb, openTempFileDb, storeDecision } from "../store/fixtures";

vi.mock("@/engine/revalidate-approval", () => ({ revalidateApproval: vi.fn() }));

const revalidateMock = vi.mocked(revalidateApproval);
const APPROVE: ApprovalRequest = { action: "APPROVE", approver: "Ana Pérez", comment: "Revisado con el acuerdo." };
const REJECT: ApprovalRequest = { action: "REJECT", approver: "Ana Pérez", comment: "No corresponde." };
const LATER = "2026-11-02T15:00:00Z";

// What A's revalidation returns: PAY only when duplicates (R2) and budget (R6) both pass.
function revalidation(budgetOutcome: RuleResult["outcome"]): ReturnType<typeof revalidateApproval> {
  return {
    resultingOutcome: budgetOutcome === "PASS" ? "PAY" : "BLOCK",
    revalidationResults: [
      { ruleId: "R2", outcome: "PASS", message: "R2: sin duplicados.", compared: {} },
      { ruleId: "R6", outcome: budgetOutcome, message: "R6: presupuesto.", compared: { committedMinor: 0 } },
    ],
  };
}

async function setUp(db: Client, outcome: "ESCALATE" | "PAY" = "ESCALATE") {
  await saveRulesConfig(db, buildRulesConfig(), NOW);
  const decision = buildDecision("inv-1", outcome);
  await storeDecision(db, buildStoredInvoice("inv-1"), decision);
  return decision;
}

let db: Client;
beforeEach(async () => {
  revalidateMock.mockReset();
  db = await openMemoryDb();
});

describe("resolveApproval", () => {
  it("pays an escalation that passes revalidation at approval time", async () => {
    const decision = await setUp(db);
    revalidateMock.mockReturnValue(revalidation("PASS"));

    const result = await resolveApproval(db, decision.id, APPROVE, LATER);

    expect(result).toMatchObject({
      ok: true,
      record: { status: "PAYABLE", approval: { action: "APPROVE", resultingOutcome: "PAY", resolvedAt: LATER } },
    });
    expect(revalidateMock).toHaveBeenCalledWith(
      expect.objectContaining({ now: LATER, decision: expect.objectContaining({ id: decision.id }) }),
    );
    const { rows } = await db.execute("SELECT type FROM audit_entries ORDER BY seq DESC LIMIT 1");
    expect(rows[0]?.type).toBe("APPROVAL");
  });

  it("blocks an approval when revalidation fails", async () => {
    const decision = await setUp(db);
    revalidateMock.mockReturnValue(revalidation("BLOCK"));

    const result = await resolveApproval(db, decision.id, APPROVE, LATER);

    expect(result).toMatchObject({ ok: true, record: { status: "BLOCKED", approval: { resultingOutcome: "BLOCK" } } });
  });

  it("rejects without revalidating", async () => {
    const decision = await setUp(db);

    const result = await resolveApproval(db, decision.id, REJECT, LATER);

    expect(result).toMatchObject({ ok: true, record: { status: "REJECTED", approval: { revalidationResults: [] } } });
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it("keeps the money stored with the decision even after the rates change", async () => {
    await saveRulesConfig(db, buildRulesConfig(), NOW);
    const decision = buildDecision("inv-cop", "ESCALATE", {
      amountMinor: 1_000_000_000,
      currency: "COP",
      exchangeRate: "4000",
      baseAmountMinor: 250_000,
    });
    await storeDecision(db, buildStoredInvoice("inv-cop"), decision);
    await saveRulesConfig(
      db,
      buildRulesConfig({ exchangeRates: { USD: "1", COP: "5000", MXN: "18.50", ARS: "1000" } }),
      NOW,
    );
    revalidateMock.mockReturnValue(revalidation("PASS"));

    const result = await resolveApproval(db, decision.id, APPROVE, LATER);

    if (!result.ok) throw new Error(result.reason);
    expect(result.record.approval).toMatchObject({
      currency: "COP",
      exchangeRate: "4000",
      baseAmountMinor: 250_000,
    });
  });

  it("counts an approved payment in the period of its approval", async () => {
    const decision = await setUp(db);
    revalidateMock.mockReturnValue(revalidation("PASS"));

    await resolveApproval(db, decision.id, APPROVE, LATER);

    const [entry] = await listHistoryEntries(db);
    expect(entry).toMatchObject({ status: "PAYABLE", period: "2026-11" });
  });

  it("answers NOT_FOUND, NOT_ESCALATED and ALREADY_RESOLVED without writing", async () => {
    const decision = await setUp(db);
    await storeDecision(db, buildStoredInvoice("inv-paid"), buildDecision("inv-paid", "PAY"));
    await resolveApproval(db, decision.id, REJECT, LATER);

    expect(await resolveApproval(db, "decision-missing", APPROVE, LATER)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(await resolveApproval(db, "decision-inv-paid", APPROVE, LATER)).toEqual({ ok: false, reason: "NOT_ESCALATED" });
    expect(await resolveApproval(db, decision.id, APPROVE, LATER)).toEqual({ ok: false, reason: "ALREADY_RESOLVED" });
  });

  it("resolves a double click only once", async () => {
    const fileDb = await openTempFileDb();
    const decision = await setUp(fileDb);
    revalidateMock.mockReturnValue(revalidation("PASS"));

    const results = await Promise.all([
      resolveApproval(fileDb, decision.id, APPROVE, LATER),
      resolveApproval(fileDb, decision.id, APPROVE, LATER),
    ]);

    expect(results.map((result) => (result.ok ? "ok" : result.reason)).sort()).toEqual(["ALREADY_RESOLVED", "ok"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/pipeline/resolve-approval.test.ts`
Expected: FAIL with `Failed to resolve import "@/pipeline/resolve-approval"`.

- [ ] **Step 4: Implement `resolveApproval`**

`src/pipeline/resolve-approval.ts`:

```ts
import type { Client } from "@libsql/client";
import { type ApprovalRequest, ApprovalSchema } from "@/contracts/approval";
import type { DecisionRecord } from "@/contracts/decision-record";
import { revalidateApproval } from "@/engine/revalidate-approval";
import { toPeriod } from "@/engine/rule-context";
import { insertApproval } from "@/store/approval-repository";
import { appendAuditEntry } from "@/store/audit-log";
import { findCurrentRulesConfig } from "@/store/config-repository";
import { withWriteTransaction } from "@/store/db";
import { findDecisionRecord, listHistoryEntries } from "@/store/decision-repository";

export type ResolveApprovalResult =
  | { ok: true; record: DecisionRecord }
  | { ok: false; reason: "NOT_FOUND" | "NOT_ESCALATED" | "ALREADY_RESOLVED" };

// A person approves or rejects an escalation. Approving revalidates duplicates (R2) and budget (R6) at
// this moment, through the engine; rejecting is final and revalidates nothing.
export function resolveApproval(
  db: Client,
  decisionId: string,
  request: ApprovalRequest,
  now: string,
): Promise<ResolveApprovalResult> {
  return withWriteTransaction<ResolveApprovalResult>(db, async (tx) => {
    const record = await findDecisionRecord(tx, decisionId);
    if (record === null) return { ok: false, reason: "NOT_FOUND" };
    if (record.decision.outcome !== "ESCALATE") return { ok: false, reason: "NOT_ESCALATED" };
    if (record.approval !== null) return { ok: false, reason: "ALREADY_RESOLVED" };

    const current = await findCurrentRulesConfig(tx);
    if (current === null) throw new Error("A decision exists but no rules config is stored");

    const { invoice, decision } = record;
    const { resultingOutcome, revalidationResults } =
      request.action === "APPROVE"
        ? revalidateApproval({
            invoice,
            decision,
            config: current.config,
            history: await listHistoryEntries(tx),
            now,
          })
        : { resultingOutcome: "BLOCK" as const, revalidationResults: [] };

    // The money is the one stored with the decision, never recomputed with today's rates (invariant 8).
    const approval = ApprovalSchema.parse({
      ...request,
      decisionId,
      resultingOutcome,
      revalidationResults,
      amountMinor: decision.amountMinor,
      currency: decision.currency,
      exchangeRate: decision.exchangeRate,
      baseAmountMinor: decision.baseAmountMinor,
      resolvedAt: now,
    });
    await insertApproval(tx, approval, toPeriod(now, current.config.timezone));
    await appendAuditEntry(tx, "APPROVAL", { approval }, now);

    const resolved = await findDecisionRecord(tx, decisionId);
    if (resolved === null) throw new Error(`Decision ${decisionId} disappeared`);
    return { ok: true, record: resolved };
  });
}
```

- [ ] **Step 5: Write the route**

`src/app/api/approvals/[decisionId]/route.ts`:

```ts
import { ApprovalRequestSchema } from "@/contracts/approval";
import { resolveApproval } from "@/pipeline/resolve-approval";
import { getDb } from "@/store/db";
import { jsonError } from "../../responses";

// Approve or reject an escalation with { action, approver, comment }. The comment is mandatory.
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/approvals/[decisionId]">,
): Promise<Response> {
  const parsed = ApprovalRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return jsonError(400, "INVALID_REQUEST", parsed.error.issues);

  const { decisionId } = await ctx.params;
  const result = await resolveApproval(await getDb(), decisionId, parsed.data, new Date().toISOString());
  if (!result.ok) return jsonError(result.reason === "NOT_FOUND" ? 404 : 409, result.reason);
  return Response.json(result.record);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline`
Expected: PASS.

- [ ] **Step 7: Verify with curl** (same throwaway database and dev server as Task 5, Step 8)

```bash
ID=$(curl -s 'localhost:3000/api/decisions?status=PENDING_APPROVAL' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d)[0].decision.id))')
curl -s -X POST localhost:3000/api/approvals/$ID -H 'content-type: application/json' -d '{"action":"APPROVE","approver":"Ana","comment":""}'   # expect 400 INVALID_REQUEST (comment required)
curl -s -X POST localhost:3000/api/approvals/$ID -H 'content-type: application/json' -d '{"action":"APPROVE","approver":"Ana","comment":"ok"}' | head -c 200   # expect 200 with approval
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/approvals/$ID -H 'content-type: application/json' -d '{"action":"APPROVE","approver":"Ana","comment":"ok"}'   # expect 409
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/api/approvals/decision-missing -H 'content-type: application/json' -d '{"action":"REJECT","approver":"Ana","comment":"no"}'   # expect 404
```

- [ ] **Step 8: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`

```bash
git add src/pipeline/resolve-approval.ts src/app/api/approvals tests/pipeline/resolve-approval.test.ts
git commit -F - <<'EOF'
feat(api): add approval endpoint with revalidation

Approving runs A's revalidation of duplicates and budget inside the same write
transaction that stores the approval, with the money stored in the decision.
Rejecting is final. A second resolution answers 409, backed by the approvals
primary key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 9: Ship.** Follow "How every task ends" step 3.

---

### Task 7: Audit chain verification (commit 8: `feat(store): chain audit entries with sha256 hashes`)

**Files:**
- Modify: `src/store/audit-log.ts` (add `verifyAuditChain`), `tests/store/audit-log.test.ts` (append)
- Create: `src/app/api/audit/verify/route.ts`

**Interfaces:**
- Consumes: `hashAuditEntry` (Task 3), `AuditVerificationSchema` (Task 1).
- Produces: `verifyAuditChain(db: Executor): Promise<AuditVerification>`, `GET /api/audit/verify`.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/store-audit-chain
```

- [ ] **Step 2: Write the failing tests**

In `tests/store/audit-log.test.ts`, change the audit-log import to `import { appendAuditEntry, canonicalJson, hashAuditEntry, verifyAuditChain } from "@/store/audit-log";`, then append:

```ts
describe("verifyAuditChain", () => {
  async function appendThree() {
    const entries = [];
    for (const n of [1, 2, 3]) {
      entries.push(await appendAuditEntry(db, "DECISION", { decisionId: `decision-${n}`, outcome: "BLOCK" }, NOW));
    }
    return entries;
  }

  // What someone with direct database access could do: drop the guards, then edit the log.
  async function tamper(sql: string) {
    await db.execute("DROP TRIGGER audit_entries_no_update");
    await db.execute("DROP TRIGGER audit_entries_no_delete");
    await db.execute(sql);
  }

  it("accepts an empty log", async () => {
    expect(await verifyAuditChain(db)).toEqual({ isValid: true, entryCount: 0, firstInvalidSeq: null, lastHash: null });
  });

  it("accepts an untouched log and returns its last hash", async () => {
    const entries = await appendThree();
    expect(await verifyAuditChain(db)).toEqual({
      isValid: true,
      entryCount: 3,
      firstInvalidSeq: null,
      lastHash: entries[2]?.hash,
    });
  });

  it("detects an edited payload at its position", async () => {
    await appendThree();
    await tamper("UPDATE audit_entries SET payload_json = json_set(payload_json, '$.outcome', 'PAY') WHERE seq = 2");
    expect(await verifyAuditChain(db)).toMatchObject({ isValid: false, firstInvalidSeq: 2 });
  });

  it("detects an edited hash", async () => {
    await appendThree();
    await tamper(`UPDATE audit_entries SET hash = '${"0".repeat(64)}' WHERE seq = 2`);
    expect(await verifyAuditChain(db)).toMatchObject({ isValid: false, firstInvalidSeq: 2 });
  });

  it("detects a deleted entry", async () => {
    await appendThree();
    await tamper("DELETE FROM audit_entries WHERE seq = 2");
    expect(await verifyAuditChain(db)).toMatchObject({ isValid: false, entryCount: 2, firstInvalidSeq: 2 });
  });

  it("reports a payload that is no longer JSON instead of failing", async () => {
    await appendThree();
    await tamper("UPDATE audit_entries SET payload_json = 'not json' WHERE seq = 3");
    expect(await verifyAuditChain(db)).toMatchObject({ isValid: false, firstInvalidSeq: 3 });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/store/audit-log.test.ts`
Expected: FAIL. The new tests fail with `verifyAuditChain is not a function` (or the import fails); the Task 3 tests still pass.

- [ ] **Step 4: Implement `verifyAuditChain`**

In `src/store/audit-log.ts`, change the contract import to `import { type AuditEntry, AuditEntrySchema, type AuditEntryType, type AuditVerification, AuditVerificationSchema } from "@/contracts/audit-entry";`, add `import type { Row } from "@libsql/client";`, and append:

```ts
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
      Number(row.seq) === index + 1 && row.prev_hash === prevHash && recomputeHash(row) === row.hash;
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
```

- [ ] **Step 5: Write the route**

`src/app/api/audit/verify/route.ts`:

```ts
import { connection } from "next/server";
import { verifyAuditChain } from "@/store/audit-log";
import { getDb } from "@/store/db";

// The "Verificar integridad del registro" button.
export async function GET(): Promise<Response> {
  await connection();
  return Response.json(await verifyAuditChain(await getDb()));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/store`
Expected: PASS.

- [ ] **Step 7: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`

```bash
git add src/store/audit-log.ts src/app/api/audit tests/store/audit-log.test.ts
git commit -F - <<'EOF'
feat(store): chain audit entries with sha256 hashes

Entries were hashed and linked since the append-only log, because the contract
requires it; this verifies the chain. It stops at the first entry whose
position, link or hash does not match, reports a non-JSON payload instead of
failing, and returns the last hash as the external anchor the UI shows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8: Ship.** Follow "How every task ends" step 3.

---

### Task 8: Demo commands (commit 9: `feat(scripts): add demo, demo:live and demo:tamper commands`)

**Gate:** `test -f data/config/company.json` (C). If C has not delivered it yet, you can still implement and verify with a temporary copy (Step 5), but do not commit that file. `data/` is C's folder.

**Files:**
- Create: `scripts/demo.ts`, `scripts/demo-tamper.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `openDb`, `resetDb`, `verifyAuditChain`, `SCHEMA` (store); `saveRulesConfig`, `processInvoiceSet`, `readCompanyConfig`, `DATASET_NOW` (pipeline).
- Produces: `npm run demo`, `npm run demo:live`, `npm run demo:tamper`.

`tsx` compiles these scripts as CommonJS, which has no top-level `await`. Each script therefore runs an `async function main()`, and exits with code 1 on error.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/scripts-demo-commands
```

- [ ] **Step 2: Write `scripts/demo.ts`**

```ts
import { DATASET_NOW, processInvoiceSet, readCompanyConfig } from "@/pipeline/dataset";
import { saveRulesConfig } from "@/pipeline/save-rules-config";
import { verifyAuditChain } from "@/store/audit-log";
import { openDb, resetDb } from "@/store/db";

const DEMO_SETS = ["dev", "adversarial"] as const;

// npm run demo resets YOUR database (TURSO_DATABASE_URL), loads the company rules and decides the dev
// and adversarial sets from the extraction cache. npm run demo:live (--live) also calls the model on a
// cache miss and fills data/cache; without --live no tokens are spent.
async function main(): Promise<void> {
  const isLive = process.argv.includes("--live");
  // With no key the reader fails on a cache miss, so that invoice escalates instead of being read.
  if (!isLive) delete process.env.ANTHROPIC_API_KEY;

  const db = await openDb();
  await resetDb(db);
  await saveRulesConfig(db, await readCompanyConfig(), DATASET_NOW);

  const counts = { PAY: 0, BLOCK: 0, ESCALATE: 0 };
  for (const set of DEMO_SETS) {
    for (const { fileName, result } of await processInvoiceSet(db, set, DATASET_NOW)) {
      if (!result.ok) {
        console.log(`SKIPPED   ${fileName}: ${result.reason}`);
        continue;
      }
      const { decision, extractionFailure } = result.record;
      if (result.isResubmission) {
        console.log(`SAME FILE ${fileName}: already decided as ${result.record.fileName}`);
        continue;
      }
      counts[decision.outcome] += 1;
      const failure = extractionFailure === null ? "" : `  (extraction failed: ${extractionFailure})`;
      console.log(`${decision.outcome.padEnd(9)} ${fileName}${failure}`);
    }
  }

  const chain = await verifyAuditChain(db);
  console.log(`\nPAY ${counts.PAY} · BLOCK ${counts.BLOCK} · ESCALATE ${counts.ESCALATE}`);
  console.log(
    chain.isValid
      ? `Audit chain valid: ${chain.entryCount} entries, last hash ${chain.lastHash}`
      : `Audit chain BROKEN at entry ${chain.firstInvalidSeq}`,
  );
  console.log("\nOpen http://localhost:3000");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Write `scripts/demo-tamper.ts`**

```ts
import { openDb } from "@/store/db";
import { SCHEMA } from "@/store/schema";

// What someone with direct access to the database could do: drop the append-only guard, turn the first
// BLOCK decision of the log into PAY, and put the guard back. "Verificar integridad" then reports it.
async function main(): Promise<void> {
  const db = await openDb();
  const { rows } = await db.execute(
    `SELECT seq FROM audit_entries
     WHERE type = 'DECISION' AND json_extract(payload_json, '$.decision.outcome') = 'BLOCK'
     ORDER BY seq LIMIT 1`,
  );
  const target = rows[0];
  if (target === undefined) {
    console.log("No BLOCK decision in the audit log: run npm run demo first.");
    process.exitCode = 1;
    return;
  }

  await db.execute("DROP TRIGGER IF EXISTS audit_entries_no_update");
  await db.execute({
    sql: "UPDATE audit_entries SET payload_json = json_set(payload_json, '$.decision.outcome', 'PAY') WHERE seq = ?",
    args: [target.seq],
  });
  await db.executeMultiple(SCHEMA);
  console.log(`Audit entry ${target.seq} altered: BLOCK -> PAY. Press "Verificar integridad" in the UI.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Add the npm scripts**

In `package.json` `"scripts"`, add after `"format:check"`:

```json
"demo": "tsx --env-file-if-exists=.env.local scripts/demo.ts && next dev",
"demo:live": "tsx --env-file-if-exists=.env.local scripts/demo.ts --live && next dev",
"demo:tamper": "tsx --env-file-if-exists=.env.local scripts/demo-tamper.ts"
```

- [ ] **Step 5: Verify on a throwaway local file**

If `data/config/company.json` does not exist yet, create a temporary one and remember to delete it:

```bash
npx tsx -e 'import("./tests/contracts/fixtures.ts").then((m) => console.log(JSON.stringify(m.buildRulesConfig(), null, 2)))' > data/config/company.json
```

Then:

```bash
TURSO_DATABASE_URL=file:/tmp/triple-firma-demo.db npx tsx scripts/demo.ts
```

Expected: one line per invoice found in `data/invoices/dev` and `data/invoices/adversarial` (none if C has not added them yet), then `PAY n · BLOCK n · ESCALATE n` and `Audit chain valid: ...`.

```bash
TURSO_DATABASE_URL=file:/tmp/triple-firma-demo.db npx tsx scripts/demo-tamper.ts
```

Expected: `Audit entry <n> altered`. If the sets have no BLOCK decision yet, expect `No BLOCK decision in the audit log` and exit code 1. In that case, check the tamper path with the unit tests from Task 7 instead.

If you created the temporary config, delete it (`rm data/config/company.json`) and confirm with `git status` that `data/` is untouched.

- [ ] **Step 6: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`

```bash
git add scripts/demo.ts scripts/demo-tamper.ts package.json
git commit -F - <<'EOF'
feat(scripts): add demo, demo:live and demo:tamper commands

demo resets the developer's own database and decides the dev and adversarial
sets from the extraction cache with the dataset clock; without --live the API
key is dropped so a cache miss escalates instead of spending tokens.
demo:tamper edits one log entry the way someone with database access could.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: Ship.** Follow "How every task ends" step 3.

---

### Task 9 (extra, tell A): Metrics against expected decisions (`feat(pipeline): compute metrics against expected decisions`)

This commit is not in PROPUESTA's list. It exists because E owns the metrics formula (decision recorded in the spec). Mention it to A in the PR.

**Files:**
- Create: `src/pipeline/compute-metrics.ts`, `src/app/api/metrics/route.ts`
- Modify: `src/pipeline/dataset.ts` (add `readExpectedDecisions`)
- Test: `tests/pipeline/compute-metrics.test.ts`

**Interfaces:**
- Consumes: `DecisionRecord`, `deriveHistoryStatus`, `ExpectedDecisionSchema`, `MetricsSchema` (Task 1); `listDecisionRecords`, `getDb`; `DATA_DIR`.
- Produces:
  - `parseExpectedCsv(text: string): ExpectedDecision[]`;
  - `computeMetrics(records: readonly DecisionRecord[], expected: readonly ExpectedDecision[]): Metrics`;
  - `readExpectedDecisions(dataDir?: string): Promise<ExpectedDecision[]>`;
  - `GET /api/metrics`.

  C's `scripts/eval.ts` composes: `openDb(":memory:")` → `saveRulesConfig(readCompanyConfig(), DATASET_NOW)` → `processInvoiceSet` for `dev` and `adversarial` → `listDecisionRecords` → `computeMetrics(records, await readExpectedDecisions())` → exit 1 if `leaks > 0`.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c feat/pipeline-metrics
```

- [ ] **Step 2: Write the failing test**

`tests/pipeline/compute-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Decision, DecisionOutcome, RuleId } from "@/contracts/decision";
import { type DecisionRecord, deriveHistoryStatus } from "@/contracts/decision-record";
import type { ExpectedDecision } from "@/contracts/metrics";
import { computeMetrics, parseExpectedCsv } from "@/pipeline/compute-metrics";
import { buildDecision } from "../contracts/fixtures";
import { buildInvoice } from "../engine/fixtures";

function buildRecord(fileName: string, outcome: DecisionOutcome, decision?: Decision): DecisionRecord {
  const stored = decision ?? buildDecision(fileName, outcome);
  return {
    fileName,
    status: deriveHistoryStatus(stored.outcome, null),
    invoice: buildInvoice({ id: fileName }),
    decision: stored,
    approval: null,
    extractionFailure: null,
  };
}

function expected(fileName: string, expectedOutcome: DecisionOutcome, expectedRuleIds: RuleId[] = []): ExpectedDecision {
  return { fileName, expectedOutcome, expectedRuleIds };
}

describe("computeMetrics", () => {
  it("counts a PAY where BLOCK or ESCALATE was expected as a leak", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "PAY"), buildRecord("dev/b.pdf", "PAY"), buildRecord("dev/c.pdf", "BLOCK")],
      [expected("dev/a.pdf", "BLOCK"), expected("dev/b.pdf", "PAY"), expected("dev/c.pdf", "ESCALATE")],
    );
    expect(metrics).toMatchObject({ total: 3, leaks: 1, leakFiles: ["dev/a.pdf"], accuracy: 1 / 3 });
  });

  it("measures autonomy and over-escalation only on invoices expected to be paid or blocked", () => {
    const metrics = computeMetrics(
      [
        buildRecord("dev/a.pdf", "PAY"),
        buildRecord("dev/b.pdf", "ESCALATE"),
        buildRecord("dev/c.pdf", "ESCALATE"),
        buildRecord("dev/d.pdf", "BLOCK"),
      ],
      [
        expected("dev/a.pdf", "PAY"),
        expected("dev/b.pdf", "BLOCK"),
        expected("dev/c.pdf", "ESCALATE"),
        expected("dev/d.pdf", "BLOCK"),
      ],
    );
    expect(metrics).toMatchObject({ accuracy: 3 / 4, autonomy: 2 / 3, overEscalation: 1 / 3, leaks: 0 });
  });

  it("lists expected files without a decision and leaves them out of every rate", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "BLOCK")],
      [expected("dev/a.pdf", "BLOCK"), expected("dev/b-copy.pdf", "BLOCK")],
    );
    expect(metrics).toMatchObject({ total: 1, missingFiles: ["dev/b-copy.pdf"], accuracy: 1 });
  });

  it("reports null rates when nothing was measured", () => {
    expect(computeMetrics([], [])).toEqual({
      total: 0,
      leaks: 0,
      leakFiles: [],
      missingFiles: [],
      accuracy: null,
      autonomy: null,
      overEscalation: null,
      explainability: null,
      ruleMatchRate: null,
    });
  });

  it("counts a decision as explained only if every failed rule shows its values and its message", () => {
    const unexplained = buildDecision("dev/u.pdf", "ESCALATE"); // fixture rules compare nothing
    const explained = buildDecision("dev/e.pdf", "ESCALATE");
    explained.ruleResults = explained.ruleResults.map((result) =>
      result.outcome === "PASS" ? result : { ...result, compared: { amountMinor: 250_000 } },
    );
    const metrics = computeMetrics(
      [buildRecord("dev/u.pdf", "ESCALATE", unexplained), buildRecord("dev/e.pdf", "ESCALATE", explained), buildRecord("dev/p.pdf", "PAY")],
      [expected("dev/u.pdf", "ESCALATE"), expected("dev/e.pdf", "ESCALATE"), expected("dev/p.pdf", "PAY")],
    );
    expect(metrics.explainability).toBe(2 / 3);
  });

  it("matches the rules that were expected to fire", () => {
    const metrics = computeMetrics(
      [buildRecord("dev/a.pdf", "ESCALATE"), buildRecord("dev/b.pdf", "ESCALATE")],
      [expected("dev/a.pdf", "ESCALATE", ["R5"]), expected("dev/b.pdf", "ESCALATE", ["R2"])],
    );
    expect(metrics.ruleMatchRate).toBe(1 / 2);
  });
});

describe("parseExpectedCsv", () => {
  it("reads every row, with an empty rule list when no rule must fire", () => {
    const text = "file,expected_outcome,expected_rules\ndev/01.pdf,PAY,\ndev/02.pdf,BLOCK,R2;R6\n";
    expect(parseExpectedCsv(text)).toEqual([
      { fileName: "dev/01.pdf", expectedOutcome: "PAY", expectedRuleIds: [] },
      { fileName: "dev/02.pdf", expectedOutcome: "BLOCK", expectedRuleIds: ["R2", "R6"] },
    ]);
  });

  it("reads a file saved by a spreadsheet: BOM, CRLF, spaces and trailing blank lines", () => {
    const text = "﻿file,expected_outcome,expected_rules\r\n dev/01.pdf , ESCALATE , R5 ; R7 \r\n\r\n";
    expect(parseExpectedCsv(text)).toEqual([
      { fileName: "dev/01.pdf", expectedOutcome: "ESCALATE", expectedRuleIds: ["R5", "R7"] },
    ]);
  });

  it("rejects a file listed twice", () => {
    const text = "file,expected_outcome,expected_rules\ndev/01.pdf,PAY,\ndev/01.pdf,BLOCK,R2\n";
    expect(() => parseExpectedCsv(text)).toThrow("dev/01.pdf");
  });

  it("rejects a wrong header, an unknown outcome and an extra field", () => {
    expect(() => parseExpectedCsv("archivo,decision\ndev/01.pdf,PAY\n")).toThrow("header");
    expect(() => parseExpectedCsv("file,expected_outcome,expected_rules\ndev/01.pdf,PAID,\n")).toThrow();
    expect(() => parseExpectedCsv("file,expected_outcome,expected_rules\ndev/01.pdf,PAY,R1,x\n")).toThrow("line 2");
  });

  it("returns no rows for an empty file", () => {
    expect(parseExpectedCsv("")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/pipeline/compute-metrics.test.ts`
Expected: FAIL with `Failed to resolve import "@/pipeline/compute-metrics"`.

- [ ] **Step 4: Implement the metrics**

`src/pipeline/compute-metrics.ts`:

```ts
import type { Decision, DecisionOutcome } from "@/contracts/decision";
import type { DecisionRecord } from "@/contracts/decision-record";
import {
  type ExpectedDecision,
  ExpectedDecisionSchema,
  type Metrics,
  MetricsSchema,
} from "@/contracts/metrics";

const EXPECTED_HEADER = "file,expected_outcome,expected_rules";
const AUTONOMOUS_OUTCOMES: readonly DecisionOutcome[] = ["PAY", "BLOCK"];

type Measured = { expected: ExpectedDecision; decision: Decision };

// data/expected.csv, written by hand by C. It tolerates what spreadsheets add (BOM, CRLF, blank lines,
// spaces). ponytail: plain comma split, since no field contains a comma; use a CSV parser if one ever
// needs quoting.
export function parseExpectedCsv(text: string): ExpectedDecision[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const [header, ...rows] = lines.filter((line) => line.trim() !== "");
  if (header === undefined) return [];
  if (header.replace(/\s/g, "") !== EXPECTED_HEADER) {
    throw new Error(`expected.csv header must be "${EXPECTED_HEADER}"`);
  }

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const [fileName = "", expectedOutcome, rules = "", ...extra] = row.split(",").map((field) => field.trim());
    if (extra.length > 0) throw new Error(`expected.csv line ${index + 2}: too many fields`);
    if (seen.has(fileName)) throw new Error(`expected.csv lists ${fileName} twice`);
    seen.add(fileName);
    return ExpectedDecisionSchema.parse({
      fileName,
      expectedOutcome,
      expectedRuleIds: rules === "" ? [] : rules.split(";").map((ruleId) => ruleId.trim()),
    });
  });
}

// The automatic decision against what C expected (PROPUESTA section 5): never the human approval.
// Expected files with no stored decision (for example a byte-identical resend, which returns the
// original record) are listed in missingFiles and left out of every rate.
export function computeMetrics(
  records: readonly DecisionRecord[],
  expected: readonly ExpectedDecision[],
): Metrics {
  const byFile = new Map(records.map((record) => [record.fileName, record.decision]));
  const measured: Measured[] = expected.flatMap((row) => {
    const decision = byFile.get(row.fileName);
    return decision === undefined ? [] : [{ expected: row, decision }];
  });
  const autonomous = measured.filter(({ expected: row }) => AUTONOMOUS_OUTCOMES.includes(row.expectedOutcome));
  const leakFiles = measured
    .filter(({ expected: row, decision }) => decision.outcome === "PAY" && row.expectedOutcome !== "PAY")
    .map(({ expected: row }) => row.fileName);

  return MetricsSchema.parse({
    total: measured.length,
    leaks: leakFiles.length,
    leakFiles,
    missingFiles: expected.filter((row) => !byFile.has(row.fileName)).map((row) => row.fileName),
    accuracy: rate(measured.filter(isCorrect).length, measured.length),
    autonomy: rate(autonomous.filter(isCorrect).length, autonomous.length),
    overEscalation: rate(
      autonomous.filter(({ decision }) => decision.outcome === "ESCALATE").length,
      autonomous.length,
    ),
    explainability: rate(measured.filter(({ decision }) => isExplained(decision)).length, measured.length),
    ruleMatchRate: rate(measured.filter(firesExpectedRules).length, measured.length),
  });
}

function rate(count: number, total: number): number | null {
  return total === 0 ? null : count / total;
}

function isCorrect({ expected: row, decision }: Measured): boolean {
  return decision.outcome === row.expectedOutcome;
}

// Explained when every rule that did not pass shows the values it compared, and its message is in the
// explanation a person reads.
function isExplained(decision: Decision): boolean {
  return decision.ruleResults
    .filter((result) => result.outcome !== "PASS")
    .every((result) => Object.keys(result.compared).length > 0 && decision.explanation.includes(result.message));
}

function firesExpectedRules({ expected: row, decision }: Measured): boolean {
  const fired = new Set(decision.ruleResults.filter((result) => result.outcome !== "PASS").map((result) => result.ruleId));
  return row.expectedRuleIds.every((ruleId) => fired.has(ruleId));
}
```

In `src/pipeline/dataset.ts`:
- add `import type { ExpectedDecision } from "@/contracts/metrics";`;
- add `import { parseExpectedCsv } from "./compute-metrics";`;
- append:

```ts
// data/expected.csv (C). A missing file only means there are no expected rows yet.
export async function readExpectedDecisions(dataDir = DATA_DIR): Promise<ExpectedDecision[]> {
  try {
    return parseExpectedCsv(await readFile(path.join(dataDir, "expected.csv"), "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
```

- [ ] **Step 5: Write the route**

`src/app/api/metrics/route.ts`:

```ts
import { connection } from "next/server";
import { computeMetrics } from "@/pipeline/compute-metrics";
import { readExpectedDecisions } from "@/pipeline/dataset";
import { getDb } from "@/store/db";
import { listDecisionRecords } from "@/store/decision-repository";

// The header of the app: autonomy, accuracy and leaks of the stored decisions against expected.csv.
export async function GET(): Promise<Response> {
  await connection();
  const records = await listDecisionRecords(await getDb());
  return Response.json(computeMetrics(records, await readExpectedDecisions()));
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/pipeline`
Expected: PASS.

- [ ] **Step 7: Checks and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run format:check`. If Prettier rewraps, run `npx prettier --write src/pipeline src/app/api tests/pipeline` and re-run.

```bash
git add src/pipeline src/app/api/metrics tests/pipeline/compute-metrics.test.ts
git commit -F - <<'EOF'
feat(pipeline): compute metrics against expected decisions

One formula for the app header and for C's eval: leaks, accuracy, autonomy,
over-escalation, explainability and expected rules, measured on the automatic
decision. Not in the planned commit list: E took the metrics formula so the
endpoint and the eval cannot disagree.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8: Ship.** Follow "How every task ends" step 3. In the PR, tag A (extra commit) and C, with the `eval.ts` composition from this task's Interfaces.

---

### Task 10: Eval in CI (commit 10: `ci: run lint, tests and eval on every push`)

**Gate:** `npm run | grep -w eval` lists C's script. If it does not, stop and tell the user this task waits for C.

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c ci/eval-step
```

- [ ] **Step 2: Check that eval passes locally without secrets**

Run: `env -u ANTHROPIC_API_KEY -u TURSO_DATABASE_URL npm run eval; echo "exit $?"`
Expected: metrics printed and `exit 0`, meaning 0 leaks. If it exits 1, stop: a leak is a bug to fix before anything else (PROPUESTA §7), and it belongs to its rule's owner.

- [ ] **Step 3: Add the step**

In `.github/workflows/ci.yml`, insert after `- run: npm test`:

```yaml
      - run: npm run eval
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -F - <<'EOF'
ci: run lint, tests and eval on every push

Eval runs from the committed extraction cache with an in-memory database and the
dataset clock, so it needs no secrets, and a single leak fails the build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Ship.** Follow "How every task ends" step 3, then watch the PR's CI run (`gh pr checks --watch`) and confirm the eval step is green.

---

### Task 11: Vercel deployment on Turso (commit 11: `chore: configure turso database for vercel deployment`)

**Gate:** the user has created `triple-firma-demo` in Turso and has access to the team's Vercel project. The dashboard steps are manual; ask the user to do them, or to confirm before you run any command against the shared database.

**Files:**
- Modify: `next.config.ts`

`@libsql/client` is already on Next's default `serverExternalPackages` list (`node_modules/next/dist/lib/server-external-packages.jsonc`), so it needs no config.

- [ ] **Step 1: Branch**

```bash
git switch main && git pull && git switch -c chore/vercel-turso
```

- [ ] **Step 2: Include the runtime data files in the serverless bundle**

In `next.config.ts`, add inside `nextConfig`, after `partialPrefetching: true,`:

```ts
  // Files the API reads at runtime, which file tracing cannot see: the expected decisions for
  // /api/metrics, and the extraction cache, so the deploy decides known invoices without an API key.
  outputFileTracingIncludes: {
    "/api/metrics": ["./data/expected.csv"],
    "/api/invoices": ["./data/cache/**/*.json"],
  },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: green, with no database access during the build.

- [ ] **Step 4: Commit**

```bash
git add next.config.ts
git commit -F - <<'EOF'
chore: configure turso database for vercel deployment

Bundles expected.csv and the extraction cache with the routes that read them.
The deploy has no API key, so an unknown invoice escalates by fail-safe.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 5: Ship, then deploy (user-confirmed, manual)**

After the user's OK, follow "How every task ends" step 3. After merge:
1. In Vercel, set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for `triple-firma-demo`. Set no `ANTHROPIC_API_KEY`.
2. Seed it from a local env file that the user creates, for example `.env.demo` (it matches `.env*` in `.gitignore`, so it is never committed): `npx tsx --env-file=.env.demo scripts/demo.ts`.
3. Open the Vercel URL, approve one escalation, reload, and check that it stays approved.

---

### Task 12: README (commit 12: `docs: add readme with setup, deploy steps and metrics`)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Branch and collect the numbers**

```bash
git switch main && git pull && git switch -c docs/readme
env -u ANTHROPIC_API_KEY npm run eval
```

Keep the printed metrics; they fill the "Métricas" table below.

- [ ] **Step 2: Update the status line**

Replace the line `> **Estado:** esqueleto del proyecto. Los módulos se están construyendo. La propuesta completa está en [docs/PROPUESTA.md](docs/PROPUESTA.md).` with:

```markdown
> La propuesta completa está en [docs/PROPUESTA.md](docs/PROPUESTA.md).
```

- [ ] **Step 3: Add the demo, metrics, API and deploy sections**

Insert after the "Comandos" section, before "Estructura". In the table, replace each `<…>` with the value printed by `npm run eval` in Step 1. The date and commit are `git log -1 --format='%cs %h'`.

````markdown
## Demo

| Comando               | Qué hace                                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run demo`        | Reinicia **tu** base de Turso, carga las reglas de Andes Labs y decide `dev/` y `adversarial/` desde la caché, sin API key ni tokens. Luego abre la app en http://localhost:3000 |
| `npm run demo:live`   | Igual, pero si una factura no está en caché la lee con el modelo (requiere `ANTHROPIC_API_KEY`) y guarda la lectura en `data/cache/`                                                        |
| `npm run demo:tamper` | Altera una entrada del registro directamente en la base, como podría hacerlo alguien con acceso a ella. El botón **Verificar integridad** la detecta                                           |
| `npm run eval`        | Mide las decisiones contra `data/expected.csv` y termina con error si hay una sola fuga                                                                                                     |

Todas las facturas del set se deciden con el mismo reloj fijo (`DATASET_NOW`), así que el resultado no depende del día en que se corra.

## Métricas

Última corrida de `npm run eval` (<fecha> · <commit>):

| Métrica                                                | Valor                    |
| ------------------------------------------------------ | ------------------------ |
| Facturas evaluadas                                     | <total> (<adversariales> adversariales) |
| **Fugas** (pagó cuando debía frenar o escalar)         | **<leaks>**              |
| Exactitud                                              | <accuracy>               |
| Autonomía (decide solo lo que debe pagar o frenar)     | <autonomy>               |
| Sobreescalación                                        | <overEscalation>         |
| Explicabilidad (cada regla cita sus valores)           | <explainability>         |

## API

| Método | Ruta                            | Para qué                                                    |
| ------ | ------------------------------- | ----------------------------------------------------------- |
| `POST` | `/api/invoices`                 | Subir una factura (campo `file`: PDF, imagen, `.eml`, `.txt`) |
| `GET`  | `/api/invoices/[id]/file`       | Ver el documento original                                   |
| `GET`  | `/api/decisions?status=…`       | Listar decisiones (`PENDING_APPROVAL` = bandeja)            |
| `GET`  | `/api/decisions/[id]`           | Detalle: datos extraídos, reglas, explicación y aprobación  |
| `GET`  | `/api/config` · `PUT`           | Leer o guardar las reglas (cada cambio es una versión nueva) |
| `POST` | `/api/approvals/[decisionId]`   | Aprobar o rechazar con `{ action, approver, comment }`      |
| `GET`  | `/api/audit/verify`             | Verificar la cadena de hashes del registro                  |
| `GET`  | `/api/metrics`                  | Métricas contra `data/expected.csv`                         |

## Deploy (Vercel + Turso)

1. Crea la base de la demo: `turso db create triple-firma-demo`, y copia su URL y un token.
2. Importa el repo en Vercel y agrega `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. **No** agregues `ANTHROPIC_API_KEY`: la URL pública funciona desde la caché, y una factura nueva se escala por seguridad.
3. Carga la base desde tu máquina con esas variables en un archivo `.env.demo` (no se sube al repo): `npx tsx --env-file=.env.demo scripts/demo.ts`.
4. Abre la URL, aprueba una escalada, recarga y comprueba que sigue aprobada.

## Plan B sin internet

Con `TURSO_DATABASE_URL=file:local.db` en `.env.local`, `npm run demo` funciona igual con un archivo local, sin red.
````

Also add these rows to the existing "Comandos" table:

```markdown
| `npm run demo`      | Carga el set de facturas y abre la app (ver "Demo")      |
| `npm run eval`      | Métricas y chequeo de fugas                              |
```

- [ ] **Step 4: Format and check**

Run: `npx prettier --write README.md && npm run format:check`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -F - <<'EOF'
docs: add readme with setup, deploy steps and metrics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6: Ship.** Follow "How every task ends" step 3. Before the final delivery (PROPUESTA §7, Saturday 10 pm to midnight), run `npm run demo` from a clean clone (`git clone <repo> /tmp/clean && cd /tmp/clean && npm ci && cp .env.example .env.local`, with your Turso values) to confirm it works from scratch.
