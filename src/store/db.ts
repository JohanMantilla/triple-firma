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

const globalForDb = globalThis as typeof globalThis & {
  tripleFirmaDb?: Promise<Client>;
  tripleFirmaWriteQueue?: Promise<unknown>;
};

// One client and one write queue per server process, kept on globalThis so dev hot reload does not
// open one per reload.
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

// Runs fn in one write transaction (BEGIN IMMEDIATE): commits when it returns, rolls back when it throws.
// ponytail: one queue per process, because a local file blocks the event loop while it waits for a lock
// that this same process holds, and fails with SQLITE_BUSY. Turso queues writers across processes on
// its own. Use one queue per database if the app ever opens two.
export function withWriteTransaction<T>(
  db: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const run = (globalForDb.tripleFirmaWriteQueue ?? Promise.resolve()).then(async () => {
    const tx = await db.transaction("write");
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } finally {
      tx.close();
    }
  });
  globalForDb.tripleFirmaWriteQueue = run.catch(() => undefined);
  return run;
}
