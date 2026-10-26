// Writes the in-memory world into Postgres with multi-row INSERTs, then moves
// each id sequence past the highest id so new rows continue from there.

import type { PGlite } from "@electric-sql/pglite";
import type { Built } from "./build.ts";
import type { Value } from "./world.ts";

const ORDER = [
  "businesses", "users", "suppliers", "customers", "products", "locations", "product_variants", "orders", "order_items",
  "reservations", "pick_lists", "pick_list_items", "shipments", "shipment_items", "invoices", "invoice_items", "payments", "transfers",
  "transfer_items", "returns", "return_items", "purchase_orders", "purchase_order_items", "receipts", "receipt_items",
  "physical_stock_counts", "stock_count_lines", "stock_movements", "audit_events", "investigations", "investigation_findings",
  "investigation_evidence", "investigation_checks", "investigation_events", "documents", "document_chunks",
];

function literal(v: Value | undefined): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return `'${s.replaceAll("'", "''")}'`;
}

async function insert(db: PGlite, table: string, rows: Record<string, Value>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 800) {
    const chunk = rows.slice(i, i + 800);
    const values = chunk.map((r) => `(${cols.map((c) => literal(r[c])).join(", ")})`).join(",\n");
    await db.exec(`INSERT INTO ${table} (${cols.join(", ")}) VALUES ${values};`);
  }
}

export async function writeWorld(db: PGlite, built: Built) {
  const { world } = built;
  for (const table of ORDER) {
    await insert(db, table, world.rows(table));
    if (table === "product_variants") await insert(db, "inventory_balances", [...world.balances.values()] as unknown as Record<string, Value>[]);
  }
  await insert(db, "meta", world.rows("meta").map(({ key, value }) => ({ key, value })));
  for (const table of ORDER) {
    await db.exec(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false);`);
  }
}
