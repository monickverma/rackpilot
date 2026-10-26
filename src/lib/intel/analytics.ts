// Sales and inventory analytics at the level of individual variants. Units
// and revenue come from dispatch records valued at the order's price; gross
// margin uses the catalogue unit cost. Orders with an open OrderTrace case
// can be excluded, and days with no recorded orders are flagged as possible
// missing data instead of being read as no demand.

import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import { DAY } from "../format.ts";
import { stockLines, type StockLine } from "../ops/stock.ts";
import { demand, type Demand } from "./demand.ts";

export interface SaleRow {
  variantId: number; sku: string; productId: number; productCode: string; productName: string; design: string; category: string; colour: string; size: string;
  units: number; revenue: number; cost: number;
}

export async function sales(ctx: Ctx, days: number, opts: { excludeOpenCases?: boolean; now?: Date } = {}): Promise<SaleRow[]> {
  const now = opts.now ?? ctx.now ?? new Date();
  return q<SaleRow>(
    `SELECT v.id AS "variantId", v.sku, p.id AS "productId", p.code AS "productCode", p.name AS "productName", p.design, p.category, v.colour, v.size,
            SUM(si.qty)::int AS units, SUM(si.qty * oi.unit_price)::int AS revenue, SUM(si.qty * p.unit_cost)::int AS cost
       FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id JOIN order_items oi ON oi.id = si.order_item_id
       JOIN product_variants v ON v.id = si.variant_id JOIN products p ON p.id = v.product_id
      WHERE s.business_id = $1 AND s.dispatched_at > $2::timestamptz - make_interval(days => $3) AND s.dispatched_at <= $2
        AND (NOT $4 OR NOT EXISTS (SELECT 1 FROM investigations i WHERE i.business_id = s.business_id AND i.case_key = 'order:' || s.order_id AND i.status NOT IN ('resolved', 'closed')))
      GROUP BY v.id, p.id ORDER BY units DESC`,
    ctx.businessId, now, days, opts.excludeOpenCases ?? false,
  );
}

export function rollup<K extends string>(rows: SaleRow[], key: (r: SaleRow) => K) {
  const m = new Map<K, { key: K; units: number; revenue: number; cost: number }>();
  for (const r of rows) {
    const k = key(r);
    const x = m.get(k) ?? { key: k, units: 0, revenue: 0, cost: 0 };
    x.units += r.units;
    x.revenue += r.revenue;
    x.cost += r.cost;
    m.set(k, x);
  }
  return [...m.values()].map((x) => ({ ...x, margin: x.revenue - x.cost, marginPct: x.revenue ? (x.revenue - x.cost) / x.revenue : 0 })).sort((a, b) => b.units - a.units);
}

export async function weeklyTrend(ctx: Ctx, weeks = 20, now = ctx.now ?? new Date()) {
  const IST = 5.5 * 3_600_000;
  const end = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
  const start = end - weeks * 7 * DAY;
  const rows = await q<{ bucket: number; units: number; revenue: number; orders: number }>(
    `SELECT FLOOR(EXTRACT(EPOCH FROM (s.dispatched_at - $2::timestamptz)) / 604800)::int AS bucket, SUM(si.qty)::int AS units,
            SUM(si.qty * oi.unit_price)::int AS revenue, COUNT(DISTINCT s.order_id)::int AS orders
       FROM shipments s JOIN shipment_items si ON si.shipment_id = s.id JOIN order_items oi ON oi.id = si.order_item_id
      WHERE s.business_id = $1 AND s.dispatched_at >= $2 AND s.dispatched_at < $3 GROUP BY 1`,
    ctx.businessId, new Date(start), new Date(end),
  );
  const by = new Map(rows.map((r) => [r.bucket, r]));
  return Array.from({ length: weeks }, (_, i) => ({ start: new Date(start + i * 7 * DAY), units: by.get(i)?.units ?? 0, revenue: by.get(i)?.revenue ?? 0, orders: by.get(i)?.orders ?? 0 }));
}

/** Days the business normally trades but recorded no orders: likely missing records, not missing demand. */
export async function dataGaps(ctx: Ctx, days = 120, now = ctx.now ?? new Date()) {
  const IST = 5.5 * 3_600_000;
  const rows = await q<{ day: number; n: number }>(
    `SELECT FLOOR((EXTRACT(EPOCH FROM created_at) * 1000 + $3) / 86400000)::int AS day, COUNT(*)::int AS n FROM orders
      WHERE business_id = $1 AND created_at > $2::timestamptz - make_interval(days => $4) GROUP BY 1`,
    ctx.businessId, now, IST, days,
  );
  const today = Math.floor((now.getTime() + IST) / DAY);
  const counts = new Map(rows.map((r) => [r.day, r.n]));
  const byWeekday = new Map<number, number[]>();
  for (let d = today - days; d < today; d++) {
    const wd = new Date(d * DAY).getUTCDay();
    byWeekday.set(wd, [...(byWeekday.get(wd) ?? []), counts.get(d) ?? 0]);
  }
  const avg = new Map([...byWeekday].map(([wd, xs]) => [wd, xs.reduce((a, b) => a + b, 0) / xs.length]));
  const gaps: number[] = [];
  for (let d = today - days; d < today; d++) if ((counts.get(d) ?? 0) === 0 && (avg.get(new Date(d * DAY).getUTCDay()) ?? 0) >= 1.2) gaps.push(d);
  // Only runs of three or more trading days count; a quiet day or two is normal.
  const runs: { from: Date; to: Date; days: number }[] = [];
  for (let i = 0; i < gaps.length; i++) {
    let j = i;
    while (j + 1 < gaps.length && gaps[j + 1] - gaps[j] <= 2) j++;
    if (j - i >= 2) runs.push({ from: new Date(gaps[i] * DAY - IST), to: new Date(gaps[j] * DAY - IST), days: j - i + 1 });
    i = j;
  }
  return runs;
}

export type Health = "selling" | "slow" | "dead" | "too-new" | "out-of-season" | "no-stock";

export interface VariantHealth extends StockLine {
  demand: Demand | null;
  onOrder: number;
  nextDelivery: Date | null;
  coverDays: number | null;
  daysSinceOrder: number | null;
  ageDays: number;
  health: Health;
  stockValue: number;
}

/** Season windows by month for the catalogue's seasonal profiles. */
export function inSeason(season: string | null, month: number) {
  if (!season) return true;
  if (season === "summer") return month >= 3 && month <= 8;
  if (season === "winter") return month >= 10 || month <= 2;
  if (season === "festive") return month >= 9 && month <= 11;
  return true;
}

export async function variantHealth(ctx: Ctx, now = ctx.now ?? new Date()): Promise<VariantHealth[]> {
  const [lines, dem, gaps, incoming] = await Promise.all([
    stockLines(ctx), demand(ctx, now), dataGaps(ctx, 120, now),
    q<{ variantId: number; qty: number; next: Date }>(
      `SELECT pi.variant_id AS "variantId", SUM(pi.qty - pi.qty_received)::int AS qty, MIN(po.expected_at) AS next FROM purchase_order_items pi
         JOIN purchase_orders po ON po.id = pi.purchase_order_id WHERE po.business_id = $1 AND po.status IN ('placed', 'partially_received') GROUP BY 1`,
      ctx.businessId,
    ),
  ]);
  const onOrder = new Map(incoming.map((i) => [i.variantId, i]));
  const month = new Date(now.getTime() + 5.5 * 3_600_000).getUTCMonth() + 1;
  const gapDays = gaps.reduce((a, g) => a + g.days, 0);
  return lines.map((l) => {
    const d = dem.get(l.variantId) ?? null;
    const rate = d?.rate ?? 0;
    const ageDays = Math.floor((now.getTime() - new Date(l.launchedAt).getTime()) / DAY);
    const daysSinceOrder = d?.lastOrderedAt ? Math.floor((now.getTime() - d.lastOrderedAt.getTime()) / DAY) : null;
    let health: Health;
    if (l.onHand <= 0) health = "no-stock";
    else if (ageDays < 28) health = "too-new";
    else if (!inSeason(l.season, month) && (daysSinceOrder === null || daysSinceOrder > 21)) health = "out-of-season";
    else if ((daysSinceOrder === null || daysSinceOrder > 60) && ageDays > 60 + gapDays) health = "dead";
    else if (rate > 0 && l.available / rate > 120) health = "slow";
    else if (rate === 0 && (daysSinceOrder ?? 999) > 30) health = "slow";
    else health = "selling";
    const inc = onOrder.get(l.variantId);
    return { ...l, demand: d, onOrder: inc?.qty ?? 0, nextDelivery: inc?.next ?? null, coverDays: rate > 0 ? l.available / rate : null, daysSinceOrder, ageDays, health, stockValue: l.onHand * l.unitCost };
  });
}

/** Days in the last N each variant had no sellable stock on hand, replayed from the ledger. */
export async function stockoutDays(ctx: Ctx, days = 90, now = ctx.now ?? new Date()) {
  const start = now.getTime() - days * DAY;
  const [before, moves] = await Promise.all([
    q<{ variantId: number; qty: number }>(
      `SELECT m.variant_id AS "variantId", SUM(m.qty)::int AS qty FROM stock_movements m JOIN locations l ON l.id = m.location_id
        WHERE m.business_id = $1 AND l.sellable AND m.created_at < $2 GROUP BY 1`,
      ctx.businessId, new Date(start),
    ),
    q<{ variantId: number; qty: number; at: Date }>(
      `SELECT m.variant_id AS "variantId", m.qty, m.created_at AS at FROM stock_movements m JOIN locations l ON l.id = m.location_id
        WHERE m.business_id = $1 AND l.sellable AND m.created_at >= $2 AND m.created_at <= $3 ORDER BY m.created_at, m.id`,
      ctx.businessId, new Date(start), now,
    ),
  ]);
  const level = new Map(before.map((b) => [b.variantId, b.qty]));
  const out = new Map<number, number>();
  let i = 0;
  for (let d = 1; d <= days; d++) {
    const dayEnd = start + d * DAY;
    while (i < moves.length && moves[i].at.getTime() < dayEnd) {
      level.set(moves[i].variantId, (level.get(moves[i].variantId) ?? 0) + moves[i].qty);
      i++;
    }
    for (const [v, qty] of level) if (qty <= 0) out.set(v, (out.get(v) ?? 0) + 1);
  }
  return out;
}

export async function commitments(ctx: Ctx) {
  const rows = await q<{ openOrders: number; reservedUnits: number; reservedValue: number; backorderUnits: number; backorderValue: number }>(
    `SELECT (SELECT COUNT(*)::int FROM orders WHERE business_id = $1 AND status IN ('confirmed', 'picking', 'packed')) AS "openOrders",
            COALESCE((SELECT SUM(r.qty) FROM reservations r WHERE r.business_id = $1 AND r.status IN ('active', 'picked')), 0)::int AS "reservedUnits",
            COALESCE((SELECT SUM(r.qty * oi.unit_price) FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id WHERE r.business_id = $1 AND r.status IN ('active', 'picked')), 0)::int AS "reservedValue",
            COALESCE((SELECT SUM(GREATEST(oi.qty_ordered - oi.qty_cancelled - COALESCE(s.shipped, 0) - COALESCE(h.held, 0), 0)) FROM order_items oi JOIN orders o ON o.id = oi.order_id
               LEFT JOIN (SELECT order_item_id, SUM(qty) AS shipped FROM shipment_items GROUP BY 1) s ON s.order_item_id = oi.id
               LEFT JOIN (SELECT order_item_id, SUM(qty) AS held FROM reservations WHERE status IN ('active', 'picked') GROUP BY 1) h ON h.order_item_id = oi.id
              WHERE oi.business_id = $1 AND o.status NOT IN ('completed', 'cancelled')), 0)::int AS "backorderUnits",
            COALESCE((SELECT SUM(GREATEST(oi.qty_ordered - oi.qty_cancelled - COALESCE(s.shipped, 0) - COALESCE(h.held, 0), 0) * oi.unit_price) FROM order_items oi JOIN orders o ON o.id = oi.order_id
               LEFT JOIN (SELECT order_item_id, SUM(qty) AS shipped FROM shipment_items GROUP BY 1) s ON s.order_item_id = oi.id
               LEFT JOIN (SELECT order_item_id, SUM(qty) AS held FROM reservations WHERE status IN ('active', 'picked') GROUP BY 1) h ON h.order_item_id = oi.id
              WHERE oi.business_id = $1 AND o.status NOT IN ('completed', 'cancelled')), 0)::int AS "backorderValue"`,
    ctx.businessId,
  );
  return rows[0];
}

/** Units and value under open investigations, so reports and plans can show what is uncertain. */
export async function uncertainty(ctx: Ctx) {
  const stock = await q<{ variantId: number; locationId: number; code: string; units: number }>(
    `SELECT CAST(split_part(i.case_key, ':', 2) AS int) AS "variantId", CAST(split_part(i.case_key, ':', 3) AS int) AS "locationId", i.code,
            COALESCE(MAX(ABS(f.actual_value - f.expected_value)) FILTER (WHERE f.rule_id IN ('SS-COUNT', 'SS-DUP', 'SS-LEDGER') AND f.kind IN ('fact', 'inference')), 0)::int AS units
       FROM investigations i JOIN investigation_findings f ON f.investigation_id = i.id
      WHERE i.business_id = $1 AND i.status NOT IN ('resolved', 'closed') AND i.case_key LIKE 'stock:%' AND f.status = 'open'
      GROUP BY i.id`,
    ctx.businessId,
  );
  const orders = await q<{ orders: number }>(
    `SELECT COUNT(*)::int AS orders FROM investigations WHERE business_id = $1 AND status NOT IN ('resolved', 'closed') AND case_key LIKE 'order:%'`,
    ctx.businessId,
  );
  return { stock, openOrderCases: orders[0]?.orders ?? 0 };
}
