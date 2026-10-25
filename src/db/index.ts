// One SQLite connection per server process, using Node's built-in driver.
// The file is created and seeded with the synthetic shop on first use.
// DATABASE_PATH picks the file (":memory:" for tests); default ./local.db.

import { DatabaseSync, type StatementSync } from "node:sqlite";
import path from "node:path";
import { SCHEMA_SQL } from "./schema.ts";
import { seedDatabase } from "./seed.ts";

type Param = null | number | string;

const cache = globalThis as unknown as { __rackpilot?: { conn: DatabaseSync; statements: Map<string, StatementSync> } };

function open() {
  const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "local.db");
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (file !== ":memory:") conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec(SCHEMA_SQL);
  const state = { conn, statements: new Map<string, StatementSync>() };
  cache.__rackpilot = state;
  if (!conn.prepare("SELECT 1 FROM meta WHERE key = 'seeded_at'").get()) seedDatabase(conn, new Date());
  return state;
}

function state() {
  const s = cache.__rackpilot;
  return s?.conn.isOpen ? s : open();
}

function statement(sql: string): StatementSync {
  const s = state();
  let st = s.statements.get(sql);
  if (!st) {
    st = s.conn.prepare(sql);
    s.statements.set(sql, st);
  }
  return st;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return statement(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return statement(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
  const r = statement(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** Runs fn atomically. The driver is synchronous, so nothing else interleaves. */
export function tx<T>(fn: () => T): T {
  const { conn } = state();
  if (conn.isTransaction) return fn();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

/** Wipes everything and regenerates the synthetic shop as of `now`. */
export function resetDatabase(now = new Date()) {
  seedDatabase(state().conn, now);
}
