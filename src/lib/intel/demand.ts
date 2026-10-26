// Demand per variant, from what customers ordered (not just what shipped, so
// a stockout doesn't hide demand), and a backtest of the simple forecast the
// replenishment plan uses. The forecast's accuracy is measured, not claimed.

import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import { DAY } from "../format.ts";

export interface Demand {
  variantId: number;
  ordered28: number;
  ordered14: number;
  ordered90: number;
  rate: number;
  rate14: number;
  rising: boolean;
  lastOrderedAt: Date | null;
}

export async function demand(ctx: Ctx, now = ctx.now ?? new Date()): Promise<Map<number, Demand>> {
  const rows = await q<{ variantId: number; o28: number; o14: number; o90: number; last: Date | null }>(
    `SELECT oi.variant_id AS "variantId",
            SUM(oi.qty_ordered) FILTER (WHERE o.created_at > $2::timestamptz - interval '28 days')::int AS o28,
            SUM(oi.qty_ordered) FILTER (WHERE o.created_at > $2::timestamptz - interval '14 days')::int AS o14,
            SUM(oi.qty_ordered) FILTER (WHERE o.created_at > $2::timestamptz - interval '90 days')::int AS o90,
            MAX(o.created_at) AS last
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.business_id = $1 AND o.status <> 'cancelled' AND o.created_at <= $2 GROUP BY oi.variant_id`,
    ctx.businessId, now,
  );
  const out = new Map<number, Demand>();
  for (const r of rows) {
    const rate28 = (r.o28 ?? 0) / 28;
    const rate14 = (r.o14 ?? 0) / 14;
    const rising = rate14 > rate28 * 1.3 && (r.o14 ?? 0) >= 6;
    out.set(r.variantId, {
      variantId: r.variantId, ordered28: r.o28 ?? 0, ordered14: r.o14 ?? 0, ordered90: r.o90 ?? 0,
      rate: rising ? (rate28 + rate14) / 2 : rate28, rate14, rising, lastOrderedAt: r.last,
    });
  }
  return out;
}

export interface Backtest {
  weeks: number;
  method: string;
  /** Variant-week level: the hardest test, since wholesale orders arrive in lumps. */
  wape: number;
  bias: number;
  naiveWape: number;
  /** The same forecasts summed to product-week level. */
  productWape: number;
  productNaiveWape: number;
  /** Whole-business weekly units. */
  totalWape: number;
  actualUnits: number;
  perWeek: { weekEnding: Date; actual: number; forecast: number; naive: number; absError: number }[];
}

/**
 * Walks back over the last N complete weeks. For each, forecasts every
 * variant's demand from the 28 days before it (the plan's method), and
 * compares with what was actually ordered that week. WAPE = Σ|forecast −
 * actual| ÷ Σ actual, summed over variant-weeks. A naive forecast (repeat last
 * week) is the baseline it has to beat.
 */
export async function backtest(ctx: Ctx, weeks = 8, now = ctx.now ?? new Date()): Promise<Backtest> {
  const IST = 5.5 * 3_600_000;
  const end = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
  const start = end - (weeks * 7 + 28) * DAY;
  const rows = await q<{ variantId: number; productId: number; at: Date; qty: number }>(
    `SELECT oi.variant_id AS "variantId", v.product_id AS "productId", o.created_at AS at, oi.qty_ordered AS qty
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN product_variants v ON v.id = oi.variant_id
      WHERE oi.business_id = $1 AND o.status <> 'cancelled' AND o.created_at >= $2 AND o.created_at < $3`,
    ctx.businessId, new Date(start), new Date(end),
  );
  const variants = new Set(rows.map((r) => r.variantId));
  const sum = (v: number, from: number, to: number) => rows.filter((r) => r.variantId === v && r.at.getTime() >= from && r.at.getTime() < to).reduce((a, r) => a + r.qty, 0);
  const perWeek: Backtest["perWeek"] = [];
  let absErr = 0;
  let signed = 0;
  let actualAll = 0;
  let naiveErr = 0;
  let productErr = 0;
  let productNaiveErr = 0;
  let totalErr = 0;
  const productOf = new Map(rows.map((r) => [r.variantId, r.productId]));
  for (let k = weeks; k >= 1; k--) {
    const byProduct = new Map<number, { a: number; f: number; n: number }>();
    const wEnd = end - (k - 1) * 7 * DAY;
    const wStart = wEnd - 7 * DAY;
    let wa = 0;
    let wf = 0;
    let wn = 0;
    let we = 0;
    for (const v of variants) {
      const actual = sum(v, wStart, wEnd);
      const forecast = (sum(v, wStart - 28 * DAY, wStart) / 28) * 7;
      const naive = sum(v, wStart - 7 * DAY, wStart);
      wa += actual;
      wf += forecast;
      wn += naive;
      we += Math.abs(forecast - actual);
      absErr += Math.abs(forecast - actual);
      signed += forecast - actual;
      naiveErr += Math.abs(naive - actual);
      actualAll += actual;
      const p = byProduct.get(productOf.get(v)!) ?? { a: 0, f: 0, n: 0 };
      p.a += actual;
      p.f += forecast;
      p.n += naive;
      byProduct.set(productOf.get(v)!, p);
    }
    for (const p of byProduct.values()) {
      productErr += Math.abs(p.f - p.a);
      productNaiveErr += Math.abs(p.n - p.a);
    }
    totalErr += Math.abs(wf - wa);
    perWeek.push({ weekEnding: new Date(wEnd), actual: wa, forecast: Math.round(wf), naive: wn, absError: Math.round(we) });
  }
  return {
    weeks, method: "Daily rate over the previous 28 days × 7, per variant", wape: actualAll ? absErr / actualAll : 0, bias: actualAll ? signed / actualAll : 0,
    naiveWape: actualAll ? naiveErr / actualAll : 0, productWape: actualAll ? productErr / actualAll : 0, productNaiveWape: actualAll ? productNaiveErr / actualAll : 0,
    totalWape: actualAll ? totalErr / actualAll : 0, actualUnits: actualAll, perWeek,
  };
}
