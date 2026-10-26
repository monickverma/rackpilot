// Purchase orders and goods receipts. Receiving posts receipt movements into
// each variant's home bin, then offers the new stock to backorders, oldest
// order first.

import { one, q, run, tx } from "../../db/client.ts";
import { audit, DomainError, need, NotFoundError, nowOf, type Ctx } from "../context.ts";
import { DAY } from "../format.ts";
import { fillBackorders } from "./orders.ts";
import { nextCode, post } from "./stock.ts";

export async function placePurchaseOrder(ctx: Ctx, supplierId: number, lines: { variantId: number; qty: number }[], recommendationId: number | null) {
  need(ctx, "purchasing.approve");
  const supplier = await one<{ id: number; leadTimeDays: number; name: string }>(`SELECT id, lead_time_days AS "leadTimeDays", name FROM suppliers WHERE business_id = $1 AND id = $2`, ctx.businessId, supplierId);
  if (!supplier) throw new NotFoundError("Supplier not found.");
  return tx(async () => {
    const code = await nextCode(ctx, "purchase_orders", "PO-", 4);
    const po = await one<{ id: number }>(
      `INSERT INTO purchase_orders (business_id, code, supplier_id, status, recommendation_id, created_by, placed_at, expected_at) VALUES ($1, $2, $3, 'placed', $4, $5, $6, $7) RETURNING id`,
      ctx.businessId, code, supplier.id, recommendationId, ctx.user.id, nowOf(ctx), new Date(nowOf(ctx).getTime() + supplier.leadTimeDays * DAY),
    );
    for (const l of lines) {
      const v = await one<{ id: number; cost: number }>(
        `SELECT v.id, p.unit_cost AS cost FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.business_id = $1 AND v.id = $2 AND p.supplier_id = $3`,
        ctx.businessId, l.variantId, supplier.id,
      );
      if (!v) throw new DomainError("A purchase line isn't supplied by this supplier.");
      await run(`INSERT INTO purchase_order_items (purchase_order_id, variant_id, qty, unit_cost) VALUES ($1, $2, $3, $4)`, po!.id, v.id, l.qty, v.cost);
    }
    await audit(ctx, "purchase_order.placed", { type: "purchase_order", id: po!.id, code }, null, { supplier: supplier.name, lines: lines.length, recommendation: recommendationId });
    return { id: po!.id, code };
  });
}

export async function receivePurchaseOrder(ctx: Ctx, poId: number) {
  need(ctx, "warehouse.write");
  const result = await tx(async () => {
    const po = await one<{ id: number; code: string; status: string; supplierId: number }>(`SELECT id, code, status, supplier_id AS "supplierId" FROM purchase_orders WHERE business_id = $1 AND id = $2 FOR UPDATE`, ctx.businessId, poId);
    if (!po) throw new NotFoundError("Purchase order not found.");
    if (!["placed", "partially_received"].includes(po.status)) throw new DomainError(`${po.code} is ${po.status.replace("_", " ")}.`);
    const items = await q<{ id: number; variantId: number; qty: number; received: number; home: number }>(
      `SELECT pi.id, pi.variant_id AS "variantId", pi.qty, pi.qty_received AS received, v.home_location_id AS home
         FROM purchase_order_items pi JOIN product_variants v ON v.id = pi.variant_id WHERE pi.purchase_order_id = $1`,
      po.id,
    );
    const code = await nextCode(ctx, "receipts", "GRN-", 4);
    const grn = await one<{ id: number }>(`INSERT INTO receipts (business_id, code, purchase_order_id, supplier_id, received_at, received_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, ctx.businessId, code, po.id, po.supplierId, nowOf(ctx), ctx.user.id);
    const variants: number[] = [];
    let unitsIn = 0;
    for (const i of items) {
      const qty = i.qty - i.received;
      if (qty <= 0) continue;
      await run(`INSERT INTO receipt_items (receipt_id, purchase_order_item_id, variant_id, location_id, qty) VALUES ($1, $2, $3, $4, $5)`, grn!.id, i.id, i.variantId, i.home, qty);
      await post(ctx, { variantId: i.variantId, locationId: i.home, type: "receipt", qty, ref: { type: "receipt", id: grn!.id, code } });
      await run(`UPDATE purchase_order_items SET qty_received = qty WHERE id = $1`, i.id);
      variants.push(i.variantId);
      unitsIn += qty;
    }
    await run(`UPDATE purchase_orders SET status = 'received' WHERE id = $1`, po.id);
    await audit(ctx, "receipt.posted", { type: "receipt", id: grn!.id, code }, null, { po: po.code, units: unitsIn });
    return { code, variants, units: unitsIn };
  });
  const backfilled = result.variants.length ? await fillBackorders(ctx, result.variants) : 0;
  return { ...result, backfilled };
}

export async function purchaseOrders(ctx: Ctx) {
  return q<{ id: number; code: string; supplier: string; status: string; placedAt: Date; expectedAt: Date; units: number; value: number; received: number; recommendation: string | null }>(
    `SELECT po.id, po.code, s.name AS supplier, po.status, po.placed_at AS "placedAt", po.expected_at AS "expectedAt",
            SUM(pi.qty)::int AS units, SUM(pi.qty * pi.unit_cost)::int AS value, SUM(pi.qty_received)::int AS received, r.code AS recommendation
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id JOIN purchase_order_items pi ON pi.purchase_order_id = po.id
       LEFT JOIN recommendations r ON r.id = po.recommendation_id
      WHERE po.business_id = $1 GROUP BY po.id, s.name, r.code ORDER BY (po.status = 'placed') DESC, po.placed_at DESC LIMIT 15`,
    ctx.businessId,
  );
}
