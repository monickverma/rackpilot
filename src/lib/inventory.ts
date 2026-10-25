// Stock reads and writes. Every write goes through post(), which changes the
// variant's running totals and appends the stock_movements row in the same
// transaction, so the totals can always be rebuilt from the ledger.

import { all, get, run, tx } from "../db/index.ts";
import type { MovementType } from "../db/schema.ts";
import {
  bestSellers, deadStockFlags, groupDeadStock, lowStockFlags, reorderSuggestions, SALES_WINDOW_DAYS, seasonHolds,
  type SalesStats, type StockRow,
} from "./insights.ts";

const DAY = 86_400_000;

export class StockError extends Error {}

export interface MovementInput {
  variantId: number;
  type: MovementType;
  qty: number;
  onHandDelta: number;
  reservedDelta: number;
  orderId?: number | null;
  ref?: string | null;
  note?: string | null;
  at: Date;
}

/** Applies one movement. Throws StockError if it would break the stock rules. */
export function post(m: MovementInput): number {
  return tx(() => {
    try {
      const r = run("UPDATE variants SET on_hand = on_hand + ?, reserved = reserved + ? WHERE id = ?", m.onHandDelta, m.reservedDelta, m.variantId);
      if (r.changes !== 1) throw new StockError(`Unknown variant ${m.variantId}`);
    } catch (err) {
      if (err instanceof Error && /CHECK constraint failed/.test(err.message)) {
        throw new StockError("Not enough stock: that would take on-hand below zero or below what is reserved.");
      }
      throw err;
    }
    return run(
      "INSERT INTO stock_movements (variant_id, type, qty, on_hand_delta, reserved_delta, order_id, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      m.variantId, m.type, m.qty, m.onHandDelta, m.reservedDelta, m.orderId ?? null, m.ref ?? null, m.note ?? null, m.at.getTime(),
    ).lastInsertRowid;
  });
}

export interface VariantRow {
  id: number;
  sku: string;
  productId: number;
  colour: string;
  size: string;
  location: string;
  onHand: number;
  reserved: number;
}

const VARIANT_COLS = "v.id, v.sku, v.product_id AS productId, v.colour, v.size, v.location, v.on_hand AS onHand, v.reserved";

export function variantById(id: number) {
  return get<VariantRow>(`SELECT ${VARIANT_COLS} FROM variants v WHERE v.id = ?`, id);
}

function requireVariant(id: number) {
  const v = variantById(id);
  if (!v) throw new StockError(`Unknown variant ${id}`);
  return v;
}

function checkQty(qty: number) {
  if (!Number.isInteger(qty) || qty <= 0 || qty > 500) throw new StockError("Quantity must be a whole number from 1 to 500.");
}

export function receiveStock(variantId: number, qty: number, ref: string, note: string | null, now = new Date()) {
  checkQty(qty);
  requireVariant(variantId);
  return post({ variantId, type: "receive", qty, onHandDelta: qty, reservedDelta: 0, ref: ref || "Delivery", note, at: now });
}

/** Records a physical count: the difference from on-hand becomes an adjust row. */
export function countStock(variantId: number, counted: number, note: string | null, now = new Date()) {
  if (!Number.isInteger(counted) || counted < 0 || counted > 5000) throw new StockError("Count must be a whole number, 0 or more.");
  return tx(() => {
    const v = requireVariant(variantId);
    if (counted < v.reserved) throw new StockError(`${v.reserved} of ${v.sku} are reserved for open orders, so the count can't be below ${v.reserved}.`);
    const delta = counted - v.onHand;
    if (delta === 0) return null;
    return post({ variantId, type: "adjust", qty: Math.abs(delta), onHandDelta: delta, reservedDelta: 0, ref: "Stock count", note: note || (delta > 0 ? "Found more than recorded" : "Fewer on the rack than recorded"), at: now });
  });
}

export function counterSale(variantId: number, qty: number, now = new Date()) {
  checkQty(qty);
  return tx(() => {
    const v = requireVariant(variantId);
    if (v.onHand - v.reserved < qty) throw new StockError(`Only ${Math.max(v.onHand - v.reserved, 0)} of ${v.sku} free to sell; the rest is reserved.`);
    return post({ variantId, type: "sale", qty, onHandDelta: -qty, reservedDelta: 0, ref: "Counter sale", at: now });
  });
}

// ---- reads for insights ----

export function stockRows(): StockRow[] {
  return all<StockRow>(
    `SELECT v.id AS variantId, v.sku, p.id AS productId, p.code AS productCode, p.name AS productName, v.colour, v.size,
            v.location, v.on_hand AS onHand, v.reserved, p.cost_price AS costPrice, p.sell_price AS sellPrice,
            s.name AS supplierName, s.lead_time_days AS leadTimeDays, s.pack_ratio AS packRatio, p.season
       FROM variants v JOIN products p ON p.id = v.product_id JOIN suppliers s ON s.id = p.supplier_id
      ORDER BY v.location, v.sku`,
  );
}

export function salesStats(now = new Date()): Map<number, SalesStats> {
  const rows = all<{ variantId: number; sold30: number; lastSaleAt: number | null; firstReceivedAt: number | null }>(
    `SELECT variant_id AS variantId,
            SUM(CASE WHEN type = 'sale' AND created_at >= ? THEN -on_hand_delta ELSE 0 END) AS sold30,
            MAX(CASE WHEN type = 'sale' THEN created_at END) AS lastSaleAt,
            MIN(CASE WHEN type = 'receive' THEN created_at END) AS firstReceivedAt
       FROM stock_movements GROUP BY variant_id`,
    now.getTime() - SALES_WINDOW_DAYS * DAY,
  );
  return new Map(
    rows.map((r) => [
      r.variantId,
      { sold30: r.sold30, lastSaleAt: r.lastSaleAt === null ? null : new Date(r.lastSaleAt), firstReceivedAt: r.firstReceivedAt === null ? null : new Date(r.firstReceivedAt) },
    ]),
  );
}

export function insights(now = new Date()) {
  const rows = stockRows();
  const stats = salesStats(now);
  const low = lowStockFlags(rows, stats, now);
  const dead = deadStockFlags(rows, stats, now);
  return {
    rows,
    stats,
    low,
    dead,
    deadGroups: groupDeadStock(dead),
    reorder: reorderSuggestions(rows, stats, now),
    holds: seasonHolds(rows, now),
    best: bestSellers(rows, stats),
  };
}

// ---- integrity ----

export interface Reconciliation {
  variants: number;
  movements: number;
  ledgerMismatches: { sku: string; onHand: number; ledgerOnHand: number; reserved: number; ledgerReserved: number }[];
  reservationMismatches: { sku: string; reserved: number; heldByOrders: number }[];
}

/** Rebuilds every total from the ledger and from open orders and lists any difference. */
export function reconcile(): Reconciliation {
  const counts = get<{ variants: number; movements: number }>("SELECT (SELECT COUNT(*) FROM variants) AS variants, (SELECT COUNT(*) FROM stock_movements) AS movements")!;
  const ledgerMismatches = all<Reconciliation["ledgerMismatches"][number]>(
    `SELECT v.sku, v.on_hand AS onHand, COALESCE(SUM(m.on_hand_delta), 0) AS ledgerOnHand,
            v.reserved, COALESCE(SUM(m.reserved_delta), 0) AS ledgerReserved
       FROM variants v LEFT JOIN stock_movements m ON m.variant_id = v.id
      GROUP BY v.id HAVING ledgerOnHand != v.on_hand OR ledgerReserved != v.reserved`,
  );
  const reservationMismatches = all<Reconciliation["reservationMismatches"][number]>(
    `SELECT v.sku, v.reserved, COALESCE(h.held, 0) AS heldByOrders
       FROM variants v LEFT JOIN (
         SELECT l.variant_id, SUM(l.qty_reserved) AS held FROM order_lines l JOIN orders o ON o.id = l.order_id
          WHERE o.status = 'confirmed' AND l.status IN ('reserved', 'short') GROUP BY l.variant_id
       ) h ON h.variant_id = v.id
      WHERE v.reserved != COALESCE(h.held, 0)`,
  );
  return { ...counts, ledgerMismatches, reservationMismatches };
}

// ---- reads for pages ----

export interface MovementRow {
  id: number;
  variantId: number;
  sku: string;
  type: MovementType;
  qty: number;
  onHandDelta: number;
  reservedDelta: number;
  orderId: number | null;
  orderCode: string | null;
  ref: string | null;
  note: string | null;
  createdAt: number;
}

const MOVEMENT_SELECT = `SELECT m.id, m.variant_id AS variantId, v.sku, m.type, m.qty, m.on_hand_delta AS onHandDelta,
  m.reserved_delta AS reservedDelta, m.order_id AS orderId, o.code AS orderCode, m.ref, m.note, m.created_at AS createdAt
  FROM stock_movements m JOIN variants v ON v.id = m.variant_id LEFT JOIN orders o ON o.id = m.order_id`;

export interface LedgerFilter {
  type?: MovementType;
  variantId?: number;
  sku?: string;
  orderId?: number;
  since?: number;
  limit?: number;
}

function whereClause(filter: LedgerFilter, withType: boolean) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: string, value: string | number) => {
    where.push(clause);
    params.push(value);
  };
  if (withType && filter.type) add("m.type = ?", filter.type);
  if (filter.variantId) add("m.variant_id = ?", filter.variantId);
  if (filter.sku) add("v.sku LIKE ?", `${filter.sku.toUpperCase()}%`);
  if (filter.orderId) add("m.order_id = ?", filter.orderId);
  if (filter.since) add("m.created_at >= ?", filter.since);
  return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

export function movements(filter: LedgerFilter = {}): MovementRow[] {
  const w = whereClause(filter, true);
  return all<MovementRow>(`${MOVEMENT_SELECT} ${w.sql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`, ...w.params, filter.limit ?? 200);
}

/** Per-type totals for the same filter, ignoring the type itself. */
export function movementTotals(filter: LedgerFilter = {}) {
  const w = whereClause(filter, false);
  return all<{ type: MovementType; rows: number; units: number; onHandDelta: number; reservedDelta: number }>(
    `SELECT m.type, COUNT(*) AS rows, SUM(m.qty) AS units, SUM(m.on_hand_delta) AS onHandDelta, SUM(m.reserved_delta) AS reservedDelta
       FROM stock_movements m JOIN variants v ON v.id = m.variant_id ${w.sql}
      GROUP BY m.type ORDER BY rows DESC`,
    ...w.params,
  );
}

export interface VariantDetail extends VariantRow {
  productCode: string;
  productName: string;
  category: string;
  costPrice: number;
  sellPrice: number;
  season: string | null;
  supplierName: string;
  leadTimeDays: number;
  packRatio: string;
}

export function variantBySku(sku: string) {
  return get<VariantDetail>(
    `SELECT ${VARIANT_COLS}, p.code AS productCode, p.name AS productName, p.category, p.cost_price AS costPrice,
            p.sell_price AS sellPrice, p.season, s.name AS supplierName, s.lead_time_days AS leadTimeDays, s.pack_ratio AS packRatio
       FROM variants v JOIN products p ON p.id = v.product_id JOIN suppliers s ON s.id = p.supplier_id WHERE v.sku = ?`,
    sku.toUpperCase(),
  );
}

export function siblings(productId: number) {
  return all<VariantRow>(`SELECT ${VARIANT_COLS} FROM variants v WHERE v.product_id = ? ORDER BY v.colour, v.id`, productId);
}

export interface Hold {
  lineId: number;
  orderId: number;
  orderCode: string;
  customerName: string;
  qty: number;
  dueAt: number | null;
  dueLabel: string | null;
}

/** A variant's whole ledger with the on-hand and reserved after each row. */
export function stockCard(variantId: number) {
  const rows = movements({ variantId, limit: 5000 });
  const balances = new Map<number, { onHand: number; reserved: number }>();
  let onHand = 0;
  let reserved = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    onHand += rows[i].onHandDelta;
    reserved += rows[i].reservedDelta;
    balances.set(rows[i].id, { onHand, reserved });
  }
  return { rows, balances };
}

/** Open orders holding stock of a variant. */
export function holdsOn(variantId: number, exceptOrderId: number | null = null): Hold[] {
  return all<Hold>(
    `SELECT l.id AS lineId, o.id AS orderId, o.code AS orderCode, o.customer_name AS customerName, l.qty_reserved AS qty,
            o.due_at AS dueAt, o.due_label AS dueLabel
       FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE l.variant_id = ? AND o.status = 'confirmed' AND l.status IN ('reserved', 'short') AND l.qty_reserved > 0 AND o.id != ?
      ORDER BY o.created_at`,
    variantId, exceptOrderId ?? -1,
  );
}

/**
 * Units sold in rolling 7-day windows ending at today's start (India time),
 * oldest first, so the last bar is always a full week.
 */
export function weeklySales(now = new Date(), weeks = 26) {
  const IST = 5.5 * 3_600_000;
  const local = new Date(now.getTime() + IST);
  const end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST;
  const start = end - weeks * 7 * DAY;
  const rows = all<{ bucket: number; units: number; revenue: number }>(
    // Parameters arrive as REAL, so cast to keep the division whole.
    `SELECT CAST((m.created_at - ?) / ${7 * DAY} AS INTEGER) AS bucket, SUM(-m.on_hand_delta) AS units, SUM(-m.on_hand_delta * p.sell_price) AS revenue
       FROM stock_movements m JOIN variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id
      WHERE m.type = 'sale' AND m.created_at >= ? AND m.created_at < ? GROUP BY bucket`,
    start, start, end,
  );
  const byBucket = new Map(rows.map((r) => [Math.floor(r.bucket), r]));
  return Array.from({ length: weeks }, (_, i) => ({
    start: start + i * 7 * DAY,
    end: start + (i + 1) * 7 * DAY,
    units: byBucket.get(i)?.units ?? 0,
    revenue: byBucket.get(i)?.revenue ?? 0,
  }));
}
