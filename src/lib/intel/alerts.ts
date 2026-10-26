// Stock alerts and exceptions. Each alert comes from an explicit rule over
// the data and says exactly what triggered it. A low-stock alert on a balance
// that is under investigation says so, because the low number may be wrong.

import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import { DAY, dueIn, round1, rupees, units } from "../format.ts";
import { uncertainty, variantHealth } from "./analytics.ts";

export type AlertKind = "low_stock" | "cannot_fulfil" | "competing" | "verify_location" | "deadline" | "count_discrepancy" | "transaction" | "unsold";

export interface Alert {
  kind: AlertKind;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  rule: string;
  href: string;
  sku?: string;
}

export const ALERT_RULES: Record<AlertKind, { name: string; rule: string }> = {
  low_stock: { name: "Running low", rule: "Free stock plus stock on order, ÷ daily demand (28 days), is less than the supplier's lead time: it runs out before a new order could arrive." },
  cannot_fulfil: { name: "Can't be fully fulfilled", rule: "An open order line has units neither reserved nor shipped." },
  competing: { name: "Orders competing for stock", rule: "One open order is short on a variant while other open orders hold all of it." },
  verify_location: { name: "Location needs verification", rule: "A picker found less than recorded, or a count is pending for the bin." },
  deadline: { name: "Deadline at risk", rule: "Due within 24 hours (or late) and not yet dispatched." },
  count_discrepancy: { name: "Count discrepancy", rule: "An open StockSleuth case: recorded stock and the shelf disagree." },
  transaction: { name: "Transaction discrepancy", rule: "An open OrderTrace case: order, invoice, payment and dispatch disagree." },
  unsold: { name: "Unsold stock", rule: "Stock on hand, no orders for 60+ days, product older than 60 days, and the period's sales records are complete." },
};

export async function alerts(ctx: Ctx, now = ctx.now ?? new Date()): Promise<Alert[]> {
  const out: Alert[] = [];
  const [health, unsure, short, flagged, due, cases] = await Promise.all([
    variantHealth(ctx, now),
    uncertainty(ctx),
    q<{ orderId: number; code: string; customer: string; sku: string; variantId: number; short: number; backordered: boolean }>(
      `SELECT o.id AS "orderId", o.code, c.name AS customer, v.sku, v.id AS "variantId", oi.backordered,
              (oi.qty_ordered - oi.qty_cancelled - COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)
                - COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked')), 0))::int AS short
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN customers c ON c.id = o.customer_id JOIN product_variants v ON v.id = oi.variant_id
        WHERE oi.business_id = $1 AND o.status IN ('confirmed', 'picking', 'packed')`,
      ctx.businessId,
    ),
    q<{ sku: string; location: string; note: string | null }>(
      `SELECT v.sku, l.code AS location, b.verification_note AS note FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id JOIN locations l ON l.id = b.location_id
        WHERE b.business_id = $1 AND b.needs_verification`,
      ctx.businessId,
    ),
    q<{ id: number; code: string; customer: string; dueAt: Date; status: string }>(
      `SELECT o.id, o.code, c.name AS customer, o.due_at AS "dueAt", o.status FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.business_id = $1 AND o.status IN ('confirmed', 'picking', 'packed') AND o.due_at IS NOT NULL AND o.due_at < $2`,
      ctx.businessId, new Date(now.getTime() + DAY),
    ),
    q<{ code: string; title: string; priority: string; caseKey: string }>(
      `SELECT code, title, priority, case_key AS "caseKey" FROM investigations WHERE business_id = $1 AND status NOT IN ('resolved', 'closed')`,
      ctx.businessId,
    ),
  ]);
  const unsureVariants = new Map(unsure.stock.map((s) => [s.variantId, s.code]));

  for (const h of health) {
    const rate = h.demand?.rate ?? 0;
    if (rate <= 0 || h.health === "out-of-season") continue;
    const cover = (Math.max(h.available, 0) + h.onOrder) / rate;
    if (cover >= h.leadTimeDays) continue;
    const caseCode = unsureVariants.get(h.variantId);
    const out0 = h.available <= 0 && !h.onOrder;
    out.push({
      kind: "low_stock", severity: out0 || cover < h.leadTimeDays / 2 ? "high" : "medium", sku: h.sku, href: `/inventory/${h.sku}`,
      title: `${h.sku} ${out0 ? "is out of stock with nothing on order" : `has ${round1(cover)} days of cover`}${caseCode ? " — balance under investigation" : ""}`,
      detail: `${units(Math.max(h.available, 0))} free (${h.onHand} on hand, ${h.reserved} reserved)${h.onOrder ? ` + ${units(h.onOrder)} on order` : ", nothing on order"}; ordered ${h.demand?.ordered28 ?? 0} in 28 days (${round1(rate)}/day); ${h.supplierName} takes ${h.leadTimeDays} days.${caseCode ? ` The recorded balance is disputed in ${caseCode}, so the real figure may differ.` : ""}`,
      rule: ALERT_RULES.low_stock.rule,
    });
  }
  const shortLines = short.filter((s) => s.short > 0);
  for (const s of shortLines) {
    out.push({
      kind: "cannot_fulfil", severity: s.backordered ? "medium" : "high", sku: s.sku, href: `/orders/${s.code}`,
      title: `${s.code} (${s.customer}) is short ${units(s.short)} of ${s.sku}`,
      detail: s.backordered ? "On backorder: it will be reserved when stock arrives." : "The owner hasn't decided yet: backorder it, or ship what is reserved.",
      rule: ALERT_RULES.cannot_fulfil.rule,
    });
  }
  const holders = await q<{ variantId: number; orders: number; held: number }>(
    `SELECT r.variant_id AS "variantId", COUNT(DISTINCT oi.order_id)::int AS orders, SUM(r.qty)::int AS held FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id
      WHERE r.business_id = $1 AND r.status IN ('active', 'picked') GROUP BY 1`,
    ctx.businessId,
  );
  const held = new Map(holders.map((h) => [h.variantId, h]));
  const seen = new Set<number>();
  for (const s of shortLines) {
    const h = held.get(s.variantId);
    const free = health.find((x) => x.variantId === s.variantId)?.available ?? 0;
    if (!h || seen.has(s.variantId) || free > 0) continue;
    seen.add(s.variantId);
    out.push({
      kind: "competing", severity: "medium", sku: s.sku, href: `/inventory/${s.sku}`,
      title: `${h.orders} other ${h.orders === 1 ? "order holds" : "orders hold"} all ${units(h.held)} of ${s.sku}`,
      detail: `${s.code} is short while the remaining stock is promised elsewhere. Reservations are first come, first served; changing that is the owner's call.`,
      rule: ALERT_RULES.competing.rule,
    });
  }
  for (const f of flagged) out.push({ kind: "verify_location", severity: "medium", sku: f.sku, href: `/inventory/${f.sku}`, title: `Verify ${f.sku} at ${f.location}`, detail: f.note ?? "Flagged for verification.", rule: ALERT_RULES.verify_location.rule });
  for (const d of due) out.push({ kind: "deadline", severity: d.dueAt < now ? "high" : "medium", href: `/orders/${d.code}`, title: `${d.code} for ${d.customer} is ${dueIn(d.dueAt, now)}`, detail: `Status: ${d.status}. Not dispatched yet.`, rule: ALERT_RULES.deadline.rule });
  for (const c of cases) {
    const stock = c.caseKey.startsWith("stock:");
    out.push({ kind: stock ? "count_discrepancy" : "transaction", severity: c.priority === "high" ? "high" : "medium", href: `/investigations/${c.code}`, title: `${c.code}: ${c.title}`, detail: stock ? "Recorded stock may not match the shelf until this is resolved." : "These records disagree until this is resolved.", rule: (stock ? ALERT_RULES.count_discrepancy : ALERT_RULES.transaction).rule });
  }
  const dead = health.filter((h) => h.health === "dead").sort((a, b) => b.stockValue - a.stockValue);
  for (const d of dead.slice(0, 8)) {
    out.push({ kind: "unsold", severity: "low", sku: d.sku, href: `/inventory/${d.sku}`, title: `${d.sku}: ${units(d.onHand)} unsold for ${d.daysSinceOrder ?? "60+"} days`, detail: `${rupees(d.stockValue)} at cost on the rack.`, rule: ALERT_RULES.unsold.rule });
  }
  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
