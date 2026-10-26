// StockSleuth: checks that recorded stock agrees with physical counts, with
// its own movement history and with the reservations, picks, transfers and
// returns around it. Facts are what the records say; anything about where the
// goods actually are is an inference or a hypothesis for a person to verify.

import { q } from "../../db/client.ts";
import { DAY, rupees, units } from "../format.ts";
import { reconstruct } from "../stockrecords.ts";
import type { Draft, EvidenceRef } from "./types.ts";

const TRANSFER_GRACE = 2 * 3_600_000;
const RETURN_GRACE = 2 * 3_600_000;
const PICK_GRACE = DAY;

const key = (variantId: number, locationId: number) => `stock:${variantId}:${locationId}`;

interface Place { variantId: number; locationId: number; sku: string; location: string; unitCost: number; homeLocationId: number }

function base(p: Place, rule: string, fp: string, at: Date) {
  return {
    caseKey: key(p.variantId, p.locationId), subject: { type: "stock", id: p.variantId, code: `${p.sku} @ ${p.location}` }, module: "stocksleuth" as const,
    rule, version: 1, fingerprint: `${rule}:${fp}`, at,
  };
}

const PLACE = `v.id AS "variantId", l.id AS "locationId", v.sku, l.code AS location, p.unit_cost AS "unitCost", v.home_location_id AS "homeLocationId"`;

export async function stockSleuthDrafts(businessId: number, now: Date): Promise<Draft[]> {
  const out: Draft[] = [];

  // ---- picked or reserved units on closed orders ----
  const held = await q<Place & { reservationId: number; qty: number; status: string; orderId: number; orderCode: string; orderStatus: string; closedAt: Date | null; pickedAt: Date | null; pickCode: string | null; pickId: number | null; picker: string | null; reservedAt: Date; cancelledBy: string | null }>(
    `SELECT ${PLACE}, r.id AS "reservationId", r.qty, r.status, o.id AS "orderId", o.code AS "orderCode", o.status AS "orderStatus",
            COALESCE(o.cancelled_at, o.completed_at) AS "closedAt", pli.picked_at AS "pickedAt", pl.code AS "pickCode", pl.id AS "pickId", u.name AS picker,
            r.created_at AS "reservedAt",
            (SELECT u2.name FROM audit_events a JOIN users u2 ON u2.id = a.actor_user_id WHERE a.entity_type = 'order' AND a.entity_id = o.id AND a.action = 'order.cancelled' LIMIT 1) AS "cancelledBy"
       FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id JOIN orders o ON o.id = oi.order_id
       JOIN product_variants v ON v.id = r.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = r.location_id
       LEFT JOIN pick_list_items pli ON pli.reservation_id = r.id AND pli.qty_picked > 0 LEFT JOIN pick_lists pl ON pl.id = pli.pick_list_id
       LEFT JOIN users u ON u.id = pl.picked_by
      WHERE r.business_id = $1 AND r.status IN ('active', 'picked')
        AND (o.status = 'cancelled' OR (r.status = 'picked' AND pli.picked_at < $2))`,
    businessId, new Date(now.getTime() - PICK_GRACE),
  );
  for (const h of held) {
    const pickEv: EvidenceRef | null = h.pickId ? { type: "pick_list", id: h.pickId, code: h.pickCode!, label: "Order picked", detail: `${h.pickCode} records ${units(h.qty)} of ${h.sku} picked from ${h.location}${h.picker ? ` by ${h.picker}` : ""} for ${h.orderCode}.`, at: h.pickedAt! } : null;
    const orderEv: EvidenceRef = h.orderStatus === "cancelled" && h.closedAt
      ? { type: "order", id: h.orderId, code: h.orderCode, label: "Order cancelled", detail: `${h.orderCode} cancelled${h.cancelledBy ? ` by ${h.cancelledBy}` : ""}; nothing was dispatched.`, at: h.closedAt }
      : { type: "order", id: h.orderId, code: h.orderCode, label: "Order open", detail: `${h.orderCode} is ${h.orderStatus}.`, at: h.reservedAt };
    const resEv: EvidenceRef = { type: "reservation", id: h.reservationId, code: `RES-${h.reservationId}`, label: "Stock reserved, still held", detail: `${units(h.qty)} of ${h.sku} at ${h.location} still ${h.status} for ${h.orderCode}.`, at: h.reservedAt };
    if (h.orderStatus === "cancelled") {
      out.push({
        ...base(h, "SS-STALE", `${h.reservationId}:${h.qty}:${h.status}`, h.closedAt ?? now),
        kind: "fact", certainty: "verified", priority: "medium", rank: 12,
        caseTitle: `Stale reservation on ${h.sku} at ${h.location}`,
        title: `${units(h.qty)} still reserved for cancelled order ${h.orderCode}`,
        detail: `The reservation was not released when ${h.orderCode} was cancelled, so ${units(h.qty)} of free stock is hidden from new orders and from purchasing.`,
        expected: 0, actual: h.qty, unit: "units",
        evidence: [orderEv, resEv], checks: [`Release the reservation for ${h.orderCode}`],
      });
      out.push({
        ...base(h, "OT-STATUS", `cancelled-held:${h.reservationId}:${h.qty}`, h.closedAt ?? now),
        module: "ordertrace", kind: "fact", certainty: "verified", priority: "low", rank: 50, context: true,
        title: `${h.orderCode} is cancelled with no shipment or invoice`,
        detail: `The commercial records agree the order was cancelled; only the stock side was left open.`, evidence: [orderEv],
      });
    }
    if (h.status === "picked" && pickEv) {
      out.push({
        ...base(h, "SS-PICK", `${h.reservationId}:${h.qty}`, h.orderStatus === "cancelled" ? (h.closedAt ?? now) : new Date(h.pickedAt!.getTime() + PICK_GRACE)),
        kind: "fact", certainty: "verified", priority: "medium", rank: 11,
        caseTitle: `Picked stock not dispatched: ${h.sku} at ${h.location}`,
        title: `${units(h.qty)} picked for ${h.orderCode}, neither dispatched nor put back`,
        detail: `Picking doesn't change on-hand in RackPilot, so these units are still recorded at ${h.location}. If they left the bin they are likely in the packing area.`,
        expected: 0, actual: h.qty, unit: "units", evidence: [pickEv, orderEv],
        checks: [`Look in the packing area for ${units(h.qty)} of ${h.sku} labelled ${h.orderCode}`, "Put them back on the bin and release the reservation"],
        missing: ["Packing-area check"],
      });
    }
  }

  // ---- transfers sent and not received ----
  const open = await q<Place & { transferId: number; code: string; qty: number; qtyReceived: number | null; status: string; sentAt: Date; receivedAt: Date | null; to: string; toId: number; by: string | null; note: string | null }>(
    `SELECT ${PLACE}, t.id AS "transferId", t.code, ti.qty_sent AS qty, ti.qty_received AS "qtyReceived", t.status, t.sent_at AS "sentAt", t.received_at AS "receivedAt",
            lt.code AS to, lt.id AS "toId", u.name AS by, t.note
       FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id JOIN product_variants v ON v.id = ti.variant_id JOIN products p ON p.id = v.product_id
       JOIN locations l ON l.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id LEFT JOIN users u ON u.id = t.sent_by
      WHERE t.business_id = $1 AND ((t.status = 'sent' AND t.sent_at < $2) OR (t.status = 'received' AND ti.qty_received < ti.qty_sent))`,
    businessId, new Date(now.getTime() - TRANSFER_GRACE),
  );
  for (const t of open) {
    const missing = t.qty - (t.qtyReceived ?? 0);
    const sent: EvidenceRef = { type: "transfer", id: t.transferId, code: t.code, label: "Transfer out recorded", detail: `${t.code}: ${units(t.qty)} of ${t.sku} sent from ${t.location} to ${t.to}${t.by ? ` by ${t.by}` : ""}${t.note ? ` (${t.note})` : ""}.`, at: t.sentAt };
    out.push({
      ...base(t, "SS-TRF", `${t.transferId}:${t.status}:${t.qtyReceived ?? 0}`, t.status === "sent" ? new Date(t.sentAt.getTime() + TRANSFER_GRACE) : t.receivedAt!),
      kind: "fact", certainty: "verified", priority: "medium", rank: 10,
      caseTitle: `Transfer ${t.code} not received at ${t.to}`,
      title: t.status === "sent" ? `${t.code}: transfer-out recorded, no matching transfer-in` : `${t.code}: ${units(missing)} sent but not received`,
      detail: t.status === "sent"
        ? `${units(t.qty)} left ${t.location} on paper but ${t.to} never scanned them in. Stock stays booked at ${t.location} until it is, so that bin's record includes ${units(t.qty)} that may have left.`
        : `${t.to} scanned in ${units(t.qtyReceived ?? 0)} of the ${units(t.qty)} sent.`,
      expected: t.qty, actual: t.qtyReceived ?? 0, unit: "units",
      evidence: [sent],
      checks: [`Check ${t.to} for ${units(missing)} of ${t.sku}`, `If they are there, receive ${t.code} at the destination`, "Check the transfer paperwork with the person who sent it"],
      missing: [`Transfer-in scan at ${t.to}`],
    });
  }

  // ---- resellable returns not restocked ----
  const rets = await q<Place & { returnId: number; code: string; qty: number; restocked: number; at: Date; orderCode: string; creditCode: string | null }>(
    `SELECT ${PLACE}, r.id AS "returnId", r.code, ri.qty, ri.restocked_qty AS restocked, r.received_at AS at, o.code AS "orderCode",
            (SELECT i.code FROM invoices i WHERE i.order_id = o.id AND i.kind = 'credit_note' AND i.issued_at >= r.received_at ORDER BY i.issued_at LIMIT 1) AS "creditCode"
       FROM return_items ri JOIN returns r ON r.id = ri.return_id JOIN orders o ON o.id = r.order_id JOIN product_variants v ON v.id = ri.variant_id
       JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = COALESCE(ri.location_id, v.home_location_id)
      WHERE r.business_id = $1 AND ri.condition = 'resellable' AND ri.restocked_qty < ri.qty AND r.received_at < $2
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.business_id = r.business_id AND m.ref_type = 'return' AND m.ref_id = r.id AND m.variant_id = ri.variant_id)`,
    businessId, new Date(now.getTime() - RETURN_GRACE),
  );
  for (const r of rets) {
    const ev: EvidenceRef[] = [{ type: "return", id: r.returnId, code: r.code, label: "Return received", detail: `${r.code}: ${units(r.qty)} of ${r.sku} back from ${r.orderCode}, marked resellable.`, at: r.at }];
    out.push({
      ...base(r, "SS-RET", `${r.returnId}:${r.qty - r.restocked}`, new Date(r.at.getTime() + RETURN_GRACE)),
      kind: "fact", certainty: "verified", priority: "medium", rank: 10,
      caseTitle: `Return ${r.code} not restocked: ${r.sku}`,
      title: `${units(r.qty - r.restocked)} returned as resellable, never restocked`,
      detail: `${r.code} was received${r.creditCode ? ` and credited on ${r.creditCode}` : ""}, but no return movement put the units back on ${r.location}. They are physically here and missing from the record.`,
      expected: r.qty, actual: r.restocked, unit: "units", evidence: ev,
      checks: [`Find the ${units(r.qty)} returned pieces (receiving bay or ${r.location})`, `Restock ${r.code} to ${r.location}`],
    });
  }

  // ---- movements that look posted twice ----
  const dup = await q<Place & { a: number; b: number; type: string; qty: number; refCode: string | null; refType: string | null; refId: number | null; at: Date }>(
    `SELECT ${PLACE}, m1.id AS a, m2.id AS b, m1.type, m1.qty, m1.ref_code AS "refCode", m1.ref_type AS "refType", m1.ref_id AS "refId", m2.created_at AS at
       FROM stock_movements m1 JOIN stock_movements m2 ON m2.business_id = m1.business_id AND m2.variant_id = m1.variant_id AND m2.location_id = m1.location_id
        AND m2.type = m1.type AND m2.qty = m1.qty AND m2.id > m1.id AND m2.ref_type IS NOT DISTINCT FROM m1.ref_type AND m2.ref_id IS NOT DISTINCT FROM m1.ref_id
        AND m2.created_at - m1.created_at < interval '10 minutes'
       JOIN product_variants v ON v.id = m1.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = m1.location_id
      WHERE m1.business_id = $1 AND m1.type IN ('receipt', 'transfer_in', 'transfer_out', 'adjustment', 'customer_return')`,
    businessId,
  );
  for (const d of dup) {
    const label = d.type === "receipt" ? "Stock received" : d.type;
    out.push({
      ...base(d, "SS-DUP", `${d.a}:${d.b}`, d.at),
      kind: "inference", certainty: "likely", priority: Math.abs(d.qty) >= 10 ? "high" : "medium", rank: 8,
      caseTitle: `Possible duplicate ${d.type.replace("_", " ")} on ${d.sku}`,
      title: `${d.refCode ?? "A movement"} appears to be posted twice (${d.qty > 0 ? "+" : ""}${d.qty} each)`,
      detail: `Two identical ${d.type.replace("_", " ")} movements for ${d.sku} at ${d.location} under the same reference, under ten minutes apart. If only one delivery happened, recorded stock is overstated by ${units(Math.abs(d.qty))}.`,
      expected: d.qty, actual: d.qty * 2, unit: "units",
      calculation: `Posted ${d.qty} + ${d.qty}; ${d.refCode ?? "the reference"} supports one`,
      evidence: [
        { type: "stock_movement", id: d.a, code: d.refCode ?? `MOV-${d.a}`, label, detail: `Movement #${d.a}: ${d.qty > 0 ? "+" : ""}${d.qty} at ${d.location}.`, at: new Date(d.at.getTime() - 60_000) },
        { type: "stock_movement", id: d.b, code: d.refCode ?? `MOV-${d.b}`, label: `${label} again`, detail: `Movement #${d.b}: the same ${d.qty > 0 ? "+" : ""}${d.qty} under the same reference.`, at: d.at },
      ],
      checks: [`Compare ${d.refCode ?? "the reference"} with the supplier's delivery note`, `Count ${d.sku} at ${d.location}`, "Reverse the duplicate with a compensating movement once confirmed"],
      missing: ["Supplier delivery note", `Count of ${d.location}`],
    });
  }

  // ---- manual adjustments without a count behind them ----
  const adj = await q<Place & { n: number; total: number; ids: number[]; last: Date; actors: string }>(
    `SELECT ${PLACE}, COUNT(*)::int AS n, SUM(m.qty)::int AS total, array_agg(m.id ORDER BY m.created_at) AS ids, MAX(m.created_at) AS last,
            string_agg(DISTINCT COALESCE(u.name, 'system'), ', ') AS actors
       FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = m.location_id
       LEFT JOIN users u ON u.id = m.actor_user_id
      WHERE m.business_id = $1 AND m.type = 'adjustment' AND m.ref_type IS NULL AND m.created_at > $2
      GROUP BY v.id, l.id, p.unit_cost HAVING COUNT(*) >= 3 OR SUM(ABS(m.qty)) >= 10`,
    businessId, new Date(now.getTime() - 14 * DAY),
  );
  for (const a of adj) {
    const moves = await q<{ id: number; qty: number; at: Date; reason: string | null; actor: string | null }>(
      `SELECT m.id, m.qty, m.created_at AS at, m.reason, u.name AS actor FROM stock_movements m LEFT JOIN users u ON u.id = m.actor_user_id WHERE m.id = ANY($1::int[]) ORDER BY m.created_at`,
      a.ids,
    );
    out.push({
      ...base(a, "SS-ADJ", `${a.ids.join("-")}`, a.last),
      kind: "fact", certainty: "verified", priority: "medium", rank: 10,
      caseTitle: `Repeated manual adjustments on ${a.sku}`,
      title: `${a.n} manual adjustments in 14 days, ${a.total > 0 ? "+" : ""}${a.total} in total`,
      detail: `None references a count or an investigation, so nothing records why stock was ${a.total < 0 ? "written down" : "added"} (${rupees(Math.abs(a.total) * a.unitCost)} at cost).`,
      expected: 0, actual: a.total, unit: "units",
      evidence: moves.map((m) => ({ type: "stock_movement", id: m.id, code: `MOV-${m.id}`, label: "Manual adjustment", detail: `${m.qty > 0 ? "+" : ""}${m.qty}${m.actor ? ` by ${m.actor}` : ""}${m.reason ? `: "${m.reason}"` : ""}.`, at: m.at })),
      checks: [`Count ${a.sku} at ${a.location}`, `Ask ${a.actors} what each adjustment was for`, "Adjust only through an investigation from now on"],
      missing: ["Count sheets for each adjustment"],
    });
  }

  // ---- stored balances against the ledger and the reservations ----
  const ledger = await q<Place & { onHand: number; ledger: number; reserved: number; held: number; updatedAt: Date; lastMove: Date | null }>(
    `SELECT ${PLACE}, b.on_hand AS "onHand", COALESCE(m.sum, 0)::int AS ledger, b.reserved, COALESCE(r.held, 0)::int AS held, b.updated_at AS "updatedAt", m.last AS "lastMove"
       FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = b.location_id
       LEFT JOIN (SELECT variant_id, location_id, SUM(qty) AS sum, MAX(created_at) AS last FROM stock_movements WHERE business_id = $1 GROUP BY 1, 2) m
              ON m.variant_id = b.variant_id AND m.location_id = b.location_id
       LEFT JOIN (SELECT variant_id, location_id, SUM(qty) AS held FROM reservations WHERE business_id = $1 AND status IN ('active', 'picked') GROUP BY 1, 2) r
              ON r.variant_id = b.variant_id AND r.location_id = b.location_id
      WHERE b.business_id = $1 AND (b.on_hand <> COALESCE(m.sum, 0) OR b.reserved <> COALESCE(r.held, 0))`,
    businessId,
  );
  for (const l of ledger) {
    const onHandOff = l.onHand !== l.ledger;
    out.push({
      ...base(l, "SS-LEDGER", `${l.onHand}:${l.ledger}:${l.reserved}:${l.held}`, l.updatedAt),
      kind: "fact", certainty: "verified", priority: "high", rank: 6,
      caseTitle: `Ledger inconsistency on ${l.sku} at ${l.location}`,
      title: onHandOff ? `Stored balance ${l.onHand}, movement history ${l.ledger}` : `Stored reserved ${l.reserved}, reservations ${l.held}`,
      detail: onHandOff
        ? `The balance changed by ${l.onHand - l.ledger > 0 ? "+" : ""}${l.onHand - l.ledger} without a stock movement, which only a direct edit or a failed write can do. The ledger is the record of truth; the balance is not.`
        : "The stored reserved quantity differs from the sum of active reservations.",
      expected: onHandOff ? l.ledger : l.held, actual: onHandOff ? l.onHand : l.reserved, unit: "units",
      calculation: onHandOff ? `${l.onHand} stored − ${l.ledger} from movements = ${l.onHand - l.ledger}` : `${l.reserved} stored − ${l.held} held by reservations = ${l.reserved - l.held}`,
      evidence: [{ type: "balance", id: l.variantId, code: `${l.sku} @ ${l.location}`, label: "Balance changed outside the ledger", detail: `Balance last written ${l.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC; last movement ${l.lastMove ? l.lastMove.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "none"}.`, at: l.updatedAt }],
      checks: [`Count ${l.sku} at ${l.location}`, "Rebuild the balance from the ledger once the count confirms which is right"],
    });
  }

  // ---- negative balances when the ledger is replayed in time order ----
  const neg = await q<Place & { minBalance: number; at: Date }>(
    `SELECT ${PLACE}, x.min_balance AS "minBalance", x.at FROM (
       SELECT variant_id, location_id, MIN(running) AS min_balance, (array_agg(created_at ORDER BY running, created_at))[1] AS at FROM (
         SELECT variant_id, location_id, created_at, SUM(qty) OVER (PARTITION BY variant_id, location_id ORDER BY created_at, id) AS running
           FROM stock_movements WHERE business_id = $1) s
       GROUP BY variant_id, location_id HAVING MIN(running) < 0) x
     JOIN product_variants v ON v.id = x.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = x.location_id`,
    businessId,
  );
  for (const n of neg) {
    out.push({
      ...base(n, "SS-NEG", `${n.minBalance}:${n.at.getTime()}`, n.at),
      kind: "fact", certainty: "verified", priority: "medium", rank: 9,
      caseTitle: `Negative stock in the history of ${n.sku}`,
      title: `Replayed in time order, the balance falls to ${n.minBalance}`,
      detail: "A movement was recorded with a time before the stock it used existed, usually a back-dated entry. The current balance may be right, but the history around that time is not.",
      expected: 0, actual: n.minBalance, unit: "units",
      evidence: [{ type: "stock_movement", id: 0, code: `${n.sku} @ ${n.location}`, label: "Balance below zero", detail: `Running balance ${n.minBalance}.`, at: n.at }],
      checks: ["Find the back-dated movement and confirm its real date"],
    });
  }

  // ---- counts: the latest count per variant and location ----
  const counts = await q<Place & { countId: number; code: string; at: Date; recorded: number; counted: number; by: string | null; scope: string; balance: number | null }>(
    `SELECT DISTINCT ON (cl.variant_id, cl.location_id) ${PLACE}, c.id AS "countId", c.code, c.counted_at AS at, cl.recorded_qty AS recorded,
            cl.counted_qty AS counted, u.name AS by, c.scope, b.on_hand AS balance
       FROM stock_count_lines cl JOIN physical_stock_counts c ON c.id = cl.count_id JOIN product_variants v ON v.id = cl.variant_id
       JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = cl.location_id LEFT JOIN users u ON u.id = c.counted_by
       LEFT JOIN inventory_balances b ON b.variant_id = cl.variant_id AND b.location_id = cl.location_id
      WHERE c.business_id = $1 ORDER BY cl.variant_id, cl.location_id, c.counted_at DESC, cl.id DESC`,
    businessId,
  );
  const settled = await q<{ variantId: number; locationId: number; countId: number | null; investigationId: number | null; qty: number; at: Date }>(
    `SELECT variant_id AS "variantId", location_id AS "locationId", CASE WHEN ref_type = 'count' THEN ref_id END AS "countId",
            CASE WHEN ref_type = 'investigation' THEN ref_id END AS "investigationId", qty, created_at AS at
       FROM stock_movements WHERE business_id = $1 AND type = 'adjustment' AND ref_type IN ('count', 'investigation')`,
    businessId,
  );
  for (const c of counts) {
    const adjusted = settled.filter((s) => s.variantId === c.variantId && s.locationId === c.locationId && s.at > c.at).reduce((a, s) => a + s.qty, 0);
    const variance = c.counted - c.recorded;
    if (variance - adjusted === 0) continue;
    const countEv: EvidenceRef = { type: "count", id: c.countId, code: c.code, label: "Physical count", detail: `${c.code} (${c.scope}): ${units(c.counted)} counted on the shelf${c.by ? ` by ${c.by}` : ""}; ${units(c.recorded)} on record at that moment.`, at: c.at, values: { counted: c.counted, recorded: c.recorded } };
    if (c.recorded === 0 && c.locationId !== c.homeLocationId) {
      const home = await q<{ code: string }>(`SELECT code FROM locations WHERE id = $1`, c.homeLocationId);
      out.push({
        ...base(c, "SS-LOC", `${c.countId}:${c.variantId}:${c.locationId}:${c.counted}`, c.at),
        caseKey: key(c.variantId, c.homeLocationId), subject: { type: "stock", id: c.variantId, code: `${c.sku} @ ${home[0]?.code}` },
        kind: "fact", certainty: "verified", priority: "medium", rank: 4,
        caseTitle: `${c.sku} found outside its bin`,
        title: `${units(c.counted)} of ${c.sku} counted at ${c.location}, where none is recorded`,
        detail: `${c.sku} belongs at ${home[0]?.code}. Stock at ${c.location} was moved there without a transfer.`,
        expected: 0, actual: c.counted, unit: "units", evidence: [countEv],
        checks: [`Move the ${units(c.counted)} back to ${home[0]?.code} with a transfer, or record why they belong at ${c.location}`],
      });
      continue;
    }
    const residual = variance - adjusted;
    const value = Math.abs(residual) * c.unitCost;
    const recon = await reconstruct(businessId, c.variantId, c.locationId, c.at, { from: new Date(c.at.getTime() - 30 * 3_600_000) });
    const timeline: EvidenceRef[] = recon.events.filter((e) => !(e.type === "count" && e.id === c.countId)).map((e) => ({ type: e.type, id: e.id, code: e.code, label: e.label, detail: e.detail, at: e.at }));
    const ledgerAtCount = recon.recordedAtEnd;
    out.push({
      ...base(c, "SS-COUNT", `${c.countId}:${c.variantId}:${c.locationId}:${c.recorded}:${c.counted}:${adjusted}`, c.at),
      kind: "fact", certainty: "verified", priority: Math.abs(residual) >= 5 || value >= 1000 ? "high" : "medium", rank: 1,
      caseTitle: `Stock variance on ${c.sku} at ${c.location}: ${residual > 0 ? "+" : ""}${residual} units`,
      title: `Recorded ${c.recorded}, counted ${c.counted}: ${residual > 0 ? "+" : ""}${residual} units unexplained`,
      detail: `Same SKU, same location (${c.location}), compared at the moment of the count. The variance is a discrepancy, not proof of loss.`,
      expected: c.recorded, actual: c.counted, unit: "units",
      calculation: `${c.counted} counted − ${c.recorded} recorded = ${variance}${adjusted ? `; ${adjusted > 0 ? "+" : ""}${adjusted} already adjusted` : ""}; ${rupees(value)} at cost`,
      exceptions: [
        `Count time checked: ${c.code} at ${c.at.toISOString().slice(11, 16)} UTC, against the balance at that moment`,
        ledgerAtCount === c.recorded ? `Ledger replay agrees with the recorded ${c.recorded}` : `Ledger replay gives ${ledgerAtCount}, not ${c.recorded}`,
      ],
      evidence: [...timeline, countEv],
      checks: [`Recount ${c.location} before approving any adjustment`],
    });
    out.push(...(await coverage(businessId, c, residual, counts)));
  }
  return out;
}

/**
 * Which records were in flight at the moment of a count and could explain its
 * variance: picks not yet dispatched, transfers sent and not yet scanned in,
 * receipts posted twice, the same SKU counted in another bin, returns not yet
 * restocked. Judged as of the count, so a later correction doesn't change it.
 * It stays an inference: someone still has to find the goods.
 */
async function coverage(businessId: number, c: Place & { countId: number; at: Date }, residual: number, counts: (Place & { countId: number; recorded: number; counted: number })[]): Promise<Draft[]> {
  const parts: { qty: number; text: string }[] = [];
  if (residual < 0) {
    const picks = await q<{ qty: number; orderCode: string }>(
      `SELECT pli.qty_picked AS qty, o.code AS "orderCode" FROM pick_list_items pli JOIN reservations r ON r.id = pli.reservation_id
         JOIN pick_lists pl ON pl.id = pli.pick_list_id JOIN orders o ON o.id = pl.order_id
        WHERE pl.business_id = $1 AND pli.variant_id = $2 AND pli.location_id = $3 AND pli.qty_picked > 0 AND pli.picked_at < $4
          AND (r.status = 'picked' OR r.updated_at > $4)`,
      businessId, c.variantId, c.locationId, c.at,
    );
    for (const p of picks) parts.push({ qty: p.qty, text: `${units(p.qty)} picked for ${p.orderCode} and not dispatched at the time of the count, likely in the packing area` });
    const sent = await q<{ qty: number; code: string; to: string }>(
      `SELECT ti.qty_sent AS qty, t.code, lt.code AS to FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id JOIN locations lt ON lt.id = t.to_location_id
        WHERE t.business_id = $1 AND ti.variant_id = $2 AND t.from_location_id = $3 AND t.sent_at < $4 AND t.status <> 'cancelled' AND (t.received_at IS NULL OR t.received_at > $4)`,
      businessId, c.variantId, c.locationId, c.at,
    );
    for (const t of sent) parts.push({ qty: t.qty, text: `${units(t.qty)} sent on ${t.code} to ${t.to} and not scanned in at the time of the count` });
    const dups = await q<{ qty: number; code: string | null }>(
      `SELECT m2.qty, m2.ref_code AS code FROM stock_movements m1 JOIN stock_movements m2 ON m2.variant_id = m1.variant_id AND m2.location_id = m1.location_id AND m2.type = m1.type
          AND m2.qty = m1.qty AND m2.id > m1.id AND m2.ref_type IS NOT DISTINCT FROM m1.ref_type AND m2.ref_id IS NOT DISTINCT FROM m1.ref_id AND m2.created_at - m1.created_at < interval '10 minutes'
        WHERE m1.business_id = $1 AND m1.variant_id = $2 AND m1.location_id = $3 AND m1.type = 'receipt' AND m2.created_at < $4`,
      businessId, c.variantId, c.locationId, c.at,
    );
    for (const d of dups) parts.push({ qty: d.qty, text: `${units(d.qty)} from ${d.code ?? "a receipt"} that looks posted twice` });
    for (const other of counts.filter((x) => x.countId === c.countId && x.variantId === c.variantId && x.locationId !== c.locationId && x.recorded === 0 && x.counted > 0)) {
      parts.push({ qty: other.counted, text: `${units(other.counted)} counted in ${other.location} in the same count` });
    }
  } else {
    const rets = await q<{ qty: number; code: string }>(
      `SELECT ri.qty - ri.restocked_qty AS qty, r.code FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE r.business_id = $1 AND ri.variant_id = $2 AND COALESCE(ri.location_id, $3) = $3 AND ri.condition = 'resellable' AND r.received_at < $4
          AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.ref_type = 'return' AND m.ref_id = r.id AND m.variant_id = ri.variant_id AND m.created_at < $4)`,
      businessId, c.variantId, c.locationId, c.at,
    );
    for (const r of rets) parts.push({ qty: r.qty, text: `${units(r.qty)} returned on ${r.code} and not restocked at the time of the count` });
  }
  const gap = Math.abs(residual);
  const found = parts.reduce((a, p) => a + p.qty, 0);
  const covered = Math.min(found, gap);
  const fp = `${c.countId}:${c.variantId}:${c.locationId}`;
  const shared = { ...base(c, "SS-COUNT", "", c.at), priority: "low" as const, evidence: [] };
  const out: Draft[] = [];
  if (parts.length) {
    out.push({
      ...shared, fingerprint: `SS-COUNT:coverage:${fp}:${parts.map((p) => p.qty).join("+")}`, kind: "inference", certainty: covered === gap ? "likely" : "possible", rank: 30,
      title: `Open records could account for ${covered} of the ${gap} units`,
      detail: `${parts.map((p) => p.text).join("; ")}. None of this is verified until someone finds the goods.`,
      calculation: `${parts.map((p) => p.qty).join(" + ")} = ${found} of ${gap}`,
    });
  }
  if (covered < gap) {
    out.push({
      ...shared, fingerprint: `SS-COUNT:unexplained:${fp}:${gap - covered}`, kind: "hypothesis", certainty: "possible", rank: 40,
      title: `${units(gap - covered)} not explained by any record`,
      detail: "Possible causes: a counting error, damage removed without a write-off, goods in an uncounted location, or loss. The records cannot tell these apart.",
      missing: ["A second count by a different person"],
    });
  }
  return out;
}

/**
 * The stock-side view of an order an OrderTrace finding is about: did what
 * the ledger says left the warehouse match what the shipments say?
 */
export async function stockSideOfOrder(businessId: number, orderId: number, orderCode: string): Promise<Draft[]> {
  const rows = await q<{ itemId: number; sku: string; reserved: number; picked: number; consumed: number; shipped: number; dispatched: number; locations: string | null; lastAt: Date | null; released: number; releaseNote: string | null; flagged: string | null }>(
    `SELECT oi.id AS "itemId", v.sku,
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status <> 'released'), 0)::int AS reserved,
            COALESCE((SELECT SUM(pli.qty_picked) FROM pick_list_items pli JOIN reservations r ON r.id = pli.reservation_id WHERE r.order_item_id = oi.id), 0)::int AS picked,
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'consumed'), 0)::int AS consumed,
            COALESCE((SELECT SUM(qty) FROM shipment_items si WHERE si.order_item_id = oi.id), 0)::int AS shipped,
            COALESCE((SELECT -SUM(m.qty) FROM stock_movements m JOIN shipments s ON s.id = m.ref_id AND m.ref_type = 'shipment' WHERE s.order_id = oi.order_id AND m.variant_id = oi.variant_id), 0)::int AS dispatched,
            (SELECT string_agg(DISTINCT l.code, ', ') FROM stock_movements m JOIN shipments s ON s.id = m.ref_id AND m.ref_type = 'shipment' JOIN locations l ON l.id = m.location_id WHERE s.order_id = oi.order_id AND m.variant_id = oi.variant_id) AS locations,
            (SELECT MAX(m.created_at) FROM stock_movements m JOIN shipments s ON s.id = m.ref_id AND m.ref_type = 'shipment' WHERE s.order_id = oi.order_id AND m.variant_id = oi.variant_id) AS "lastAt",
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'released'), 0)::int AS released,
            (SELECT r.note FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'released' AND r.note IS NOT NULL LIMIT 1) AS "releaseNote",
            (SELECT b.verification_note FROM inventory_balances b JOIN reservations r ON r.variant_id = b.variant_id AND r.location_id = b.location_id
              WHERE r.order_item_id = oi.id AND b.needs_verification LIMIT 1) AS flagged
       FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE oi.order_id = $1 AND oi.business_id = $2 ORDER BY oi.id`,
    orderId, businessId,
  );
  const out: Draft[] = [];
  for (const r of rows) {
    const common = { caseKey: `order:${orderId}`, subject: { type: "order", id: orderId, code: orderCode }, module: "stocksleuth" as const, version: 1, context: true, at: r.lastAt ?? new Date(), evidence: [] };
    if (r.shipped > 0 && r.dispatched === r.shipped && r.consumed === r.shipped) {
      out.push({
        ...common, rule: "SS-PICK", fingerprint: `SS-PICK:order-agrees:${r.itemId}:${r.shipped}`, kind: "fact", certainty: "verified", priority: "low", rank: 20,
        title: `Stock records agree with the dispatch: ${units(r.shipped)} of ${r.sku} left the warehouse`,
        detail: `${units(r.reserved)} reserved, ${units(r.picked)} picked and ${units(r.dispatched)} booked out of ${r.locations} by dispatch movements. On the stock side, the units left as shipped.`,
      });
    } else if (r.shipped > 0 && r.dispatched !== r.shipped) {
      out.push({
        ...common, rule: "SS-PICK", fingerprint: `SS-PICK:order-differs:${r.itemId}:${r.shipped}:${r.dispatched}`, kind: "fact", certainty: "verified", priority: "medium", rank: 20,
        title: `Ledger books out ${units(r.dispatched)} of ${r.sku}; shipments say ${units(r.shipped)}`,
        detail: "The stock ledger and the shipment records disagree on what left the warehouse.",
      });
    }
    if (r.released > 0 && r.releaseNote && /could not find|not found|missing/i.test(r.releaseNote)) {
      out.push({
        ...common, rule: "SS-LOC", fingerprint: `SS-LOC:order-notfound:${r.itemId}:${r.released}`, kind: "fact", certainty: "verified", priority: "medium", rank: 21,
        title: `Picker could not find ${units(r.released)} of ${r.sku}`,
        detail: `The reservation was released ("${r.releaseNote}")${r.flagged ? ` and the bin is flagged for verification: ${r.flagged}` : ""}. Recorded stock for that bin is unconfirmed.`,
      });
    }
  }
  return out;
}
