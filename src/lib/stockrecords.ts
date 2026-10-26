// The history of one variant at one location: ledger movements plus the
// records around them (picks, transfers, reservations, counts, returns),
// replayed from the last trusted balance. StockSleuth's reconstruction view
// and its rules both read this.

import { one, q } from "../db/client.ts";
import { units } from "./format.ts";
import type { EvidenceRef } from "./investigate/types.ts";

export interface StockEvent extends EvidenceRef {
  /** Change to recorded on-hand at this location, if the event moved stock. */
  delta: number | null;
  /** Recorded on-hand after this event (movements only). */
  balance: number | null;
  actor: string | null;
}

export interface LocationInfo {
  variantId: number;
  sku: string;
  productName: string;
  colour: string;
  size: string;
  unitCost: number;
  locationId: number;
  location: string;
  warehouse: string;
  rack: string | null;
  shelf: string | null;
  bin: string | null;
  kind: string;
  homeLocationId: number;
  onHand: number;
  reserved: number;
  needsVerification: boolean;
  verificationNote: string | null;
}

export async function locationInfo(businessId: number, variantId: number, locationId: number) {
  return one<LocationInfo>(
    `SELECT v.id AS "variantId", v.sku, p.name AS "productName", v.colour, v.size, p.unit_cost AS "unitCost", l.id AS "locationId", l.code AS location,
            l.warehouse, l.rack, l.shelf, l.bin, l.kind, v.home_location_id AS "homeLocationId", COALESCE(b.on_hand, 0) AS "onHand",
            COALESCE(b.reserved, 0) AS reserved, COALESCE(b.needs_verification, false) AS "needsVerification", b.verification_note AS "verificationNote"
       FROM product_variants v JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = $3 AND l.business_id = v.business_id
       LEFT JOIN inventory_balances b ON b.variant_id = v.id AND b.location_id = l.id
      WHERE v.business_id = $1 AND v.id = $2`,
    businessId, variantId, locationId,
  );
}

const LABEL: Record<string, string> = {
  opening: "Opening balance", receipt: "Stock received", dispatch: "Dispatched", transfer_out: "Transfer out", transfer_in: "Transfer in",
  customer_return: "Customer return restocked", supplier_return: "Returned to supplier", damage: "Damage written off", adjustment: "Manual adjustment",
};

/**
 * Replays the location from its last trusted point (the latest count that
 * matched the record, or the first movement) up to `until`.
 */
export async function reconstruct(businessId: number, variantId: number, locationId: number, until = new Date(), opts: { from?: Date } = {}) {
  const trusted = opts.from
    ? null
    : await one<{ countedAt: Date; qty: number; code: string; id: number }>(
        `SELECT c.counted_at AS "countedAt", l.counted_qty AS qty, c.code, c.id FROM stock_count_lines l JOIN physical_stock_counts c ON c.id = l.count_id
          WHERE c.business_id = $1 AND l.variant_id = $2 AND l.location_id = $3 AND l.counted_qty = l.recorded_qty AND c.counted_at < $4
          ORDER BY c.counted_at DESC LIMIT 1`,
        businessId, variantId, locationId, until,
      );
  const since = opts.from ?? trusted?.countedAt ?? null;
  const [moves, before, picks, transfers, counts, reservations] = await Promise.all([
    q<{ id: number; type: string; qty: number; refType: string | null; refId: number | null; refCode: string | null; reason: string | null; at: Date; actor: string | null }>(
      `SELECT m.id, m.type, m.qty, m.ref_type AS "refType", m.ref_id AS "refId", m.ref_code AS "refCode", m.reason, m.created_at AS at,
              COALESCE(u.name, m.actor_process) AS actor
         FROM stock_movements m LEFT JOIN users u ON u.id = m.actor_user_id
        WHERE m.business_id = $1 AND m.variant_id = $2 AND m.location_id = $3 AND m.created_at <= $4 AND ($5::timestamptz IS NULL OR m.created_at > $5)
        ORDER BY m.created_at, m.id`,
      businessId, variantId, locationId, until, since,
    ),
    since
      ? one<{ sum: number }>(`SELECT COALESCE(SUM(qty), 0)::int AS sum FROM stock_movements WHERE business_id = $1 AND variant_id = $2 AND location_id = $3 AND created_at <= $4`, businessId, variantId, locationId, since)
      : Promise.resolve({ sum: 0 }),
    q<{ id: number; code: string; orderId: number; orderCode: string; orderStatus: string; qty: number; at: Date; actor: string | null; reservationStatus: string }>(
      `SELECT pl.id, pl.code, o.id AS "orderId", o.code AS "orderCode", o.status AS "orderStatus", pli.qty_picked AS qty, pli.picked_at AS at, u.name AS actor,
              r.status AS "reservationStatus"
         FROM pick_list_items pli JOIN pick_lists pl ON pl.id = pli.pick_list_id JOIN orders o ON o.id = pl.order_id
         JOIN reservations r ON r.id = pli.reservation_id LEFT JOIN users u ON u.id = pl.picked_by
        WHERE pl.business_id = $1 AND pli.variant_id = $2 AND pli.location_id = $3 AND pli.qty_picked > 0 AND pli.picked_at <= $4
          AND ($5::timestamptz IS NULL OR pli.picked_at > $5)`,
      businessId, variantId, locationId, until, since,
    ),
    q<{ id: number; code: string; fromId: number; toId: number; from: string; to: string; status: string; qty: number; sentAt: Date; receivedAt: Date | null; actor: string | null }>(
      `SELECT t.id, t.code, t.from_location_id AS "fromId", t.to_location_id AS "toId", lf.code AS from, lt.code AS to, t.status, ti.qty_sent AS qty,
              t.sent_at AS "sentAt", t.received_at AS "receivedAt", u.name AS actor
         FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id JOIN locations lf ON lf.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id
         LEFT JOIN users u ON u.id = t.sent_by
        WHERE t.business_id = $1 AND ti.variant_id = $2 AND (t.from_location_id = $3 OR t.to_location_id = $3) AND t.sent_at <= $4
          AND ($5::timestamptz IS NULL OR t.sent_at > $5)`,
      businessId, variantId, locationId, until, since,
    ),
    q<{ id: number; code: string; at: Date; recorded: number; counted: number; actor: string | null; scope: string }>(
      `SELECT c.id, c.code, c.counted_at AS at, l.recorded_qty AS recorded, l.counted_qty AS counted, u.name AS actor, c.scope
         FROM stock_count_lines l JOIN physical_stock_counts c ON c.id = l.count_id LEFT JOIN users u ON u.id = c.counted_by
        WHERE c.business_id = $1 AND l.variant_id = $2 AND l.location_id = $3 AND c.counted_at <= $4 AND ($5::timestamptz IS NULL OR c.counted_at >= $5)`,
      businessId, variantId, locationId, until, since,
    ),
    q<{ id: number; orderCode: string; orderStatus: string; qty: number; status: string; at: Date; updatedAt: Date; note: string | null }>(
      `SELECT r.id, o.code AS "orderCode", o.status AS "orderStatus", r.qty, r.status, r.created_at AS at, r.updated_at AS "updatedAt", r.note
         FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id JOIN orders o ON o.id = oi.order_id
        WHERE r.business_id = $1 AND r.variant_id = $2 AND r.location_id = $3 AND r.created_at <= $4 AND ($5::timestamptz IS NULL OR r.updated_at > $5)`,
      businessId, variantId, locationId, until, since,
    ),
  ]);

  const start = since ? (trusted ? trusted.qty : before!.sum) : 0;
  const startLedger = before?.sum ?? 0;
  const events: StockEvent[] = [];
  if (since) {
    events.push({
      type: trusted ? "count" : "balance", id: trusted?.id ?? 0, code: trusted?.code ?? "", label: trusted ? "Last count that matched the record" : "Balance carried forward",
      detail: `${units(start)} on record${trusted ? ` and on the shelf (${trusted.code})` : ""}.`, at: since, delta: null, balance: startLedger, actor: null,
    });
  }
  let running = startLedger;
  for (const m of moves) {
    running += m.qty;
    events.push({
      type: "stock_movement", id: m.id, code: m.refCode ?? `MOV-${m.id}`, label: LABEL[m.type] ?? m.type,
      detail: `${m.qty > 0 ? "+" : ""}${m.qty}${m.refCode ? ` via ${m.refCode}` : ""}${m.reason ? `: ${m.reason}` : ""}.`, at: m.at, delta: m.qty, balance: running, actor: m.actor,
      values: { movementId: m.id, type: m.type, qty: m.qty },
    });
  }
  for (const p of picks) {
    const left = p.reservationStatus === "picked";
    events.push({
      type: "pick_list", id: p.id, code: p.code, label: "Order picked", at: p.at, delta: null, balance: null, actor: p.actor,
      detail: `${p.code} records ${units(p.qty)} picked for ${p.orderCode}. Picking doesn't change on-hand; it stays booked here until dispatch${left ? ` — and ${p.orderCode} is ${p.orderStatus} with the units still picked` : ""}.`,
      values: { qty: p.qty, order: p.orderCode },
    });
  }
  for (const t of transfers) {
    const outbound = t.fromId === locationId;
    events.push({
      type: "transfer", id: t.id, code: t.code, label: outbound ? "Transfer sent" : "Transfer arriving", at: t.sentAt, delta: null, balance: null, actor: t.actor,
      detail: outbound
        ? `${t.code}: ${units(t.qty)} sent to ${t.to}. ${t.status === "received" ? "Received at the destination, so the ledger moved them." : "No transfer-in at the destination yet; the units stay booked here until it is scanned in."}`
        : `${t.code}: ${units(t.qty)} sent here from ${t.from}${t.status === "received" ? " and scanned in." : ", not yet scanned in."}`,
      values: { qty: t.qty, status: t.status },
    });
  }
  for (const c of counts) {
    if (trusted && c.id === trusted.id) continue;
    events.push({
      type: "count", id: c.id, code: c.code, label: "Physical count", at: c.at, delta: null, balance: null, actor: c.actor,
      detail: `${c.code} (${c.scope}): ${units(c.counted)} counted on the shelf; ${units(c.recorded)} on record at that moment.`,
      values: { counted: c.counted, recorded: c.recorded },
    });
  }
  for (const r of reservations) {
    if (r.status === "released" && r.note) {
      events.push({ type: "reservation", id: r.id, code: `RES-${r.id}`, label: "Reservation released", at: r.updatedAt, delta: null, balance: null, actor: null, detail: `${units(r.qty)} for ${r.orderCode} released: ${r.note}.` });
    }
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.delta === null ? 1 : 0) - (b.delta === null ? 1 : 0));
  return { since, start, startLedger, events, recordedAtEnd: running, picks, transfers, counts, reservations };
}
