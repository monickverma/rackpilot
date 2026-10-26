// Stock: the one write path for on-hand quantities, reservations, transfers,
// counts and adjustments. post() is the only function that changes on_hand,
// and it appends the matching stock_movements row in the same transaction.
// Corrections are compensating movements; nothing in the ledger is edited.

import { isCheckViolation, one, q, run, tx } from "../../db/client.ts";
import type { MovementType } from "../../db/schema.ts";
import { audit, DomainError, need, NotFoundError, nowOf, type Ctx } from "../context.ts";
import { units } from "../format.ts";

export interface Ref {
  type: string;
  id: number;
  code: string | null;
}

export async function post(ctx: Ctx, m: { variantId: number; locationId: number; type: MovementType; qty: number; ref?: Ref | null; reason?: string | null; reverses?: number | null }) {
  if (!Number.isInteger(m.qty) || m.qty === 0) throw new DomainError("Quantity must be a whole number other than zero.");
  return tx(async () => {
    try {
      // Postgres checks CHECK constraints on the candidate row of an upsert, so
      // stock going out is a plain UPDATE (still checked) and only stock coming in upserts.
      if (m.qty < 0) {
        const n = await run(
          `UPDATE inventory_balances SET on_hand = on_hand + $4, updated_at = $5 WHERE business_id = $1 AND variant_id = $2 AND location_id = $3`,
          ctx.businessId, m.variantId, m.locationId, m.qty, nowOf(ctx),
        );
        if (!n) throw new DomainError("Not enough stock: nothing is recorded at that location.");
      } else {
        await run(
          `INSERT INTO inventory_balances (business_id, variant_id, location_id, on_hand, reserved, updated_at) VALUES ($1, $2, $3, $4, 0, $5)
           ON CONFLICT (variant_id, location_id) DO UPDATE SET on_hand = inventory_balances.on_hand + EXCLUDED.on_hand, updated_at = EXCLUDED.updated_at`,
          ctx.businessId, m.variantId, m.locationId, m.qty, nowOf(ctx),
        );
      }
    } catch (err) {
      if (isCheckViolation(err)) throw new DomainError("Not enough stock: that would take on-hand below zero or below what is reserved.");
      throw err;
    }
    const row = await one<{ id: number }>(
      `INSERT INTO stock_movements (business_id, variant_id, location_id, type, qty, ref_type, ref_id, ref_code, actor_user_id, reason, reverses_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      ctx.businessId, m.variantId, m.locationId, m.type, m.qty, m.ref?.type ?? null, m.ref?.id ?? null, m.ref?.code ?? null, ctx.user.id, m.reason ?? null, m.reverses ?? null, nowOf(ctx),
    );
    return row!.id;
  });
}

export async function requireVariant(ctx: Ctx, variantId: number) {
  const v = await one<{ id: number; sku: string; homeLocationId: number; unitCost: number }>(
    `SELECT v.id, v.sku, v.home_location_id AS "homeLocationId", p.unit_cost AS "unitCost" FROM product_variants v JOIN products p ON p.id = v.product_id
      WHERE v.business_id = $1 AND v.id = $2`,
    ctx.businessId, variantId,
  );
  if (!v) throw new NotFoundError("That product variant doesn't exist in this business.");
  return v;
}

export async function requireLocation(ctx: Ctx, locationId: number) {
  const l = await one<{ id: number; code: string; sellable: boolean; kind: string }>(`SELECT id, code, sellable, kind FROM locations WHERE business_id = $1 AND id = $2`, ctx.businessId, locationId);
  if (!l) throw new NotFoundError("That location doesn't exist in this business.");
  return l;
}

const checkQty = (qty: number, max = 2000) => {
  if (!Number.isInteger(qty) || qty <= 0 || qty > max) throw new DomainError(`Quantity must be a whole number from 1 to ${max}.`);
};

// ---- reservations ----

/**
 * Reserves up to qty of an order item's variant from sellable bins, home bin
 * first. Rows are locked so two orders can't take the same units; the CHECK
 * on inventory_balances is the last line of defence.
 */
export async function reserveItem(ctx: Ctx, orderItemId: number, qty: number): Promise<number> {
  return tx(async () => {
    const item = await one<{ variantId: number; home: number }>(
      `SELECT oi.variant_id AS "variantId", v.home_location_id AS home FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id
        WHERE oi.business_id = $1 AND oi.id = $2`,
      ctx.businessId, orderItemId,
    );
    if (!item) throw new NotFoundError("Order line not found.");
    const bins = await q<{ locationId: number; free: number }>(
      `SELECT b.location_id AS "locationId", b.on_hand - b.reserved AS free FROM inventory_balances b JOIN locations l ON l.id = b.location_id
        WHERE b.business_id = $1 AND b.variant_id = $2 AND l.sellable AND b.on_hand > b.reserved
        ORDER BY (b.location_id = $3) DESC, b.on_hand - b.reserved DESC FOR UPDATE OF b`,
      ctx.businessId, item.variantId, item.home,
    );
    let left = qty;
    for (const b of bins) {
      if (left <= 0) break;
      const take = Math.min(left, b.free);
      await run(`UPDATE inventory_balances SET reserved = reserved + $3, updated_at = $4 WHERE variant_id = $1 AND location_id = $2`, item.variantId, b.locationId, take, nowOf(ctx));
      await run(
        `INSERT INTO reservations (business_id, order_item_id, variant_id, location_id, qty, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
        ctx.businessId, orderItemId, item.variantId, b.locationId, take, nowOf(ctx),
      );
      left -= take;
    }
    return qty - left;
  });
}

export async function releaseReservation(ctx: Ctx, reservationId: number, note: string) {
  return tx(async () => {
    const r = await one<{ id: number; variantId: number; locationId: number; qty: number; status: string }>(
      `SELECT id, variant_id AS "variantId", location_id AS "locationId", qty, status FROM reservations WHERE business_id = $1 AND id = $2 FOR UPDATE`,
      ctx.businessId, reservationId,
    );
    if (!r) throw new NotFoundError("Reservation not found.");
    if (r.status !== "active" && r.status !== "picked") throw new DomainError(`That reservation is already ${r.status}.`);
    await run(`UPDATE inventory_balances SET reserved = reserved - $3, updated_at = $4 WHERE variant_id = $1 AND location_id = $2`, r.variantId, r.locationId, r.qty, nowOf(ctx));
    await run(`UPDATE reservations SET status = 'released', updated_at = $2, note = $3 WHERE id = $1`, r.id, nowOf(ctx), note);
    await audit(ctx, "reservation.released", { type: "reservation", id: r.id, code: `RES-${r.id}` }, note, { qty: r.qty, wasStatus: r.status });
    return r;
  });
}

// ---- transfers ----

async function nextCode(ctx: Ctx, table: string, prefix: string, width: number) {
  const row = await one<{ n: number | null }>(`SELECT MAX(CAST(substring(code FROM '[0-9]+$') AS int)) AS n FROM ${table} WHERE business_id = $1 AND code LIKE $2`, ctx.businessId, `${prefix}%`);
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(width, "0")}`;
}
export { nextCode };

/** Records goods leaving a location. Stock moves in the ledger when the destination scans them in. */
export async function sendTransfer(ctx: Ctx, input: { variantId: number; fromLocationId: number; toLocationId: number; qty: number; note?: string | null }) {
  need(ctx, "warehouse.write");
  checkQty(input.qty, 500);
  if (input.fromLocationId === input.toLocationId) throw new DomainError("Pick a different destination.");
  return tx(async () => {
    const v = await requireVariant(ctx, input.variantId);
    const from = await requireLocation(ctx, input.fromLocationId);
    const to = await requireLocation(ctx, input.toLocationId);
    const b = await one<{ onHand: number; reserved: number }>(`SELECT on_hand AS "onHand", reserved FROM inventory_balances WHERE variant_id = $1 AND location_id = $2 FOR UPDATE`, v.id, from.id);
    const free = (b?.onHand ?? 0) - (b?.reserved ?? 0);
    if (free < input.qty) throw new DomainError(`Only ${units(Math.max(free, 0))} of ${v.sku} are free at ${from.code}; the rest is reserved.`);
    const code = await nextCode(ctx, "transfers", "TRF-", 4);
    const t = await one<{ id: number }>(
      `INSERT INTO transfers (business_id, code, from_location_id, to_location_id, status, sent_at, sent_by, note) VALUES ($1, $2, $3, $4, 'sent', $5, $6, $7) RETURNING id`,
      ctx.businessId, code, from.id, to.id, nowOf(ctx), ctx.user.id, input.note ?? null,
    );
    await run(`INSERT INTO transfer_items (transfer_id, variant_id, qty_sent) VALUES ($1, $2, $3)`, t!.id, v.id, input.qty);
    await audit(ctx, "transfer.sent", { type: "transfer", id: t!.id, code }, input.note ?? null, { sku: v.sku, qty: input.qty, from: from.code, to: to.code });
    return { id: t!.id, code };
  });
}

/** The destination scans the goods in: the ledger books them out of the source and into the destination. */
export async function receiveTransfer(ctx: Ctx, transferId: number, qtyReceived?: number) {
  need(ctx, "warehouse.write");
  return tx(async () => {
    const t = await one<{ id: number; code: string; status: string; fromId: number; toId: number; variantId: number; qty: number }>(
      `SELECT t.id, t.code, t.status, t.from_location_id AS "fromId", t.to_location_id AS "toId", ti.variant_id AS "variantId", ti.qty_sent AS qty
         FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id WHERE t.business_id = $1 AND t.id = $2 FOR UPDATE OF t`,
      ctx.businessId, transferId,
    );
    if (!t) throw new NotFoundError("Transfer not found.");
    if (t.status !== "sent") throw new DomainError(`${t.code} is already ${t.status}.`);
    const qty = qtyReceived ?? t.qty;
    checkQty(qty, t.qty);
    const ref = { type: "transfer", id: t.id, code: t.code };
    await post(ctx, { variantId: t.variantId, locationId: t.fromId, type: "transfer_out", qty: -qty, ref });
    await post(ctx, { variantId: t.variantId, locationId: t.toId, type: "transfer_in", qty, ref });
    await run(`UPDATE transfers SET status = 'received', received_at = $2, received_by = $3 WHERE id = $1`, t.id, nowOf(ctx), ctx.user.id);
    await run(`UPDATE transfer_items SET qty_received = $2 WHERE transfer_id = $1`, t.id, qty);
    await audit(ctx, "transfer.received", { type: "transfer", id: t.id, code: t.code }, null, { qty });
    return t;
  });
}

/** The goods never left: cancel a sent transfer. Nothing moves in the ledger. */
export async function cancelTransfer(ctx: Ctx, transferId: number, reason: string) {
  need(ctx, "warehouse.write");
  const n = await run(`UPDATE transfers SET status = 'cancelled', note = COALESCE(note || ' · ', '') || $3 WHERE business_id = $1 AND id = $2 AND status = 'sent'`, ctx.businessId, transferId, `Cancelled: ${reason}`);
  if (!n) throw new DomainError("Only a sent transfer can be cancelled.");
  await audit(ctx, "transfer.cancelled", { type: "transfer", id: transferId }, reason);
}

// ---- counts and adjustments ----

/** Records what was physically counted. The ledger doesn't change; a variance opens a StockSleuth case. */
export async function recordCount(ctx: Ctx, input: { scope: string; source?: "handheld" | "sheet" | "cycle"; lines: { variantId: number; locationId: number; counted: number }[] }) {
  need(ctx, "warehouse.write");
  if (!input.lines.length) throw new DomainError("Add at least one counted line.");
  return tx(async () => {
    const code = await nextCode(ctx, "physical_stock_counts", "CNT-", 4);
    const c = await one<{ id: number }>(
      `INSERT INTO physical_stock_counts (business_id, code, scope, source, counted_by, counted_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      ctx.businessId, code, input.scope.slice(0, 120) || "Spot count", input.source ?? "handheld", ctx.user.id, nowOf(ctx),
    );
    const out: { sku: string; location: string; recorded: number; counted: number }[] = [];
    for (const l of input.lines) {
      if (!Number.isInteger(l.counted) || l.counted < 0 || l.counted > 10_000) throw new DomainError("Counts must be whole numbers, 0 or more.");
      const v = await requireVariant(ctx, l.variantId);
      const loc = await requireLocation(ctx, l.locationId);
      const b = await one<{ onHand: number }>(`SELECT on_hand AS "onHand" FROM inventory_balances WHERE variant_id = $1 AND location_id = $2`, v.id, loc.id);
      await run(`INSERT INTO stock_count_lines (count_id, variant_id, location_id, recorded_qty, counted_qty) VALUES ($1, $2, $3, $4, $5)`, c!.id, v.id, loc.id, b?.onHand ?? 0, l.counted);
      if ((b?.onHand ?? 0) === l.counted) await run(`UPDATE inventory_balances SET needs_verification = false, verification_note = NULL WHERE variant_id = $1 AND location_id = $2`, v.id, loc.id);
      out.push({ sku: v.sku, location: loc.code, recorded: b?.onHand ?? 0, counted: l.counted });
    }
    await audit(ctx, "count.submitted", { type: "count", id: c!.id, code }, null, { lines: out.length });
    return { id: c!.id, code, lines: out };
  });
}

/** An owner-approved correction to on-hand, tied to the investigation or count that justifies it. */
export async function adjustStock(ctx: Ctx, input: { variantId: number; locationId: number; qty: number; reason: string; investigation?: { id: number; code: string } | null }) {
  need(ctx, "stock.adjust");
  if (!input.reason.trim()) throw new DomainError("Give a reason for the adjustment.");
  const v = await requireVariant(ctx, input.variantId);
  const loc = await requireLocation(ctx, input.locationId);
  const id = await post(ctx, {
    variantId: v.id, locationId: loc.id, type: "adjustment", qty: input.qty, reason: input.reason.trim().slice(0, 300),
    ref: input.investigation ? { type: "investigation", id: input.investigation.id, code: input.investigation.code } : null,
  });
  await audit(ctx, "stock.adjusted", { type: "stock_movement", id, code: `${v.sku} @ ${loc.code}` }, input.reason, { qty: input.qty, investigation: input.investigation?.code ?? null });
  return id;
}

export async function writeOffDamage(ctx: Ctx, input: { variantId: number; locationId: number; qty: number; reason: string }) {
  need(ctx, "warehouse.write");
  checkQty(input.qty, 200);
  return tx(async () => {
    const b = await one<{ free: number }>(`SELECT on_hand - reserved AS free FROM inventory_balances WHERE variant_id = $1 AND location_id = $2 AND business_id = $3 FOR UPDATE`, input.variantId, input.locationId, ctx.businessId);
    if (!b || b.free < input.qty) throw new DomainError("Not enough free stock there to write off; reserved units can't be written off.");
    return post(ctx, { variantId: input.variantId, locationId: input.locationId, type: "damage", qty: -input.qty, reason: input.reason.trim().slice(0, 200) || "Damaged" });
  });
}

/** Reverses a movement with an equal and opposite one, linked to the original. */
export async function reverseMovement(ctx: Ctx, movementId: number, reason: string, investigation?: { id: number; code: string }) {
  need(ctx, "stock.adjust");
  const m = await one<{ id: number; variantId: number; locationId: number; type: MovementType; qty: number; refCode: string | null }>(
    `SELECT id, variant_id AS "variantId", location_id AS "locationId", type, qty, ref_code AS "refCode" FROM stock_movements WHERE business_id = $1 AND id = $2`,
    ctx.businessId, movementId,
  );
  if (!m) throw new NotFoundError("Movement not found.");
  const already = await one<{ id: number }>(`SELECT id FROM stock_movements WHERE reverses_id = $1`, m.id);
  if (already) throw new DomainError("That movement has already been reversed.");
  const id = await post(ctx, {
    variantId: m.variantId, locationId: m.locationId, type: "adjustment", qty: -m.qty, reverses: m.id, reason: `Reverses movement #${m.id}${m.refCode ? ` (${m.refCode})` : ""}: ${reason}`,
    ref: investigation ? { type: "investigation", id: investigation.id, code: investigation.code } : null,
  });
  await audit(ctx, "stock.movement_reversed", { type: "stock_movement", id: m.id }, reason, { reversal: id });
  return id;
}

/** Owner-only repair: set a stored balance back to what its ledger says. */
export async function rebuildBalance(ctx: Ctx, variantId: number, locationId: number, reason: string) {
  need(ctx, "stock.adjust");
  return tx(async () => {
    const b = await one<{ onHand: number; reserved: number }>(`SELECT on_hand AS "onHand", reserved FROM inventory_balances WHERE business_id = $1 AND variant_id = $2 AND location_id = $3 FOR UPDATE`, ctx.businessId, variantId, locationId);
    if (!b) throw new NotFoundError("Balance not found.");
    const l = await one<{ sum: number }>(`SELECT COALESCE(SUM(qty), 0)::int AS sum FROM stock_movements WHERE variant_id = $1 AND location_id = $2`, variantId, locationId);
    const held = await one<{ sum: number }>(`SELECT COALESCE(SUM(qty), 0)::int AS sum FROM reservations WHERE variant_id = $1 AND location_id = $2 AND status IN ('active', 'picked')`, variantId, locationId);
    await run(`UPDATE inventory_balances SET on_hand = $3, reserved = $4, updated_at = $5 WHERE variant_id = $1 AND location_id = $2`, variantId, locationId, l!.sum, held!.sum, nowOf(ctx));
    await audit(ctx, "balance.rebuilt", { type: "balance", id: variantId }, reason, { before: b, after: { onHand: l!.sum, reserved: held!.sum }, locationId });
    return { before: b, after: { onHand: l!.sum, reserved: held!.sum } };
  });
}

export async function restockReturn(ctx: Ctx, returnId: number) {
  need(ctx, "warehouse.write");
  return tx(async () => {
    const r = await one<{ id: number; code: string }>(`SELECT id, code FROM returns WHERE business_id = $1 AND id = $2`, ctx.businessId, returnId);
    if (!r) throw new NotFoundError("Return not found.");
    const lines = await q<{ id: number; variantId: number; locationId: number | null; home: number; qty: number; restocked: number; condition: string }>(
      `SELECT ri.id, ri.variant_id AS "variantId", ri.location_id AS "locationId", v.home_location_id AS home, ri.qty, ri.restocked_qty AS restocked, ri.condition
         FROM return_items ri JOIN product_variants v ON v.id = ri.variant_id WHERE ri.return_id = $1`,
      r.id,
    );
    let n = 0;
    for (const l of lines) {
      const qty = l.qty - l.restocked;
      if (qty <= 0) continue;
      const loc = l.condition === "resellable" ? (l.locationId ?? l.home) : (await one<{ id: number }>(`SELECT id FROM locations WHERE business_id = $1 AND kind = 'quarantine' LIMIT 1`, ctx.businessId))!.id;
      await post(ctx, { variantId: l.variantId, locationId: loc, type: "customer_return", qty, ref: { type: "return", id: r.id, code: r.code }, reason: l.condition === "resellable" ? null : "Damaged return held in quarantine" });
      await run(`UPDATE return_items SET restocked_qty = qty, location_id = $2 WHERE id = $1`, l.id, loc);
      n += qty;
    }
    await audit(ctx, "return.restocked", { type: "return", id: r.id, code: r.code }, null, { qty: n });
    return n;
  });
}

// ---- reads ----

export interface StockLine {
  variantId: number; sku: string; barcode: string; productId: number; productCode: string; productName: string; category: string; brand: string;
  colour: string; size: string; unitCost: number; unitPrice: number; supplierId: number; supplierName: string; leadTimeDays: number; packSize: number; moq: number;
  season: string | null; launchedAt: Date; homeLocationId: number; home: string; onHand: number; reserved: number; sellableOnHand: number; sellableReserved: number;
  available: number; unavailable: number; flagged: boolean;
}

/** One row per variant with stock summed across locations. Available = sellable on-hand − reserved. */
export async function stockLines(ctx: Ctx): Promise<StockLine[]> {
  return q<StockLine>(
    `SELECT v.id AS "variantId", v.sku, v.barcode, p.id AS "productId", p.code AS "productCode", p.name AS "productName", p.category, p.brand, v.colour, v.size,
            p.unit_cost AS "unitCost", p.unit_price AS "unitPrice", s.id AS "supplierId", s.name AS "supplierName", s.lead_time_days AS "leadTimeDays",
            s.pack_size AS "packSize", s.moq_units AS moq, p.season, p.launched_at AS "launchedAt", v.home_location_id AS "homeLocationId", hl.code AS home,
            COALESCE(SUM(b.on_hand), 0)::int AS "onHand", COALESCE(SUM(b.reserved), 0)::int AS reserved,
            COALESCE(SUM(b.on_hand) FILTER (WHERE l.sellable), 0)::int AS "sellableOnHand", COALESCE(SUM(b.reserved) FILTER (WHERE l.sellable), 0)::int AS "sellableReserved",
            COALESCE(SUM(b.on_hand - b.reserved) FILTER (WHERE l.sellable), 0)::int AS available,
            COALESCE(SUM(b.on_hand) FILTER (WHERE NOT l.sellable), 0)::int AS unavailable,
            COALESCE(bool_or(b.needs_verification), false) AS flagged
       FROM product_variants v JOIN products p ON p.id = v.product_id JOIN suppliers s ON s.id = p.supplier_id JOIN locations hl ON hl.id = v.home_location_id
       LEFT JOIN inventory_balances b ON b.variant_id = v.id LEFT JOIN locations l ON l.id = b.location_id
      WHERE v.business_id = $1
      GROUP BY v.id, p.id, s.id, hl.code ORDER BY p.code, v.colour, v.id`,
    ctx.businessId,
  );
}

export async function variantBySku(ctx: Ctx, sku: string) {
  return one<{ id: number; sku: string }>(`SELECT id, sku FROM product_variants WHERE business_id = $1 AND (sku = $2 OR barcode = $2)`, ctx.businessId, sku.trim().toUpperCase());
}

export async function balancesOf(ctx: Ctx, variantId: number) {
  return q<{ locationId: number; code: string; warehouse: string; rack: string | null; shelf: string | null; bin: string | null; kind: string; sellable: boolean; onHand: number; reserved: number; needsVerification: boolean; verificationNote: string | null }>(
    `SELECT l.id AS "locationId", l.code, l.warehouse, l.rack, l.shelf, l.bin, l.kind, l.sellable, b.on_hand AS "onHand", b.reserved,
            b.needs_verification AS "needsVerification", b.verification_note AS "verificationNote"
       FROM inventory_balances b JOIN locations l ON l.id = b.location_id WHERE b.business_id = $1 AND b.variant_id = $2 AND (b.on_hand > 0 OR b.reserved > 0 OR b.needs_verification)
      ORDER BY l.sellable DESC, b.on_hand DESC`,
    ctx.businessId, variantId,
  );
}

export async function locations(ctx: Ctx) {
  return q<{ id: number; code: string; warehouse: string; rack: string | null; shelf: string | null; bin: string | null; kind: string; sellable: boolean }>(
    `SELECT id, code, warehouse, rack, shelf, bin, kind, sellable FROM locations WHERE business_id = $1 ORDER BY kind <> 'bin', rack NULLS LAST, shelf, bin`,
    ctx.businessId,
  );
}
