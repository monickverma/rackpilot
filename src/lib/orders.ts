// WhatsApp order lifecycle: draft (parse + match, nothing written), confirm
// (reserve what is free, flag the rest), pick, fulfil (record the sale) or
// cancel (release). Stock only changes through inventory.post().

import { all, get, run, tx } from "../db/index.ts";
import type { LineStatus, OrderStatus } from "../db/schema.ts";
import { holdsOn, post, StockError, variantById, type Hold, type MovementRow, movements } from "./inventory.ts";
import { SALES_WINDOW_DAYS } from "./insights.ts";
import { dueDay } from "./format.ts";
import { matchLines, type CatalogVariant, type LineMatch } from "./match.ts";
import { resolveDue } from "./parser/due.ts";
import { parseOrder } from "./parser/parse.ts";
import type { ParseResult, Token } from "./parser/types.ts";

const DAY = 86_400_000;

export interface DraftLine {
  sourceText: string;
  qty: number;
  product: string | null;
  colour: string | null;
  size: string | null;
  descriptors: string[];
  inherited: string[];
  warnings: string[];
  match: LineMatch;
}

export interface Draft {
  message: string;
  /** Who turned the text into lines. Matching and stock checks are the same either way. */
  parser: "rules" | "claude";
  tokens: Token[];
  due: { label: string; text: string; at: number | null } | null;
  urgent: boolean;
  unknownWords: string[];
  confidence: "high" | "medium" | "low";
  lines: DraftLine[];
}

export function catalog(now = new Date()): CatalogVariant[] {
  return all<CatalogVariant>(
    `SELECT v.id AS variantId, v.sku, p.id AS productId, p.code AS productCode, p.name AS productName, p.category, p.keywords,
            v.colour, v.size, v.location, v.on_hand AS onHand, v.reserved, p.sell_price AS sellPrice,
            COALESCE((SELECT SUM(-m.on_hand_delta) FROM stock_movements m WHERE m.variant_id = v.id AND m.type = 'sale' AND m.created_at >= ?), 0) AS sold30
       FROM variants v JOIN products p ON p.id = v.product_id`,
    now.getTime() - SALES_WINDOW_DAYS * DAY,
  );
}

/** Reads a message with the rules into a draft order. Writes nothing. */
export function draftOrder(message: string, now = new Date()): Draft {
  return draftFromParse(message, parseOrder(message), "rules", now);
}

/** Matches parsed lines to variants and free stock, whoever parsed them. Writes nothing. */
export function draftFromParse(message: string, parsed: ParseResult, parser: Draft["parser"], now = new Date()): Draft {
  const matches = matchLines(parsed.lines, catalog(now));
  return {
    message,
    parser,
    tokens: parsed.tokens,
    due: parsed.due ? { ...parsed.due, at: resolveDue(parsed.due.label, now)?.getTime() ?? null } : null,
    urgent: parsed.urgent,
    unknownWords: parsed.unknownWords,
    confidence: parsed.confidence,
    lines: parsed.lines.map((l, i) => ({
      sourceText: l.sourceText,
      qty: l.qty,
      product: l.product,
      colour: l.colour,
      size: l.size,
      descriptors: l.descriptors,
      inherited: l.inherited,
      warnings: l.warnings,
      match: matches[i],
    })),
  };
}

export interface ConfirmLine {
  sourceText: string;
  qty: number;
  variantId: number | null;
  matchNote: string | null;
}

export interface ConfirmInput {
  customerName: string;
  message: string;
  dueLabel: string | null;
  parser?: "rules" | "claude";
  lines: ConfirmLine[];
}

const fmtDue = (h: Hold) => (h.dueAt ? `, due ${dueDay(h.dueLabel, h.dueAt)}` : "");

function shortNote(wanted: number, got: number, onHand: number, holders: Hold[]) {
  const missing = wanted - got;
  if (holders.length && onHand >= wanted) {
    const who = holders.map((h) => `${h.orderCode} (${h.customerName}, ${h.qty}${fmtDue(h)})`).join(", ");
    return `Short by ${missing}: ${onHand} on the rack but held for ${who}.`;
  }
  if (holders.length) {
    const who = holders.map((h) => `${h.orderCode} (${h.customerName}, ${h.qty})`).join(", ");
    return `Short by ${missing}: only ${onHand} on the rack and ${holders.reduce((a, h) => a + h.qty, 0)} already held for ${who}.`;
  }
  return `Short by ${missing}: only ${onHand} on the rack.`;
}

/** Creates the order and reserves each line from what is free right now. */
export function confirmOrder(input: ConfirmInput, now = new Date()): { id: number; code: string } {
  const customer = input.customerName.trim() || "WhatsApp customer";
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new StockError("The order has no lines.");
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty > 500) throw new StockError(`Quantity for "${l.sourceText}" must be a whole number up to 500.`);
  }
  return tx(() => {
    const id = (get<{ id: number }>("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM orders")!).id;
    const code = `ORD-${1000 + id}`;
    const dueAt = resolveDue(input.dueLabel, now)?.getTime() ?? null;
    run(
      "INSERT INTO orders (id, code, customer_name, raw_message, parser, status, due_label, due_at, created_at) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)",
      id, code, customer, input.message, input.parser ?? "rules", input.dueLabel, dueAt, now.getTime(),
    );
    for (const l of lines) {
      if (l.variantId === null) {
        run(
          "INSERT INTO order_lines (order_id, variant_id, source_text, qty_requested, status, match_note, note) VALUES (?, NULL, ?, ?, 'unmatched', ?, ?)",
          id, l.sourceText, l.qty, l.matchNote, "Not matched to a product; nothing reserved.",
        );
        continue;
      }
      const v = variantById(l.variantId);
      if (!v) throw new StockError(`Unknown variant ${l.variantId}`);
      const free = Math.max(v.onHand - v.reserved, 0);
      const take = Math.min(l.qty, free);
      const status: LineStatus = take === l.qty ? "reserved" : "short";
      const note = status === "short" ? shortNote(l.qty, take, v.onHand, holdsOn(v.id, id)) : null;
      const lineId = run(
        "INSERT INTO order_lines (order_id, variant_id, source_text, qty_requested, qty_reserved, status, match_note, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id, v.id, l.sourceText, l.qty, take, status, l.matchNote, note,
      ).lastInsertRowid;
      if (take > 0) {
        post({ variantId: v.id, type: "reserve", qty: take, onHandDelta: 0, reservedDelta: take, orderId: id, ref: code, note: `Line ${lineId} for ${customer}`, at: now });
      }
    }
    return { id, code };
  });
}

function requireOpen(id: number) {
  const o = get<{ id: number; code: string; status: OrderStatus; customerName: string }>(
    "SELECT id, code, status, customer_name AS customerName FROM orders WHERE id = ?", id,
  );
  if (!o) throw new StockError("Order not found.");
  if (o.status !== "confirmed") throw new StockError(`${o.code} is already ${o.status}.`);
  return o;
}

interface HeldLine {
  id: number;
  variantId: number;
  qtyReserved: number;
  qtyRequested: number;
  status: LineStatus;
}

const heldLines = (orderId: number) =>
  all<HeldLine>(
    `SELECT id, variant_id AS variantId, qty_reserved AS qtyReserved, qty_requested AS qtyRequested, status
       FROM order_lines WHERE order_id = ? AND status IN ('reserved', 'short') AND qty_reserved > 0`,
    orderId,
  );

/** Hands over everything reserved: each reservation becomes a sale. */
export function fulfilOrder(id: number, now = new Date()) {
  tx(() => {
    const o = requireOpen(id);
    for (const l of heldLines(id)) {
      post({ variantId: l.variantId, type: "sale", qty: l.qtyReserved, onHandDelta: -l.qtyReserved, reservedDelta: -l.qtyReserved, orderId: id, ref: o.code, note: `Picked and handed to ${o.customerName}`, at: now });
      run("UPDATE order_lines SET status = 'fulfilled', qty_fulfilled = ? WHERE id = ?", l.qtyReserved, l.id);
    }
    run("UPDATE orders SET status = 'fulfilled', closed_at = ? WHERE id = ?", now.getTime(), id);
  });
}

/** Cancels the order and puts its reservations back on sale. */
export function cancelOrder(id: number, now = new Date()) {
  tx(() => {
    const o = requireOpen(id);
    for (const l of heldLines(id)) {
      post({ variantId: l.variantId, type: "release", qty: l.qtyReserved, onHandDelta: 0, reservedDelta: -l.qtyReserved, orderId: id, ref: o.code, note: "Order cancelled", at: now });
      run("UPDATE order_lines SET status = 'released' WHERE id = ?", l.id);
    }
    run("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", now.getTime(), id);
  });
}

/** Tries again to reserve what short lines are missing, e.g. after a delivery. */
export function recheckOrder(id: number, now = new Date()) {
  return tx(() => {
    const o = requireOpen(id);
    let added = 0;
    const lines = all<HeldLine>(
      "SELECT id, variant_id AS variantId, qty_reserved AS qtyReserved, qty_requested AS qtyRequested, status FROM order_lines WHERE order_id = ? AND status = 'short'",
      id,
    );
    for (const l of lines) {
      const v = variantById(l.variantId)!;
      const take = Math.min(l.qtyRequested - l.qtyReserved, Math.max(v.onHand - v.reserved, 0));
      const reserved = l.qtyReserved + take;
      if (take > 0) {
        post({ variantId: v.id, type: "reserve", qty: take, onHandDelta: 0, reservedDelta: take, orderId: id, ref: o.code, note: `Line ${l.id} topped up`, at: now });
        added += take;
      }
      const after = variantById(l.variantId)!;
      const note = reserved === l.qtyRequested ? null : shortNote(l.qtyRequested, reserved, after.onHand, holdsOn(v.id, id));
      run("UPDATE order_lines SET qty_reserved = ?, status = ?, note = ? WHERE id = ?", reserved, reserved === l.qtyRequested ? "reserved" : "short", note, l.id);
    }
    return added;
  });
}

// ---- reads ----

export interface OrderSummary {
  id: number;
  code: string;
  parser: string;
  customerName: string;
  rawMessage: string;
  status: OrderStatus;
  dueLabel: string | null;
  dueAt: number | null;
  createdAt: number;
  closedAt: number | null;
  lines: number;
  units: number;
  reservedUnits: number;
  shortLines: number;
  unmatchedLines: number;
}

const SUMMARY_SELECT = `SELECT o.id, o.code, o.parser, o.customer_name AS customerName, o.raw_message AS rawMessage, o.status,
  o.due_label AS dueLabel, o.due_at AS dueAt, o.created_at AS createdAt, o.closed_at AS closedAt,
  COUNT(l.id) AS lines, COALESCE(SUM(l.qty_requested), 0) AS units, COALESCE(SUM(l.qty_reserved), 0) AS reservedUnits,
  COALESCE(SUM(l.status = 'short'), 0) AS shortLines, COALESCE(SUM(l.status = 'unmatched'), 0) AS unmatchedLines
  FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id`;

export function listOrders(status?: OrderStatus): OrderSummary[] {
  return status
    ? all<OrderSummary>(`${SUMMARY_SELECT} WHERE o.status = ? GROUP BY o.id ORDER BY o.created_at DESC`, status)
    : all<OrderSummary>(`${SUMMARY_SELECT} GROUP BY o.id ORDER BY (o.status = 'confirmed') DESC, o.created_at DESC`);
}

export interface OrderLineDetail {
  id: number;
  sourceText: string;
  qtyRequested: number;
  qtyReserved: number;
  qtyFulfilled: number;
  status: LineStatus;
  matchNote: string | null;
  note: string | null;
  variantId: number | null;
  sku: string | null;
  productName: string | null;
  colour: string | null;
  size: string | null;
  location: string | null;
  onHand: number | null;
  reserved: number | null;
  holders: Hold[];
}

export interface OrderDetail extends OrderSummary {
  detail: OrderLineDetail[];
  movements: MovementRow[];
}

export function getOrder(id: number): OrderDetail | null {
  const o = get<OrderSummary>(`${SUMMARY_SELECT} WHERE o.id = ? GROUP BY o.id`, id);
  if (!o) return null;
  const lines = all<Omit<OrderLineDetail, "holders">>(
    `SELECT l.id, l.source_text AS sourceText, l.qty_requested AS qtyRequested, l.qty_reserved AS qtyReserved,
            l.qty_fulfilled AS qtyFulfilled, l.status, l.match_note AS matchNote, l.note, l.variant_id AS variantId,
            v.sku, p.name AS productName, v.colour, v.size, v.location, v.on_hand AS onHand, v.reserved
       FROM order_lines l LEFT JOIN variants v ON v.id = l.variant_id LEFT JOIN products p ON p.id = v.product_id
      WHERE l.order_id = ? ORDER BY l.id`,
    id,
  );
  return {
    ...o,
    detail: lines.map((l) => ({ ...l, holders: l.status === "short" && l.variantId ? holdsOn(l.variantId, id) : [] })),
    movements: movements({ orderId: id, limit: 100 }),
  };
}

export interface PickItem {
  lineId: number;
  location: string;
  sku: string;
  productName: string;
  colour: string;
  size: string;
  qty: number;
  shortBy: number;
}

/** What to pull off the racks for an order, in walking order (rack, shelf, bin). */
export function pickList(id: number) {
  const order = getOrder(id);
  if (!order) return null;
  const items: PickItem[] = order.detail
    .filter((l) => l.variantId && l.qtyReserved > 0 && (l.status === "reserved" || l.status === "short"))
    .map((l) => ({
      lineId: l.id, location: l.location!, sku: l.sku!, productName: l.productName!, colour: l.colour!, size: l.size!,
      qty: l.qtyReserved, shortBy: l.qtyRequested - l.qtyReserved,
    }))
    .sort((a, b) => a.location.localeCompare(b.location, "en", { numeric: true }) || a.sku.localeCompare(b.sku, "en", { numeric: true }));
  const missing = order.detail.filter((l) => l.status === "unmatched" || (l.status === "short" && l.qtyReserved === 0));
  return { order, items, missing };
}
