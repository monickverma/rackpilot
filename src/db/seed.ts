// Writes the generated synthetic shop into an open connection, replacing
// whatever was there.

import type { DatabaseSync } from "node:sqlite";
import { generateSeed } from "../lib/seed/generate.ts";
import { TABLES_IN_DELETE_ORDER } from "./schema.ts";

const ms = (d: Date | null) => (d ? d.getTime() : null);

export function seedDatabase(conn: DatabaseSync, now: Date) {
  const seed = generateSeed(now);
  conn.exec("BEGIN IMMEDIATE");
  try {
    for (const table of TABLES_IN_DELETE_ORDER) conn.exec(`DELETE FROM ${table}`);

    const supplier = conn.prepare("INSERT INTO suppliers (id, name, city, lead_time_days, pack_ratio) VALUES (?, ?, ?, ?, ?)");
    for (const s of seed.suppliers) supplier.run(s.id, s.name, s.city, s.leadTimeDays, s.packRatio);

    const product = conn.prepare(
      "INSERT INTO products (id, code, name, category, keywords, supplier_id, cost_price, sell_price, season) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const p of seed.products) product.run(p.id, p.code, p.name, p.category, p.keywords, p.supplierId, p.costPrice, p.sellPrice, p.season);

    const variant = conn.prepare("INSERT INTO variants (id, product_id, sku, colour, size, location, on_hand, reserved) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const v of seed.variants) variant.run(v.id, v.productId, v.sku, v.colour, v.size, v.location, v.onHand, v.reserved);

    const order = conn.prepare(
      "INSERT INTO orders (id, code, customer_name, raw_message, parser, status, due_label, due_at, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const o of seed.orders) {
      order.run(o.id, o.code, o.customerName, o.rawMessage, o.parser, o.status, o.dueLabel, ms(o.dueDate), o.createdAt.getTime(), ms(o.closedAt));
    }

    const line = conn.prepare(
      "INSERT INTO order_lines (id, order_id, variant_id, source_text, qty_requested, qty_reserved, qty_fulfilled, status, match_note, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const l of seed.orderLines) {
      line.run(l.id, l.orderId, l.variantId, l.sourceText, l.qtyRequested, l.qtyReserved, l.qtyFulfilled, l.status, "Matched when the order was entered", l.note);
    }

    const movement = conn.prepare(
      "INSERT INTO stock_movements (id, variant_id, type, qty, on_hand_delta, reserved_delta, order_id, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const m of seed.movements) {
      movement.run(m.id, m.variantId, m.type, m.qty, m.onHandDelta, m.reservedDelta, m.orderId, m.ref, m.note, m.createdAt.getTime());
    }

    const meta = conn.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
    for (const m of seed.meta) meta.run(m.key, m.value);
    conn.exec("COMMIT");
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}
