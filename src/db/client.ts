// One PostgreSQL database per server process, run in-process by PGlite (the
// Postgres engine compiled to WebAssembly), so the demo needs no database
// server. Locally the data lives in ./.pglite; on Vercel, where the disk is
// read-only, each instance keeps its own database in memory, seeded on start.
// RACKPILOT_DB picks the directory, or "memory" for tests.
//
// PGlite runs one statement or transaction at a time. Code inside tx() is
// routed to the open transaction through AsyncLocalStorage, so a helper that
// calls q() from inside a transaction joins it instead of waiting on it.

import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.ts";

type Param = string | number | boolean | null | Date | object;
type Runner = Pick<Transaction, "query" | "exec">;

const g = globalThis as unknown as { __rackpilotDb?: Promise<PGlite>; __rackpilotSeeding?: Promise<void> };
const current = new AsyncLocalStorage<Runner>();

/** Set by the seed module, which imports this one, to avoid an import cycle. */
let seeder: ((db: PGlite) => Promise<void>) | null = null;
export function registerSeeder(fn: (db: PGlite) => Promise<void>) {
  seeder = fn;
}

function location() {
  const env = process.env.RACKPILOT_DB;
  if (env === "memory" || (!env && process.env.VERCEL)) return undefined;
  return env ?? path.join(process.cwd(), ".pglite");
}

async function open(): Promise<PGlite> {
  const dir = location();
  const db = dir ? new PGlite(dir) : new PGlite();
  const version = await db
    .query<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")
    .then((r) => r.rows[0]?.value)
    .catch(() => undefined);
  if (version !== SCHEMA_VERSION) await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await db.exec(SCHEMA_SQL);
  const seeded = await db.query<{ value: string }>("SELECT value FROM meta WHERE key = 'seeded_at'");
  if (!seeded.rows.length) {
    if (!seeder) await import("../seed/index.ts");
    await seeder!(db);
  }
  return db;
}

export function database(): Promise<PGlite> {
  g.__rackpilotDb ??= open().catch((err) => {
    g.__rackpilotDb = undefined;
    throw err;
  });
  return g.__rackpilotDb;
}

async function runner(): Promise<Runner> {
  return current.getStore() ?? (await database());
}

// A transaction object does not queue its own statements, so parallel calls
// inside one (Promise.all) are chained here. The root connection queues itself.
const queues = new WeakMap<Runner, Promise<unknown>>();
async function serial<T>(r: Runner, fn: () => Promise<T>): Promise<T> {
  if (!current.getStore()) return fn();
  const prev = queues.get(r) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(r, next.catch(() => undefined));
  return next;
}

/** All rows. Use $1, $2 ... placeholders. */
export async function q<T>(sql: string, ...params: Param[]): Promise<T[]> {
  const r = await runner();
  const res = await serial(r, () => r.query<T>(sql, params));
  return res.rows;
}

/** The first row, or undefined. */
export async function one<T>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await q<T>(sql, ...params))[0];
}

/** Runs a statement and returns how many rows it touched. */
export async function run(sql: string, ...params: Param[]): Promise<number> {
  const r = await runner();
  const res = await serial(r, () => r.query(sql, params));
  return res.affectedRows ?? 0;
}

/** Runs several statements without parameters (DDL, bulk inserts). */
export async function exec(sql: string): Promise<void> {
  const r = await runner();
  await serial(r, () => r.exec(sql));
}

/**
 * Runs fn in one transaction: everything commits or nothing does. Nested calls
 * join the outer transaction.
 */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (current.getStore()) return fn();
  const db = await database();
  return db.transaction((t) => current.run(t, fn));
}

/** Runs fn with q()/tx() bound to a specific connection (used while seeding, before database() resolves). */
export function withConnection<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  return current.run(db, fn);
}

/** True when the error is a Postgres CHECK constraint violation. */
export function isCheckViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23514";
}
