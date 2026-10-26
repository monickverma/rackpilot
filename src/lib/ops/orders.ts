// The order workflow: confirm (validate and reserve), decide on shortages,
// pick by location, dispatch, cancel. Every stock change goes through
// ops/stock.ts. Status is recomputed from the records, never typed in, except
// for an explicit owner or accounts action, which is audited.

import { one, q, run, tx } from "../../db/client.ts";
import type { OrderStatus } from "../../db/schema.ts";
import { audit, DomainError, need, NotFoundError, nowOf, type Ctx } from "../context.ts";
import { DAY, units } from "../format.ts";
import { nextCode, post, releaseReservation, reserveItem } from "./stock.ts";

export interface NewOrderLine {
  variantId: number;
  qty: number;
  unitPrice?: number | null;
  sourceText?: string | null;
  matchNote?: string | null;
}

export interface NewOrder {
  customerId: number;
  channel: "message" | "voice" | "document" | "manual" | "email";
  sourceText: string;
  extractedBy: "rules" | "claude" | "manual";
  dueAt?: Date | null;
  lines: NewOrderLine[];
}

export interface ConfirmResult {
  id: number;
  code: string;
  shortages: { orderItemId: number; sku: string; wanted: number; reserved: number; available: number; heldBy: { code: string; customer: string; qty: number }[] }[];
}

/** Validates the lines and reserves what is free, in one transaction. Short lines wait for the owner's decision. */
export async function confirmOrder(ctx: Ctx, input: NewOrder): Promise<ConfirmResult> {
  need(ctx, "orders.write");
  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new DomainError("The order has no lines.");
  if (lines.length > 60) throw new DomainError("Orders are limited to 60 lines.");
  for (const l of lines) if (!Number.isInteger(l.qty) || l.qty > 5000) throw new DomainError("Quantities must be whole numbers up to 5,000.");
  const customer = await one<{ id: number; name: string }>(`SELECT id, name FROM customers WHERE business_id = $1 AND id = $2`, ctx.businessId, input.customerId);
  if (!customer) throw new NotFoundError("Pick a customer from this business.");
  return tx(async () => {
    const code = await nextCode(ctx, "orders", "ORD-", 4);
    const order = await one<{ id: number }>(
      `INSERT INTO orders (business_id, code, customer_id, channel, source_text, extracted_by, status, due_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9) RETURNING id`,
      ctx.businessId, code, customer.id, input.channel, input.sourceText.slice(0, 4000), input.extractedBy, input.dueAt ?? null, ctx.user.id, nowOf(ctx),
    );
    const shortages: ConfirmResult["shortages"] = [];
    for (const l of lines) {
      const v = await one<{ id: number; sku: string; price: number }>(
        `SELECT v.id, v.sku, p.unit_price AS price FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.business_id = $1 AND v.id = $2`,
        ctx.businessId, l.variantId,
      );
      if (!v) throw new DomainError("A line points at a variant this business doesn't have. Pick the variant again.");
      const item = await one<{ id: number }>(
        `INSERT INTO order_items (business_id, order_id, variant_id, qty_ordered, unit_price, source_text, match_note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        ctx.businessId, order!.id, v.id, l.qty, l.unitPrice ?? v.price, l.sourceText?.slice(0, 300) ?? null, l.matchNote?.slice(0, 500) ?? null,
      );
      const got = await reserveItem(ctx, item!.id, l.qty);
      if (got < l.qty) {
        shortages.push({ orderItemId: item!.id, sku: v.sku, wanted: l.qty, reserved: got, available: got, heldBy: await holders(ctx, v.id, order!.id) });
      }
    }
    await audit(ctx, "order.confirmed", { type: "order", id: order!.id, code }, null, { lines: lines.length, short: shortages.length });
    return { id: order!.id, code, shortages };
  });
}

/** Open orders holding a variant: who the remaining units are promised to. */
export async function holders(ctx: Ctx, variantId: number, exceptOrderId = -1) {
  return q<{ code: string; customer: string; qty: number }>(
    `SELECT o.code, c.name AS customer, SUM(r.qty)::int AS qty FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id JOIN orders o ON o.id = oi.order_id
       JOIN customers c ON c.id = o.customer_id
      WHERE r.business_id = $1 AND r.variant_id = $2 AND r.status IN ('active', 'picked') AND o.id <> $3
      GROUP BY o.id, c.name ORDER BY MIN(r.created_at)`,
    ctx.businessId, variantId, exceptOrderId,
  );
}

async function requireOrder(ctx: Ctx, orderId: number) {
  const o = await one<{ id: number; code: string; status: OrderStatus; customerId: number }>(
    `SELECT id, code, status, customer_id AS "customerId" FROM orders WHERE business_id = $1 AND id = $2 FOR UPDATE`,
    ctx.businessId, orderId,
  );
  if (!o) throw new NotFoundError("Order not found.");
  return o;
}

const openItem = (i: { qtyOrdered: number; qtyCancelled: number; shipped: number; held: number }) => i.qtyOrdered - i.qtyCancelled - i.shipped - i.held;

async function itemState(orderId: number) {
  return q<{ id: number; variantId: number; sku: string; qtyOrdered: number; qtyCancelled: number; backordered: boolean; shipped: number; held: number; active: number; picked: number }>(
    `SELECT oi.id, oi.variant_id AS "variantId", v.sku, oi.qty_ordered AS "qtyOrdered", oi.qty_cancelled AS "qtyCancelled", oi.backordered,
            COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)::int AS shipped,
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked')), 0)::int AS held,
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'active'), 0)::int AS active,
            COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'picked'), 0)::int AS picked
       FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE oi.order_id = $1 ORDER BY oi.id`,
    orderId,
  );
}

/** What the owner decides for a line that couldn't be fully reserved. RackPilot never decides this itself. */
export async function decideShortage(ctx: Ctx, orderItemId: number, decision: "backorder" | "ship_partial" | "retry") {
  need(ctx, "orders.write");
  return tx(async () => {
    const item = await one<{ orderId: number }>(`SELECT order_id AS "orderId" FROM order_items WHERE business_id = $1 AND id = $2`, ctx.businessId, orderItemId);
    if (!item) throw new NotFoundError("Order line not found.");
    const order = await requireOrder(ctx, item.orderId);
    if (["completed", "cancelled"].includes(order.status)) throw new DomainError(`${order.code} is ${order.status}.`);
    const state = (await itemState(order.id)).find((i) => i.id === orderItemId)!;
    const short = openItem(state);
    if (decision === "retry") {
      const got = short > 0 ? await reserveItem(ctx, orderItemId, short) : 0;
      await audit(ctx, "order.shortage_retry", { type: "order", id: order.id, code: order.code }, null, { sku: state.sku, reserved: got });
      await refreshStatus(ctx, order.id);
      return { reserved: got, short: short - got };
    }
    if (short <= 0) throw new DomainError("This line is fully reserved; there is nothing to decide.");
    if (decision === "backorder") {
      await run(`UPDATE order_items SET backordered = true WHERE id = $1`, orderItemId);
    } else {
      await run(`UPDATE order_items SET qty_cancelled = qty_cancelled + $2, backordered = false, match_note = COALESCE(match_note || ' · ', '') || $3 WHERE id = $1`, orderItemId, short, `Customer accepted part shipment; ${short} not supplied`);
    }
    await audit(ctx, decision === "backorder" ? "order.backordered" : "order.partial_accepted", { type: "order", id: order.id, code: order.code }, null, { sku: state.sku, qty: short });
    await refreshStatus(ctx, order.id);
    return { reserved: 0, short };
  });
}

/** Tries to reserve every backordered line, oldest order first (e.g. after a delivery). */
export async function fillBackorders(ctx: Ctx, variantIds?: number[]) {
  const lines = await q<{ id: number; orderId: number }>(
    `SELECT oi.id, oi.order_id AS "orderId" FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.business_id = $1 AND oi.backordered AND o.status NOT IN ('completed', 'cancelled') AND ($2::int[] IS NULL OR oi.variant_id = ANY($2::int[]))
      ORDER BY o.created_at, oi.id`,
    ctx.businessId, variantIds ?? null,
  );
  let filled = 0;
  for (const l of lines) {
    const state = (await itemState(l.orderId)).find((i) => i.id === l.id)!;
    const short = openItem(state);
    if (short > 0) filled += await reserveItem(ctx, l.id, short);
    await refreshStatus(ctx, l.orderId);
  }
  return filled;
}

/** A pick list of everything reserved and not yet picked, in walking order. */
export async function createPickList(ctx: Ctx, orderId: number) {
  need(ctx, "warehouse.write");
  return tx(async () => {
    const order = await requireOrder(ctx, orderId);
    if (["completed", "cancelled", "dispatched"].includes(order.status)) throw new DomainError(`${order.code} is ${order.status}.`);
    const res = await q<{ id: number; variantId: number; locationId: number; qty: number }>(
      `SELECT r.id, r.variant_id AS "variantId", r.location_id AS "locationId", r.qty FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
        WHERE oi.order_id = $1 AND r.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM pick_list_items pli JOIN pick_lists pl ON pl.id = pli.pick_list_id WHERE pli.reservation_id = r.id AND pl.status = 'open')`,
      order.id,
    );
    if (!res.length) {
      const open = await one<{ id: number; code: string }>(`SELECT id, code FROM pick_lists WHERE order_id = $1 AND status = 'open' ORDER BY id DESC LIMIT 1`, order.id);
      if (open) return open;
      throw new DomainError("Nothing reserved is waiting to be picked.");
    }
    const code = await nextCode(ctx, "pick_lists", "PL-", 4);
    const pl = await one<{ id: number }>(`INSERT INTO pick_lists (business_id, code, order_id, status, created_at) VALUES ($1, $2, $3, 'open', $4) RETURNING id`, ctx.businessId, code, order.id, nowOf(ctx));
    for (const r of res) await run(`INSERT INTO pick_list_items (pick_list_id, reservation_id, variant_id, location_id, qty_to_pick) VALUES ($1, $2, $3, $4, $5)`, pl!.id, r.id, r.variantId, r.locationId, r.qty);
    await run(`UPDATE orders SET status = 'picking' WHERE id = $1`, order.id);
    await audit(ctx, "pick_list.created", { type: "pick_list", id: pl!.id, code }, null, { order: order.code });
    return { id: pl!.id, code };
  });
}

/**
 * Records what the picker took from each bin. A short pick releases the
 * missing units and flags the bin for a recount, because the record no longer
 * matches what the picker found.
 */
export async function confirmPick(ctx: Ctx, pickListId: number, lines: { lineId: number; qtyPicked: number }[]) {
  need(ctx, "warehouse.write");
  return tx(async () => {
    const pl = await one<{ id: number; code: string; orderId: number; status: string }>(`SELECT id, code, order_id AS "orderId", status FROM pick_lists WHERE business_id = $1 AND id = $2 FOR UPDATE`, ctx.businessId, pickListId);
    if (!pl) throw new NotFoundError("Pick list not found.");
    if (pl.status !== "open") throw new DomainError(`${pl.code} is ${pl.status}.`);
    const items = await q<{ id: number; reservationId: number; qtyToPick: number; qtyPicked: number | null; variantId: number; locationId: number; sku: string; location: string }>(
      `SELECT pli.id, pli.reservation_id AS "reservationId", pli.qty_to_pick AS "qtyToPick", pli.qty_picked AS "qtyPicked", pli.variant_id AS "variantId",
              pli.location_id AS "locationId", v.sku, l.code AS location
         FROM pick_list_items pli JOIN product_variants v ON v.id = pli.variant_id JOIN locations l ON l.id = pli.location_id WHERE pli.pick_list_id = $1`,
      pl.id,
    );
    const order = await one<{ code: string }>(`SELECT code FROM orders WHERE id = $1`, pl.orderId);
    for (const input of lines) {
      const it = items.find((i) => i.id === input.lineId);
      if (!it || it.qtyPicked !== null) continue;
      const qty = Math.max(0, Math.min(it.qtyToPick, Math.floor(input.qtyPicked)));
      await run(`UPDATE pick_list_items SET qty_picked = $2, picked_at = $3 WHERE id = $1`, it.id, qty, nowOf(ctx));
      if (qty === it.qtyToPick) {
        await run(`UPDATE reservations SET status = 'picked', updated_at = $2 WHERE id = $1`, it.reservationId, nowOf(ctx));
        continue;
      }
      // Short pick: keep what was found picked, release the rest, flag the bin.
      if (qty > 0) {
        await run(`UPDATE reservations SET qty = $2, status = 'picked', updated_at = $3 WHERE id = $1`, it.reservationId, qty, nowOf(ctx));
        await run(`UPDATE inventory_balances SET reserved = reserved - $3 WHERE variant_id = $1 AND location_id = $2`, it.variantId, it.locationId, it.qtyToPick - qty);
        await run(`UPDATE pick_list_items SET qty_to_pick = $2 WHERE id = $1`, it.id, qty);
        await run(
          `INSERT INTO reservations (business_id, order_item_id, variant_id, location_id, qty, status, created_at, updated_at, note)
           SELECT business_id, order_item_id, variant_id, location_id, $2, 'released', created_at, $3, $4 FROM reservations WHERE id = $1`,
          it.reservationId, it.qtyToPick - qty, nowOf(ctx), `Picker could not find ${it.qtyToPick - qty} on the bin`,
        );
      } else {
        await releaseReservation(ctx, it.reservationId, `Picker could not find these on the bin`);
      }
      await run(
        `UPDATE inventory_balances SET needs_verification = true, verification_note = $3 WHERE variant_id = $1 AND location_id = $2`,
        it.variantId, it.locationId, `${ctx.user.name} found ${qty} of ${it.qtyToPick} needed for ${order?.code}; recount the bin`,
      );
      await run(`UPDATE order_items SET backordered = true WHERE id = (SELECT order_item_id FROM reservations WHERE id = $1)`, it.reservationId);
    }
    const left = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pick_list_items WHERE pick_list_id = $1 AND qty_picked IS NULL`, pl.id);
    if (!left?.n) await run(`UPDATE pick_lists SET status = 'picked', picked_at = $2, picked_by = $3 WHERE id = $1`, pl.id, nowOf(ctx), ctx.user.id);
    await audit(ctx, "pick_list.picked", { type: "pick_list", id: pl.id, code: pl.code }, null, { lines: lines.length });
    await refreshStatus(ctx, pl.orderId);
    return { complete: !left?.n };
  });
}

/**
 * Ships picked units. By default everything picked; pass lines to ship less
 * (the rest stays picked, waiting in the packing area).
 */
export async function dispatchOrder(ctx: Ctx, orderId: number, input: { carrier?: string; tracking?: string; lines?: { orderItemId: number; qty: number }[] } = {}) {
  need(ctx, "warehouse.write");
  return tx(async () => {
    const order = await requireOrder(ctx, orderId);
    if (["completed", "cancelled"].includes(order.status)) throw new DomainError(`${order.code} is ${order.status}.`);
    const picked = await q<{ id: number; orderItemId: number; variantId: number; locationId: number; qty: number }>(
      `SELECT r.id, r.order_item_id AS "orderItemId", r.variant_id AS "variantId", r.location_id AS "locationId", r.qty
         FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id WHERE oi.order_id = $1 AND r.status = 'picked' ORDER BY r.id FOR UPDATE OF r`,
      order.id,
    );
    if (!picked.length) throw new DomainError("Nothing is picked yet. Pick the order first.");
    const want = new Map<number, number>();
    for (const r of picked) want.set(r.orderItemId, (want.get(r.orderItemId) ?? 0) + r.qty);
    if (input.lines) {
      for (const l of input.lines) {
        const max = want.get(l.orderItemId) ?? 0;
        if (!Number.isInteger(l.qty) || l.qty < 0 || l.qty > max) throw new DomainError(`You can ship 0 to ${max} of that line.`);
        want.set(l.orderItemId, l.qty);
      }
    }
    const code = await nextCode(ctx, "shipments", "SHP-", 3);
    const shp = await one<{ id: number }>(
      `INSERT INTO shipments (business_id, code, order_id, customer_id, carrier, tracking, dispatched_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      ctx.businessId, code, order.id, order.customerId, (input.carrier ?? "Shree Transport").slice(0, 60), (input.tracking ?? "").slice(0, 60), nowOf(ctx), ctx.user.id,
    );
    const ref = { type: "shipment", id: shp!.id, code };
    let total = 0;
    for (const [orderItemId, qtyWanted] of want) {
      let left = qtyWanted;
      if (left <= 0) continue;
      for (const r of picked.filter((x) => x.orderItemId === orderItemId)) {
        if (left <= 0) break;
        const take = Math.min(left, r.qty);
        await run(`UPDATE inventory_balances SET reserved = reserved - $3 WHERE variant_id = $1 AND location_id = $2`, r.variantId, r.locationId, take);
        await post(ctx, { variantId: r.variantId, locationId: r.locationId, type: "dispatch", qty: -take, ref });
        if (take === r.qty) await run(`UPDATE reservations SET status = 'consumed', updated_at = $2 WHERE id = $1`, r.id, nowOf(ctx));
        else {
          await run(`UPDATE reservations SET qty = qty - $2, updated_at = $3 WHERE id = $1`, r.id, take, nowOf(ctx));
          await run(
            `INSERT INTO reservations (business_id, order_item_id, variant_id, location_id, qty, status, created_at, updated_at)
             SELECT business_id, order_item_id, variant_id, location_id, $2, 'consumed', created_at, $3 FROM reservations WHERE id = $1`,
            r.id, take, nowOf(ctx),
          );
        }
        left -= take;
      }
      const variantId = picked.find((x) => x.orderItemId === orderItemId)!.variantId;
      await run(`INSERT INTO shipment_items (shipment_id, order_item_id, variant_id, qty) VALUES ($1, $2, $3, $4)`, shp!.id, orderItemId, variantId, qtyWanted - left);
      total += qtyWanted - left;
    }
    if (!total) throw new DomainError("The shipment has no units.");
    await audit(ctx, "shipment.dispatched", { type: "shipment", id: shp!.id, code }, null, { order: order.code, units: total });
    await refreshStatus(ctx, order.id);
    return { id: shp!.id, code, units: total };
  });
}

/**
 * Cancels the order and releases every reservation, picked ones included.
 * Picked units are still booked at their bin, so the result says to put them back.
 */
export async function cancelOrder(ctx: Ctx, orderId: number, reason: string) {
  need(ctx, "orders.write");
  return tx(async () => {
    const order = await requireOrder(ctx, orderId);
    if (["completed", "cancelled", "dispatched"].includes(order.status)) throw new DomainError(`${order.code} is ${order.status} and can't be cancelled.`);
    const res = await q<{ id: number; status: string; qty: number; sku: string; location: string }>(
      `SELECT r.id, r.status, r.qty, v.sku, l.code AS location FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
         JOIN product_variants v ON v.id = r.variant_id JOIN locations l ON l.id = r.location_id WHERE oi.order_id = $1 AND r.status IN ('active', 'picked')`,
      order.id,
    );
    const putBack = res.filter((r) => r.status === "picked").map((r) => `${units(r.qty)} of ${r.sku} to ${r.location}`);
    for (const r of res) await releaseReservation(ctx, r.id, r.status === "picked" ? "Order cancelled; put the picked units back on the bin" : "Order cancelled");
    await run(`UPDATE pick_lists SET status = 'cancelled' WHERE order_id = $1 AND status = 'open'`, order.id);
    await run(`UPDATE orders SET status = 'cancelled', cancelled_at = $2, note = $3 WHERE id = $1`, order.id, nowOf(ctx), reason.slice(0, 300) || "Cancelled");
    await audit(ctx, "order.cancelled", { type: "order", id: order.id, code: order.code }, reason || null, { released: res.length });
    return { putBack };
  });
}

/** Sets status from the records: what is reserved, picked, shipped, billed and paid. */
export async function refreshStatus(ctx: Ctx, orderId: number) {
  const o = await one<{ status: OrderStatus }>(`SELECT status FROM orders WHERE id = $1`, orderId);
  if (!o || o.status === "cancelled" || o.status === "completed") return o?.status;
  const items = await itemState(orderId);
  const openPick = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pick_lists WHERE order_id = $1 AND status = 'open'`, orderId);
  let status: OrderStatus;
  if (items.some((i) => i.active > 0)) status = openPick?.n ? "picking" : "confirmed";
  else if (items.some((i) => i.picked > 0)) status = "packed";
  else if (items.some((i) => openItem(i) > 0)) status = "confirmed";
  else {
    const money = await one<{ billed: number; received: number; invoicedAll: boolean }>(
      `SELECT COALESCE((SELECT SUM(CASE WHEN i.kind = 'invoice' THEN 1 ELSE -1 END * ii.qty * ii.unit_price) FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.order_id = $1), 0)::int AS billed,
              COALESCE((SELECT SUM(CASE WHEN p.kind = 'receipt' THEN 1 ELSE -1 END * p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.order_id = $1), 0)::int AS received,
              NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = $1 AND
                 COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0) - COALESCE((SELECT SUM(qty) FROM return_items r WHERE r.order_item_id = oi.id), 0) >
                 COALESCE((SELECT SUM(CASE WHEN i.kind = 'invoice' THEN ii.qty ELSE -ii.qty END) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id), 0)) AS "invoicedAll"`,
      orderId,
    );
    status = money && money.invoicedAll && money.billed > 0 && money.received >= money.billed ? "completed" : "dispatched";
  }
  if (status !== o.status) {
    await run(`UPDATE orders SET status = $2, completed_at = CASE WHEN $2 = 'completed' THEN $3::timestamptz ELSE completed_at END WHERE id = $1`, orderId, status, ctx.now ?? new Date());
  }
  return status;
}

/** Marks an order completed by hand. Allowed, audited, and checked by OrderTrace. */
export async function markCompleted(ctx: Ctx, orderId: number, reason: string) {
  need(ctx, "orders.write");
  const order = await requireOrder(ctx, orderId);
  if (order.status === "cancelled") throw new DomainError("A cancelled order can't be completed.");
  await run(`UPDATE orders SET status = 'completed', completed_at = $2 WHERE id = $1`, order.id, nowOf(ctx));
  await audit(ctx, "order.completed", { type: "order", id: order.id, code: order.code }, reason || "Marked complete by hand");
}

/** Reopens a completed order (a correction from an investigation). */
export async function reopenOrder(ctx: Ctx, orderId: number, reason: string) {
  need(ctx, "orders.write");
  await run(`UPDATE orders SET status = 'dispatched', completed_at = NULL WHERE business_id = $1 AND id = $2 AND status = 'completed'`, ctx.businessId, orderId);
  await audit(ctx, "order.reopened", { type: "order", id: orderId }, reason);
  await refreshStatus(ctx, orderId);
}

export async function cancelRemainder(ctx: Ctx, orderItemId: number, reason: string) {
  need(ctx, "orders.write");
  const state = await one<{ orderId: number; due: number; shipped: number }>(
    `SELECT oi.order_id AS "orderId", oi.qty_ordered - oi.qty_cancelled AS due, COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)::int AS shipped
       FROM order_items oi WHERE oi.business_id = $1 AND oi.id = $2`,
    ctx.businessId, orderItemId,
  );
  if (!state) throw new NotFoundError("Order line not found.");
  const gap = state.due - state.shipped;
  if (gap <= 0) throw new DomainError("Nothing is left to cancel on that line.");
  await run(`UPDATE order_items SET qty_cancelled = qty_cancelled + $2, backordered = false WHERE id = $1`, orderItemId, gap);
  await audit(ctx, "order.remainder_cancelled", { type: "order", id: state.orderId }, reason, { orderItemId, qty: gap });
  return gap;
}

// ---- reads ----

export interface OrderRow {
  id: number; code: string; status: OrderStatus; channel: string; customer: string; customerId: number; createdAt: Date; dueAt: Date | null;
  units: number; shipped: number; held: number; short: number; value: number; openCase: string | null;
}

export async function listOrders(ctx: Ctx, opts: { status?: string; limit?: number; search?: string } = {}) {
  return q<OrderRow>(
    `SELECT o.id, o.code, o.status, o.channel, c.name AS customer, c.id AS "customerId", o.created_at AS "createdAt", o.due_at AS "dueAt",
            COALESCE(SUM(oi.qty_ordered - oi.qty_cancelled), 0)::int AS units,
            COALESCE(SUM((SELECT COALESCE(SUM(qty), 0) FROM shipment_items s WHERE s.order_item_id = oi.id)), 0)::int AS shipped,
            COALESCE(SUM((SELECT COALESCE(SUM(qty), 0) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked'))), 0)::int AS held,
            COALESCE(SUM(GREATEST(oi.qty_ordered - oi.qty_cancelled - (SELECT COALESCE(SUM(qty), 0) FROM shipment_items s WHERE s.order_item_id = oi.id)
                - (SELECT COALESCE(SUM(qty), 0) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked')), 0)), 0)::int AS short,
            COALESCE(SUM(oi.qty_ordered * oi.unit_price), 0)::int AS value,
            (SELECT i.code FROM investigations i WHERE i.business_id = o.business_id AND i.case_key = 'order:' || o.id AND i.status NOT IN ('resolved', 'closed') LIMIT 1) AS "openCase"
       FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.business_id = $1 AND ($2::text IS NULL OR o.status = $2 OR ($2 = 'open' AND o.status IN ('confirmed', 'picking', 'packed')))
        AND ($3::text IS NULL OR o.code ILIKE '%' || $3 || '%' OR c.name ILIKE '%' || $3 || '%')
      GROUP BY o.id, c.id ORDER BY o.created_at DESC LIMIT $4`,
    ctx.businessId, opts.status ?? null, opts.search ?? null, opts.limit ?? 200,
  );
}

export async function pickListView(ctx: Ctx, pickListId: number) {
  const pl = await one<{ id: number; code: string; status: string; orderId: number; orderCode: string; customer: string; createdAt: Date; dueAt: Date | null }>(
    `SELECT pl.id, pl.code, pl.status, o.id AS "orderId", o.code AS "orderCode", c.name AS customer, pl.created_at AS "createdAt", o.due_at AS "dueAt"
       FROM pick_lists pl JOIN orders o ON o.id = pl.order_id JOIN customers c ON c.id = o.customer_id WHERE pl.business_id = $1 AND pl.id = $2`,
    ctx.businessId, pickListId,
  );
  if (!pl) return null;
  const lines = await q<{ id: number; sku: string; productName: string; colour: string; size: string; location: string; warehouse: string; rack: string | null; shelf: string | null; bin: string | null; kind: string; qtyToPick: number; qtyPicked: number | null }>(
    `SELECT pli.id, v.sku, p.name AS "productName", v.colour, v.size, l.code AS location, l.warehouse, l.rack, l.shelf, l.bin, l.kind,
            pli.qty_to_pick AS "qtyToPick", pli.qty_picked AS "qtyPicked"
       FROM pick_list_items pli JOIN product_variants v ON v.id = pli.variant_id JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = pli.location_id
      WHERE pli.pick_list_id = $1 ORDER BY l.code, v.sku`,
    pl.id,
  );
  lines.sort((a, b) => a.location.localeCompare(b.location, "en", { numeric: true }) || a.sku.localeCompare(b.sku));
  return { ...pl, lines, racks: [...new Set(lines.map((l) => l.rack))].length };
}

export async function customers(ctx: Ctx) {
  return q<{ id: number; code: string; name: string; city: string; creditDays: number }>(
    `SELECT id, code, name, city, credit_days AS "creditDays" FROM customers WHERE business_id = $1 ORDER BY name`,
    ctx.businessId,
  );
}

export const dueFromLabel = (label: string | null, now: Date): Date | null => {
  if (!label) return null;
  const IST = 5.5 * 3_600_000;
  const start = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
  const at = (d: number) => new Date(start + d * DAY + 18 * 3_600_000);
  if (label === "today") return at(0);
  if (label === "tomorrow") return at(1);
  if (label === "day-after") return at(2);
  if (label === "this-week") return at(Math.max(1, 6 - new Date(now.getTime() + IST).getUTCDay()));
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const i = days.indexOf(label);
  if (i >= 0) {
    const today = new Date(now.getTime() + IST).getUTCDay();
    return at(((i - today + 7) % 7) || 7);
  }
  return null;
};
