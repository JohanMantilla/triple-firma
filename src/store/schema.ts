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
