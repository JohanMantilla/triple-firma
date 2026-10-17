# Role E: store, pipeline, API and demo (PRD + design spec)

Owner: E (backend, persistence and demo). Status: draft for team review. Date: 2026-10-17.
Source of truth for rules and conventions: `CLAUDE.md` and `docs/PROPUESTA.md` (sections 3, 6 and 7).

---

## Part 1: PRD

### Problem

Contracts and most of the engine are on `main`: R1, R3, R4, R5, R6, R8 and R9 are real, and R2, R7 and R10 are fail-safe placeholders. B's extraction is on `origin/feat/extraction-module`. The modules E owns are still empty: `src/store/`, `src/pipeline/`, `src/app/api/` (only `/health`), the demo scripts and the CI eval step.

Without them:
- no invoice reaches the engine and nothing is persisted;
- D's UI has no real API;
- there is no `npm run demo`;
- the Saturday 1 pm end-to-end milestone (10 real invoices) cannot happen.

### Users

| User | Needs from E |
|---|---|
| Finance operator | Upload an invoice and see PAY / BLOCK / ESCALATE with its explanation in seconds |
| Approver | An inbox of pending escalations; approve or reject with a comment; approving revalidates |
| Jury | `npm run demo` from a clean clone, with no API key (extractions come from the cache); a tamper demo that the integrity check detects |
| D (frontend) | A stable HTTP API whose responses are `contracts/` schemas, so mocks and real data match |
| C (data and eval) | Reusable pipeline functions and one metrics formula for `npm run eval` |
| A, B | A pipeline that calls their functions exactly as agreed and never bypasses them |

### Goals

1. Persist every invoice, decision, approval and config version in Turso (libSQL), in development, in the demo and on deploy.
2. Orchestrate one invoice end to end: hash → extraction (B) → engine (A) → decision plus audit entry, idempotent by file hash.
3. Resolve escalations through A's revalidation, with no budget race and no double approval.
4. Keep an append-only audit log with a SHA-256 hash chain and a verification endpoint.
5. Expose the PROPUESTA API to D.
6. Ship `npm run demo`, `demo:live` and `demo:tamper`, and the metrics shared with C's eval.

### Non-goals

- Any business decision in E's code. Only `evaluateRules` decides, and only `revalidateApproval` decides an approval outcome.
- Real authentication: the approver types a name, as PROPUESTA §6.1 states.
- Fraud detection, compliance or identity verification (invariant 10).
- A batch HTTP endpoint (`/api/invoices/batch`): the demo script loads the sets. Add it only if D needs a button.
- An audit log viewer endpoint: the UI shows the verification result and the last hash only.
- The MCP server. It is P2 and the first thing cut.

### Success metrics

- 0 leaks: E's code paths can never produce PAY on their own, and `npm run eval` fails CI on any leak.
- `npm run demo` works from a clean clone with no API key: it needs only the developer's Turso credentials. With no network, the same command runs against a local file (Plan B, see "Database: Turso everywhere").
- Reprocessing the same file returns the same decision and writes no second audit entry.
- `npm run demo:tamper` is detected by `GET /api/audit/verify`.
- `npm run lint`, `typecheck`, `test` and `build` stay green on every PR.

### Requirements by priority

| Priority | Requirement |
|---|---|
| P0 | libSQL schema and repositories; append-only audit log with hash chain (the contract already requires `hash`) |
| P0 | `processInvoice`, `resolveApproval`, `saveRulesConfig` |
| P0 | Endpoints: invoices, decisions, config, approvals, audit verify, metrics |
| P0 | `npm run demo` and `npm run demo:live` |
| P1 | `npm run demo:tamper`; CI runs `npm run eval`; final README (Spanish); original file endpoint for the document viewer |
| P2 | Vercel + Turso deploy; MCP server |

---

## Part 2: Design

### Decisions taken

| Topic | Decision |
|---|---|
| Spec scope | P0 and P1 in detail, P2 one line each |
| Metrics formula | E owns `computeMetrics` in `src/pipeline/`; C's `scripts/eval.ts` reuses it |
| Clock | Batch, demo, eval and CI use a fixed `DATASET_NOW` agreed with C; UI uploads use the real clock |
| Approval revalidation | A ships a fail-safe `revalidateApproval` placeholder now; E integrates against its signature |
| Storage model | Contract documents in rows (see below) |
| Database | Turso in every environment that runs the app: one database per developer, plus a shared `triple-firma-demo` for the presentation and Vercel. Tests and eval use in-memory libSQL. |

### Storage approach

1. **Contract documents in rows (chosen).** Each row stores the validated contract object as JSON, and has columns only where the database must enforce something: `file_hash UNIQUE`, `invoice_id UNIQUE`, one approval per decision. Every read goes back through `<Name>Schema.parse`. It is little code, and it survives contract changes: `issueDate` landed as `feat(contracts)!` and needs no migration here.
2. Fully normalized columns. Rejected: about 30 snake_case columns, and a migration on every contract change.
3. Event sourcing with the audit log as the only state. Rejected: approvals and history become replays, too much for the time budget.

### Database: Turso everywhere

**Why:** development runs on the same database engine and network path as the deploy. Remote transactions, latency and auth problems show up from the first day, not on Saturday at 1 pm. Seeding the demo database is just `npm run demo` with that database's credentials.

**One database per developer.** `npm run demo` resets the database in `TURSO_DATABASE_URL`. A shared development database would let one person's demo wipe everyone else's data.

| Database | Used by | Reset by |
|---|---|---|
| `triple-firma-<name>` | each developer running the backend (`npm run dev`, `npm run demo`) | its owner, with `npm run demo` |
| `triple-firma-demo` | the presentation and Vercel | E only, with `npm run demo` pointed at it |
| `:memory:` | `npm test` and `npm run eval` (local and CI) | every run starts empty |

Tests and eval stay in memory: CI then needs no secrets and no network, and every run starts from an empty database.

**Developer setup** (E documents it in the README, in Spanish):
1. Install the Turso CLI and log in.
2. Create the database: `turso db create triple-firma-<name>`.
3. Put `turso db show triple-firma-<name> --url` in `TURSO_DATABASE_URL`, and `turso db tokens create triple-firma-<name>` in `TURSO_AUTH_TOKEN`, both in `.env.local`.

D works with mocks (`NEXT_PUBLIC_USE_MOCK_API=true`), so D needs Turso only to try the real API.

**Configuration:**
- `.env.example` leaves `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` empty, with a comment pointing to the README.
- `openDb()` with no URL and no `TURSO_DATABASE_URL` throws `TURSO_DATABASE_URL is not set: see README`. There is no silent fallback to a local file.
- The `next build` in CI runs without these variables. It never opens the database, because every `GET` handler calls `connection()` first and `getDb()` is only called at request time.

**Plan B, offline:** `TURSO_DATABASE_URL=file:local.db` still works with no code change, because `@libsql/client` takes both URL kinds. It is the fallback if Turso or the network fails during the presentation (PROPUESTA §6.1, Plan B).

**Remote transactions:**
- `transaction("write")` on Turso opens an interactive transaction over a WebSocket. The server queues concurrent write transactions, so they still run one at a time.
- Each statement is one network round trip. Transactions only contain short reads and writes; the LLM call always runs before the transaction opens.
- A sequential batch of about 36 invoices takes seconds, not minutes. That is acceptable for `npm run demo`.

### Module map

```
src/store/db.ts                   openDb(url?) -> Client, getDb(), resetDb(db)
src/store/schema.ts               SCHEMA: SQL string constant (bundle-safe, no fs path)
src/store/config-repository.ts    findCurrentRulesConfig, insertRulesConfig
src/store/invoice-repository.ts   insertInvoice, findInvoiceFile
src/store/decision-repository.ts  insertDecision, findDecisionByFileHash, findDecisionRecord,
                                  listDecisionRecords, listHistoryEntries
src/store/approval-repository.ts  insertApproval
src/store/audit-log.ts            appendAuditEntry, verifyAuditChain
src/pipeline/process-invoice.ts   processInvoice, detectSourceFormat
src/pipeline/resolve-approval.ts  resolveApproval
src/pipeline/save-rules-config.ts saveRulesConfig
src/pipeline/dataset.ts           DATASET_NOW, INVOICE_SETS, readCompanyConfig, processInvoiceSet
src/pipeline/compute-metrics.ts   parseExpectedCsv, computeMetrics
src/app/api/invoices/route.ts                POST
src/app/api/invoices/[id]/file/route.ts      GET (P1)
src/app/api/decisions/route.ts               GET
src/app/api/decisions/[id]/route.ts          GET
src/app/api/config/route.ts                  GET, PUT
src/app/api/approvals/[decisionId]/route.ts  POST
src/app/api/audit/verify/route.ts            GET
src/app/api/metrics/route.ts                 GET
scripts/demo.ts                   npm run demo, npm run demo:live
scripts/demo-tamper.ts            npm run demo:tamper
```

The dependency rule in `eslint.config.mjs` already allows this layout:
- store imports only `contracts/` and `@libsql/client`;
- pipeline imports engine, extraction and store;
- routes import pipeline, store (read) and contracts;
- `toPeriod` is taken from `src/engine/rule-context.ts` by the pipeline, never by the store.

Two conventions:
- **Repositories** take an executor as their first parameter: `Pick<Transaction, "execute">`, which both `Client` and `Transaction` satisfy. The same function then works inside or outside a transaction.
- **Pipeline functions** take `db: Client` and an explicit `now: string`. These are plain parameters, not a DI framework. Tests open `openDb(":memory:")`, and they never touch the client while a transaction is open (an in-memory database has a single connection).

### Contracts to add (additive PR, A approves; glossary rows in the same PR)

| File | Schema | Shape |
|---|---|---|
| `decision-record.ts` | `DecisionRecordSchema` | `{ fileName: string, status: HistoryEntryStatus, invoice: Invoice, decision: Decision, approval: Approval \| null, extractionFailure: string \| null }` |
| `metrics.ts` | `ExpectedDecisionSchema` | `{ fileName, expectedOutcome: DecisionOutcome, expectedRuleIds: RuleId[] }`: one row of `data/expected.csv` |
| `metrics.ts` | `MetricsSchema` | `{ total, leaks, leakFiles: string[], missingFiles: string[], accuracy, autonomy, overEscalation, explainability, ruleMatchRate }`. Counts are non-negative ints; rates are `number` in [0, 1], or `null` when the denominator is 0 |
| `audit-entry.ts` | `AuditVerificationSchema` | `{ isValid: boolean, entryCount: int, firstInvalidSeq: int \| null, lastHash: string \| null }`. `firstInvalidSeq` is the position of the first bad entry; `lastHash` is a plain string because a tampered row may hold anything |
| `rules-config.ts` | `RulesConfigVersionSchema` | `{ version: positive int, config: RulesConfig, createdAt: IsoDateTime }` |
| `api-error.ts` | `ApiErrorCodeSchema`, `ApiErrorSchema` | `{ error: ApiErrorCode, issues?: { path: string, message: string }[] }`. `ApiErrorCode` is `INVALID_REQUEST`, `MISSING_FILE`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `EMPTY_SOURCE_TEXT`, `SOURCE_TEXT_TOO_LONG`, `NO_RULES_CONFIG`, `NOT_FOUND`, `NOT_ESCALATED` or `ALREADY_RESOLVED`. The API sends codes, never user-facing text; D translates them into Spanish |
| `decision-record.ts` | `deriveHistoryStatus(outcome, approval)` | The status table below, as one pure function shared by the store, the record schema and the API |

New glossary rows:
- `fileName`, UI "Archivo": the file name as received; for the dataset it is `<set>/<name>`.
- `DecisionRecord`, UI "Decisión": a decision with its invoice, approval and status.
- `Metrics`, UI "Métricas".

### Data model (libSQL, 5 tables)

The `extractions` table from PROPUESTA §6.2 is dropped: it is 1:1 with `invoices`, so the extraction lives inside `invoice_json`.

```sql
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
  invoice_json TEXT NOT NULL,          -- Invoice contract, including extraction and sourceText
  extraction_failure TEXT              -- B's `reason` when extraction returned ok: false
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id),
  period TEXT NOT NULL,                -- toPeriod(decidedAt, config.timezone)
  decision_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  decision_id TEXT PRIMARY KEY REFERENCES decisions(id),   -- one resolution per decision
  period TEXT NOT NULL,                -- toPeriod(resolvedAt, config.timezone)
  approval_json TEXT NOT NULL
);
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

- **`openDb(url = TURSO_DATABASE_URL)`** throws when no URL is given (see "Database: Turso everywhere"). It creates the client with `authToken: TURSO_AUTH_TOKEN` and `timeout: 5000`. The timeout applies only to the `file:` fallback, where it is the busy timeout: without it, a second write transaction fails at once with `SQLITE_BUSY` instead of waiting. Turso ignores it. It then runs `SCHEMA` with `executeMultiple`, which is idempotent.
- **`getDb()`** memoizes `openDb()` on `globalThis`, so dev hot reload does not open a client per reload.
- **`resetDb(db)`** drops the triggers and tables and re-runs `SCHEMA`. It works the same on Turso and on the `file:` fallback.
- **Invoice ids** are `randomUUID()`. Decision ids are created by the engine (`decision-<invoiceId>`).

### History and status

`listHistoryEntries(executor)` reads every decision joined with its invoice and its approval, if any. Each row becomes a `HistoryEntry`, validated with `HistoryEntrySchema.parse`. The history covers all periods, because R2 needs past months; the engine filters by period or window itself.

| `decision.outcome` | Approval | `status` | `period` and `decidedAt` from |
|---|---|---|---|
| `PAY` | — | `PAYABLE` | decision |
| `BLOCK` | — | `BLOCKED` | decision |
| `ESCALATE` | none | `PENDING_APPROVAL` | decision |
| `ESCALATE` | `REJECT` | `REJECTED` | decision |
| `ESCALATE` | `APPROVE`, resulting in `PAY` | `PAYABLE` | approval (`period`, `resolvedAt`) |
| `ESCALATE` | `APPROVE`, resulting in `BLOCK` | `BLOCKED` | decision |

Field mapping:
- **Money** (`amountMinor`, `currency`, `exchangeRate`, `baseAmountMinor`) is always the stored decision's values.
- **`payee` and `reference`** are the extraction value, or `null` when the field `isUncertain`. Money already gets the same treatment in `rule-context.ts`. A must confirm this mapping for R2.

`DecisionRecord.status` comes from the same function, so the API and the engine never disagree on what "pending" means.

### Flow: process an invoice

`processInvoice(db, { fileName, fileBuffer, sourceFormat }, now)` returns one of:
- `{ ok: true, record: DecisionRecord, isResubmission: boolean }`;
- `{ ok: false, reason: "NO_RULES_CONFIG" | "EMPTY_SOURCE_TEXT" | "SOURCE_TEXT_TOO_LONG" }`.

Steps:

1. Compute `fileHash = sha256(fileBuffer)` (hex, `node:crypto`). If `findDecisionByFileHash` finds a record, return it with `isResubmission: true`. No audit entry is written.
2. For `EMAIL` and `CHAT`, set `sourceText = fileBuffer.toString("utf8")`. Blank text gives `EMPTY_SOURCE_TEXT`; over 200,000 characters (the `InvoiceSchema` limit) gives `SOURCE_TEXT_TOO_LONG`. Other formats get `null`.
   - Ceiling: `.eml` files are read as raw text, without MIME decoding (`ponytail:` comment). Fine for the fictitious dataset; decode if real emails arrive.
3. **Outside any transaction**, call B's `extractInvoice({ fileHash, fileBuffer, sourceFormat, sourceText })` (signature on `origin/feat/extraction-module`).
   - It never throws and reads the cache first.
   - It returns `{ ok: true, extraction, cached }` or `{ ok: false, extraction, reason }`; the extraction is all-uncertain on failure.
   - The LLM call must not hold the database write lock.
4. Build `invoice = InvoiceSchema.parse({ id: randomUUID(), fileHash, sourceFormat, sourceText, receivedAt: now, extraction })`.
5. Open a write transaction through `withWriteTransaction` (`src/store/db.ts`). It starts with `BEGIN IMMEDIATE`, and the same helper also queues write transactions inside the process. A local file blocks the event loop while it waits for a lock held by the same process, so two concurrent writes would end in `SQLITE_BUSY` without that queue. Turso queues writers across processes on its own.
   1. Re-check `findDecisionByFileHash`. Two concurrent uploads of the same file end with one decision, and the second gets `isResubmission: true`.
   2. `findCurrentRulesConfig`: none gives rollback and `NO_RULES_CONFIG`. Then `listHistoryEntries`.
   3. `decision = evaluateRules({ invoice, config, history, now, configVersion })`.
   4. `period = toPeriod(now, config.timezone)`.
   5. `insertInvoice`, `insertDecision`, then `appendAuditEntry(DECISION)`.
   6. Commit. On any error: rollback and rethrow; Next answers 500. Nothing is stored.

This fixes the race in PROPUESTA §6.2 step 5. History is read inside the same write transaction that stores the decision, so two concurrent invoices cannot both see the same remaining budget.

`detectSourceFormat(fileName)` checks the lowercase extension:

| Extension | Format |
|---|---|
| `.pdf` | `PDF` |
| `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` | `IMAGE` |
| `.eml` | `EMAIL` |
| `.txt` | `CHAT` |
| anything else | `null` |

### Flow: resolve an approval

`resolveApproval(db, decisionId, request: ApprovalRequest, now)` returns:
- `{ ok: true, record: DecisionRecord }`, or
- `{ ok: false, reason: "NOT_FOUND" | "NOT_ESCALATED" | "ALREADY_RESOLVED" }`.

Everything runs in one `db.transaction("write")`:

1. **Checks.** `findDecisionRecord(tx, decisionId)` returns `NOT_FOUND` if there is no such decision, `NOT_ESCALATED` if the outcome is not `ESCALATE`, and `ALREADY_RESOLVED` if an approval already exists. The `approvals` primary key backs this check if two requests race.
2. **Config.** Load `config = findCurrentRulesConfig(tx)`. It always exists when a decision exists; the time zone is needed for `period`.
3. **Outcome.**
   - `REJECT`: `resultingOutcome: "BLOCK"`, `revalidationResults: []`.
   - `APPROVE`: `{ resultingOutcome, revalidationResults } = revalidateApproval({ invoice, decision, config, history: listHistoryEntries(tx), now })`, from A's engine.
4. **Build.** `approval = ApprovalSchema.parse({ ...request, decisionId, resultingOutcome, revalidationResults, amountMinor, currency, exchangeRate, baseAmountMinor, resolvedAt: now })`. The four money fields are copied from the stored decision and never recomputed (invariant 8).
5. **Store.** `insertApproval(tx, approval, toPeriod(now, config.timezone))`, then `appendAuditEntry(APPROVAL)`, then commit.

The history passed to the engine is complete, including this invoice's own pending entry:
- R6 at approval reserves nothing (`checkBudget` with `isReservingPending: false`).
- R2 at approval must ignore the entry with the same `invoiceId` (agreement with A).

### Flow: save the rules

`saveRulesConfig(db, config, now)` runs in one write transaction:
- `insertRulesConfig` assigns the next `version`;
- `appendAuditEntry(RULES_CONFIG_CHANGE, { version, config })`.

It returns a `RulesConfigVersion`. The caller (route or script) has already validated the config with `RulesConfigSchema.parse`.

### Audit log

- **Hash:** `hash = sha256(canonicalJson({ seq, type, payload, prevHash, createdAt }))`. `canonicalJson` is `JSON.stringify` with object keys sorted recursively (about 10 lines in `audit-log.ts`).
- **`appendAuditEntry(tx, type, payload, createdAt)`** must run inside the caller's write transaction. It reads the last `seq` and `hash`, inserts `seq + 1` with `prev_hash` equal to the last hash (`null` for seq 1), and returns `AuditEntrySchema.parse(entry)`.
- **Payloads:**

  | Type | Payload |
  |---|---|
  | `DECISION` | `{ invoiceId, fileHash, fileName, sourceFormat, extraction, extractionFailure, decision }` |
  | `APPROVAL` | `{ approval }` |
  | `RULES_CONFIG_CHANGE` | `{ version, config }` |

  `sourceText` is left out because of its size. The rule results, the compared values, the explanation and the evidence are in the payload, so the log alone explains every decision.
- **`verifyAuditChain(executor)`** reads entries by `seq` and stops at the first failure. Each entry must have:
  - `seq` equal to its position, starting at 1;
  - `prev_hash` equal to the previous entry's `hash`;
  - a `hash` that recomputes.

  It returns an `AuditVerification`. Its `lastHash` is the anchor the UI shows (PROPUESTA §10).
- **Known ceiling:** the chain protects `audit_entries` only. Editing `decisions` directly is not detected, and whoever controls the database can recompute the whole chain. We say so in the pitch, as PROPUESTA §10 already does.

### API

All handlers are thin: they parse the input with a contract schema, call the pipeline (writes) or the store (reads), and map each `reason` to a status. Every error body is an `ApiError`.

Every `GET` handler starts with `await connection()` from `next/server`. Because `cacheComponents: true` is on, Next would otherwise try to prerender the handler at build time (see `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`). Routes compute `now` with `new Date().toISOString()`.

| Method · route | Input | Success | Errors |
|---|---|---|---|
| `POST /api/invoices` | `multipart/form-data`, field `file` | 201 `DecisionRecord`; 200 when `isResubmission` | 400 missing file, unsupported extension or `EMPTY_SOURCE_TEXT`; 413 file over 10 MB or `SOURCE_TEXT_TOO_LONG`; 409 `NO_RULES_CONFIG` |
| `GET /api/decisions` | optional `?status=PAYABLE\|PENDING_APPROVAL\|REJECTED\|BLOCKED` | 200 `DecisionRecord[]`, newest first (`decisions.rowid DESC`) | 400 invalid status |
| `GET /api/decisions/[id]` | — | 200 `DecisionRecord` | 404 |
| `GET /api/config` | — | 200 `RulesConfigVersion` (current) | 404 none |
| `PUT /api/config` | `RulesConfig` JSON | 200 `RulesConfigVersion` | 400 with `issues` from `RulesConfigSchema.safeParse` |
| `POST /api/approvals/[decisionId]` | `ApprovalRequest` JSON | 200 updated `DecisionRecord` | 400 invalid body; 404 `NOT_FOUND`; 409 `NOT_ESCALATED` or `ALREADY_RESOLVED` |
| `GET /api/audit/verify` | — | 200 `AuditVerification` | — |
| `GET /api/metrics` | — | 200 `Metrics` | — |
| `GET /api/invoices/[id]/file` (P1) | — | 200 original bytes, `Content-Type` by format | 404 |

Notes for D:
- One response shape (`DecisionRecord`) covers the list, the detail, the upload and the approval.
- The inbox is the list filtered by `status === "PENDING_APPROVAL"`, sorted by `invoice.extraction.dueDate.value` on the client.
- The api-client needs an `uploadInvoice` function. PROPUESTA §6.2's list does not have it.

### Metrics

`src/pipeline/compute-metrics.ts` is pure, so `/api/metrics` and C's `scripts/eval.ts` share one formula.

**Input: `data/expected.csv`.** It has the header `file,expected_outcome,expected_rules`. Example row: `dev/03-duplicate.pdf,BLOCK,R2`.
- `expected_rules` lists rule ids separated by `;`, and may be empty.
- `parseExpectedCsv` splits on newlines and plain commas, so no field may contain a comma (`ponytail:` ceiling; switch to a CSV parser if C needs quoting).
- Invalid outcomes or rule ids throw.
- `/api/metrics` reads the file with `node:fs`. A missing file gives zero rows.

**`computeMetrics(records, expectedRows)`** matches rows to records on `fileName`. It always uses `decision.outcome`, the automatic decision, never the approval.

| Field | Definition |
|---|---|
| `total` | expected rows that have a decision |
| `missingFiles` | expected rows with no decision. A byte-identical resend returns the original record and stores no new one, so its own row shows here: C leaves such resends out of `expected.csv` (idempotency is shown live and covered by tests) |
| `leaks`, `leakFiles` | outcome `PAY` while expected is not `PAY` |
| `accuracy` | outcome equals expected, over `total` |
| `autonomy` | correct among rows expected `PAY` or `BLOCK`, over the count of those rows |
| `overEscalation` | `ESCALATE` among rows expected `PAY` or `BLOCK`, over the count of those rows |
| `explainability` | decisions where every non-PASS rule result has a non-empty `compared` and its `message` appears in `explanation`, over `total` |
| `ruleMatchRate` | rows whose expected rules are all non-PASS in the decision, over `total` |

A rate is `null` when its denominator is 0.

### Dataset, clock and scripts

- **`DATASET_NOW`** is exported from `src/pipeline/dataset.ts`. Its value is agreed with C, for example `2026-10-15T15:00:00Z`, and it must fall in the same month as the presentation, so live uploads (real clock) share the dataset's budget period. Demo, eval and CI pass it as `now`.
- **`INVOICE_SETS`** is `["dev", "adversarial", "holdout"]`. `holdout` is only run by C, after the freeze.
- **`readCompanyConfig()`** reads `data/config/company.json` (C) and returns it through `RulesConfigSchema.parse`.
- **`processInvoiceSet(db, set, now)`** processes `data/invoices/<set>/`:
  1. lists the files and keeps those `detectSourceFormat` recognizes;
  2. sorts them by name with the default `Array.prototype.sort`, which is deterministic;
  3. calls `processInvoice` **sequentially** with `fileName = "<set>/<name>"`;
  4. returns `{ fileName, result }[]`.

  Order matters: duplicates and the budget depend on it.

`package.json` scripts. `tsx` passes the Node 24 flag `--env-file-if-exists` through, so scripts read `.env.local` the way `next dev` does:

```json
"demo": "tsx --env-file-if-exists=.env.local scripts/demo.ts && next dev",
"demo:live": "tsx --env-file-if-exists=.env.local scripts/demo.ts --live && next dev",
"demo:tamper": "tsx --env-file-if-exists=.env.local scripts/demo-tamper.ts"
```

**`scripts/demo.ts`:**
1. Without `--live`, run `delete process.env.ANTHROPIC_API_KEY`. A cache miss then becomes an uncertain extraction (and escalates) instead of spending tokens. The Anthropic client is only created on a cache miss, so cached invoices are unaffected.
2. `openDb()`, then `resetDb`. This resets the database in `TURSO_DATABASE_URL`, so it must be your own (or `triple-firma-demo`, for E only).
3. `saveRulesConfig(readCompanyConfig(), DATASET_NOW)`.
4. `processInvoiceSet` for `dev`, then `adversarial`, printing one line per file: file name, outcome, and whether it came from cache or failed.
5. Print the PAY / BLOCK / ESCALATE counts and the `verifyAuditChain` result, then the URL `http://localhost:3000`. The browser is not opened automatically: there is no single cross-platform way.

**`--live` (`npm run demo:live`)** keeps the key. B's extractor reads through the cache: on a miss it calls the model and writes `data/cache/<sha256>.json`. Those files are committed, so everyone else can run `npm run demo` without an API key. To force a fresh read, delete the cache file.

**`scripts/demo-tamper.ts`:**
1. Drop the `audit_entries_no_update` trigger.
2. Find the first `DECISION` entry whose payload outcome is `BLOCK`, and set it to `PAY` with `json_set`.
3. Re-run `SCHEMA`, which recreates the trigger.
4. Print the altered `seq`. The "Verificar integridad" button then reports it.

**CI:** once C merges `scripts/eval.ts`, add `- run: npm run eval` to `.github/workflows/ci.yml`. There is no API key in CI, so eval runs from the cache, and it fails the job on any leak.

**`scripts/eval.ts` (C)** composes:
1. `openDb(":memory:")`;
2. `saveRulesConfig(readCompanyConfig(), DATASET_NOW)`;
3. `processInvoiceSet` for `dev` and `adversarial`;
4. `listDecisionRecords`;
5. `computeMetrics(records, parseExpectedCsv(...))`;
6. print the metrics, and `process.exit(1)` when `leaks > 0`.

### Fail-safe and error handling

- E's code never decides: decisions come only from `evaluateRules`, and approval outcomes only from `revalidateApproval`. An unexpected error rolls the transaction back and stores nothing. Nothing is paid.
- Extraction failures are B's typed result: an all-uncertain extraction that R1 escalates. Its `reason` is stored in `extraction_failure` and in the audit payload.
- Expected failures are typed `{ ok: false, reason }` results; routes map them to 400, 404 or 409. Unexpected errors are not caught: Next logs them and answers 500, and the error is never swallowed.
- Every object is validated with its contract when written (`<Name>Schema.parse` before insert) and when read (`parse` after `JSON.parse`).

### Testing

Tests live in `tests/store/` and `tests/pipeline/`, each with a fresh `openDb(":memory:")`.

| File | Covers |
|---|---|
| `tests/store/audit-log.test.ts` | append three and verify; edit a payload (after dropping the trigger) → `isValid: false` with the right `firstInvalidSeq`; `UPDATE` and `DELETE` rejected by the triggers |
| `tests/store/decision-repository.test.ts` | every row of the status table; period and `decidedAt` taken from the approval when approved and paid; uncertain payee or reference → `null` |
| `tests/pipeline/process-invoice.test.ts` | `vi.mock("@/extraction/extract-invoice")`; a resubmission returns the same record and writes exactly one audit entry; `NO_RULES_CONFIG`; `EMPTY_SOURCE_TEXT`; `detectSourceFormat` table |
| `tests/pipeline/resolve-approval.test.ts` | not found, not escalated, already resolved; reject → `REJECTED`; after a config rate change, approve keeps the stored `exchangeRate` and `baseAmountMinor` |
| `tests/pipeline/compute-metrics.test.ts` | a PAY where BLOCK was expected counts as a leak; autonomy and over-escalation denominators; `null` rates on empty input; CSV parse errors throw |

Route handlers stay thin and are checked manually with `curl` (see Verification).

### Cross-team agreements (checklist)

- [ ] **A**: approve the additive contracts PR and the glossary rows above.
- [ ] **A**: ship `revalidateApproval({ invoice, decision, config, history, now }) → { resultingOutcome: "PAY" | "BLOCK", revalidationResults: RuleResult[] }` now. For the placeholder, R2 escalates, so approving ends in BLOCK until the real rule lands.
- [ ] **A**: at approval, R2 ignores the history entry with the same `invoiceId`; confirm that uncertain payee and reference map to `null` in history.
- [ ] **B**: merge `feat/extraction-module` before E's pipeline PR; keep the `extractInvoice` signature from that branch.
- [ ] **C**: `data/config/company.json` is a valid `RulesConfig`.
- [ ] **C**: use the extensions `.eml` (email), `.txt` (chat), `.pdf`, `.png` and `.jpg`; the processing order is by file name, `dev` then `adversarial`.
- [ ] **C**: agree the `DATASET_NOW` value and the `expected.csv` format above; leave byte-identical resends out of `expected.csv`.
- [ ] **C**: the "month change" trap cannot be expressed with a single batch clock. Engine tests cover it, unless C asks for per-file clocks.
- [ ] **D**: add `uploadInvoice` to the api-client; mocks follow `DecisionRecord`, `RulesConfigVersion`, `AuditVerification`, `Metrics` and `ApiError`.

### Delivery order

E's commits follow the list in PROPUESTA §7 exactly, in that order. Each one is a PR titled like its commit, on a branch named `<type>/<scope>-<topic>`, and squash-merged with CI green. Commits 1 and 2 are already on `main`.

| # | Commit (exact title from the list) | Contents | Depends on |
|---|---|---|---|
| 1 | `chore: initialize next.js project with typescript, tailwind and vitest` | Done (`4b73661`) | — |
| 2 | `docs: add CLAUDE.md with team conventions` | Done (`48892af`, landed as `docs: add CLAUDE.md, proposal and team conventions`) | — |
| 3 | `feat(store): add libsql schema and repositories` | `db.ts`, `schema.ts` (all 5 tables), the config, invoice, decision and approval repositories, the history and status mapping, `tests/store/decision-repository.test.ts`. Also `.env.example`, the `CLAUDE.md` "Getting started" line and step 2 of the README's "Puesta en marcha" (the three Turso commands), because this commit introduces the Turso requirement; commit 12 completes the README | Contracts prerequisite (below) |
| 4 | `feat(store): add append-only audit log` | `audit-log.ts` (`appendAuditEntry`, `canonicalJson`), the append-only triggers, and tests that `UPDATE` and `DELETE` fail | 3 |
| 5 | `feat(pipeline): add invoice processing pipeline` | `process-invoice.ts`, `save-rules-config.ts`, `dataset.ts` and their tests | 4, and B merged |
| 6 | `feat(api): add invoice, decision and config endpoints` | `POST /api/invoices`, `GET /api/invoices/[id]/file`, `GET /api/decisions`, `GET /api/decisions/[id]`, `GET` / `PUT /api/config` | 5 |
| 7 | `feat(api): add approval endpoint with revalidation` | `resolve-approval.ts` and its tests together with `POST /api/approvals/[decisionId]`: one logical change, one commit | 6, and A's `revalidateApproval` |
| 8 | `feat(store): chain audit entries with sha256 hashes` | `verifyAuditChain`, `GET /api/audit/verify`, the tamper-detection tests | 4 |
| 9 | `feat(scripts): add demo, demo:live and demo:tamper commands` | `scripts/demo.ts`, `scripts/demo-tamper.ts`, the `package.json` scripts | 8, and C's `company.json` |
| + | `feat(pipeline): compute metrics against expected decisions` (**extra**) | `compute-metrics.ts`, `GET /api/metrics` and tests. Not in the list: it comes from the decision that E owns the metrics formula, so A must be told | C's `expected.csv` format |
| 10 | `ci: run lint, tests and eval on every push` | Adds `npm run eval` to `ci.yml`; lint and tests already run | C's `eval.ts`, which needs the extra commit |
| 11 | `chore: configure turso database for vercel deployment` | Vercel env vars for `triple-firma-demo`; `outputFileTracingIncludes` for `data/expected.csv` and `data/cache`; seed with `npx tsx --env-file=<demo env file> scripts/demo.ts` | 9 |
| 12 | `docs: add readme with setup, deploy steps and metrics` | Spanish README: Turso setup per developer, the demo commands, the deploy steps and the metrics table | 11 |

**Where the list collides with the merged contracts:**
- **Commits 4 and 8.** `AuditEntrySchema` (merged in #1) requires `hash`, and requires `prevHash` on every entry after the first. Entries written by commit 4 therefore already carry their SHA-256 hash and the link to the previous entry. Writing fake hashes to keep the split literal would be worse. Commit 8 then adds what makes the chain useful: verification, its endpoint and the tamper tests. Its commit body explains this split.
- **Response schemas.** `feat(contracts): add api response schemas` must land before commit 3, but `contracts/` is A's folder. Either A commits it, or E opens it with A's approval, a second reviewer and the `rules-auditor`. It does not count in E's list.
- **This spec.** With squash merge, its branch becomes one extra `docs:` commit outside the list. If A prefers to keep it out of `main`, it stays on its branch.

The MCP server is P2, is not in the list, and is the first thing cut.

### Verification

- `npm run lint` passes the dependency rule; `npm run typecheck`, `npm test` and `npm run build` pass (build touches no database).
- With no API key, `npm run demo` against your own Turso database prints the counts and a valid chain, and the UI lists the decisions. Reloading after an approval shows it still resolved.
- Plan B: with `TURSO_DATABASE_URL=file:local.db`, the same `npm run demo` works with no network.
- Without `TURSO_DATABASE_URL`, `npm run dev` starts, and any API call answers 500, and the server log shows `TURSO_DATABASE_URL is not set: see README`. `npm run build` passes without it.
- Upload twice with `curl -F file=@data/invoices/dev/<file> localhost:3000/api/invoices`: the second call answers 200 with the same `decision.id`.
- Approve with `curl -X POST localhost:3000/api/approvals/<id> -H 'content-type: application/json' -d '{"action":"APPROVE","approver":"Ana","comment":"ok"}'`. A second identical call answers 409.
- After `npm run demo:tamper`, `GET /api/audit/verify` answers `isValid: false` with the altered `seq`.
- `npm run eval` exits 1 when a leak is introduced.
