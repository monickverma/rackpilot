// The budget-aware purchasing plan: "I've got ₹30,000. What should I order,
// and which existing orders could run short?"
//
// For each variant:
//   target   = demand rate × (supplier lead time + review period + safety days)
//   position = verified available + on order − backordered
//   need     = target − position, rounded up to the supplier's pack size
// "Verified available" leaves out units an open StockSleuth case says may not
// be there, so a stock discrepancy is neither ignored nor counted as a sure
// shortage; the plan shows the difference either way.
//
// Lines are funded in priority order (customers already waiting, then stock
// that runs out before a delivery could arrive, then stock below target),
// best margin per rupee first within a tier, until the budget is spent. The
// budget is a hard limit. A supplier whose lines don't reach its minimum
// order is topped up if the budget allows, otherwise dropped, with the reason.
// Nothing is ordered until the owner approves the plan.

import { one, q, run, tx } from "../../db/client.ts";
import { audit, DomainError, need, nowOf, type Ctx } from "../context.ts";
import { pct, rupees, round1, units } from "../format.ts";
import { placePurchaseOrder } from "../ops/purchasing.ts";
import { nextCode } from "../ops/stock.ts";
import { uncertainty, variantHealth, type VariantHealth } from "./analytics.ts";
import { backtest } from "./demand.ts";

export const REVIEW_DAYS = 7;
export const SAFETY_DAYS = 5;

export interface PlanLine {
  variantId: number; sku: string; productName: string; colour: string; size: string; supplierId: number; supplier: string;
  qty: number; packs: number; packSize: number; unitCost: number; cost: number; unitPrice: number; marginPerUnit: number;
  tier: 1 | 2 | 3; tierLabel: string; need: number; rate: number; onHand: number; reserved: number; available: number; verifiedAvailable: number;
  uncertain: number; uncertainCase: string | null; onOrder: number; backordered: number; coverDays: number | null; leadTime: number; target: number;
  rising: boolean; evidence: string; partial: boolean; toppedUp: boolean;
  /** Units needed before the next delivery could arrive: waiting customers plus lead-time demand. Funded first. */
  urgent: number;
}

export interface Skipped { sku: string; productName: string; reason: string; kind: "budget" | "moq" | "slow" | "season" | "covered" | "new" | "dead"; value?: number }

export interface PlanResult {
  budget: number;
  used: number;
  remaining: number;
  lines: PlanLine[];
  suppliers: { id: number; name: string; units: number; cost: number; moq: number; leadTime: number; status: "ok" | "topped-up" | "dropped" }[];
  notOrdered: Skipped[];
  atRisk: { orderCode: string; orderId: number; customer: string; sku: string; short: number; covered: number; arrivesInDays: number | null }[];
  assumptions: string[];
  risks: string[];
  backtest: { wape: number; naiveWape: number; productWape: number; totalWape: number; bias: number; weeks: number };
  generatedAt: string;
}

const TIER_LABEL = { 1: "Customers waiting", 2: "Runs out before a delivery", 3: "Below target cover" } as const;

export async function buildPlan(ctx: Ctx, budget: number): Promise<PlanResult> {
  if (!Number.isFinite(budget) || budget < 1000 || budget > 10_000_000) throw new DomainError("Budget must be between ₹1,000 and ₹1,00,00,000.");
  const now = nowOf(ctx);
  const [health, onOrder, backorders, unsure, bt, suppliers] = await Promise.all([
    variantHealth(ctx, now),
    q<{ variantId: number; qty: number; expected: Date }>(
      `SELECT pi.variant_id AS "variantId", SUM(pi.qty - pi.qty_received)::int AS qty, MIN(po.expected_at) AS expected FROM purchase_order_items pi
         JOIN purchase_orders po ON po.id = pi.purchase_order_id WHERE po.business_id = $1 AND po.status IN ('placed', 'partially_received') GROUP BY 1`,
      ctx.businessId,
    ),
    q<{ variantId: number; orderId: number; orderCode: string; customer: string; short: number; createdAt: Date }>(
      `SELECT oi.variant_id AS "variantId", o.id AS "orderId", o.code AS "orderCode", c.name AS customer, o.created_at AS "createdAt",
              (oi.qty_ordered - oi.qty_cancelled - COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)
                 - COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked')), 0))::int AS short
         FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN customers c ON c.id = o.customer_id
        WHERE oi.business_id = $1 AND o.status NOT IN ('completed', 'cancelled')`,
      ctx.businessId,
    ),
    uncertainty(ctx),
    backtest(ctx, 8, now),
    q<{ id: number; name: string; moq: number; packSize: number; leadTime: number }>(
      `SELECT id, name, moq_units AS moq, pack_size AS "packSize", lead_time_days AS "leadTime" FROM suppliers WHERE business_id = $1`,
      ctx.businessId,
    ),
  ]);
  const onOrderBy = new Map(onOrder.map((o) => [o.variantId, o]));
  const waiting = backorders.filter((b) => b.short > 0);
  const backBy = new Map<number, number>();
  for (const b of waiting) backBy.set(b.variantId, (backBy.get(b.variantId) ?? 0) + b.short);
  const unsureBy = new Map<number, { units: number; code: string }>();
  for (const u of unsure.stock) if (u.units > 0) unsureBy.set(u.variantId, { units: (unsureBy.get(u.variantId)?.units ?? 0) + u.units, code: u.code });

  const candidates: PlanLine[] = [];
  const skipped: Skipped[] = [];
  for (const h of health) {
    const back = backBy.get(h.variantId) ?? 0;
    const rate = h.demand?.rate ?? 0;
    const ord = onOrderBy.get(h.variantId)?.qty ?? 0;
    const uncertain = Math.min(unsureBy.get(h.variantId)?.units ?? 0, Math.max(h.available, 0));
    const verified = h.available - uncertain;
    const days = h.leadTimeDays + REVIEW_DAYS + SAFETY_DAYS;
    const target = rate * days;
    const position = verified + ord - back;
    if (!back) {
      if (h.health === "dead") { skipped.push({ sku: h.sku, productName: h.productName, kind: "dead", value: h.stockValue, reason: `No orders in ${h.daysSinceOrder ?? "over 60"} days; ${units(h.onHand)} on hand (${rupees(h.stockValue)} at cost). Clear it before buying more.` }); continue; }
      if (h.health === "out-of-season") { if (h.onHand > 0) skipped.push({ sku: h.sku, productName: h.productName, kind: "season", value: h.stockValue, reason: `Out of season (${h.season}); ${units(h.onHand)} still on hand. Don't reorder until the season returns.` }); continue; }
      if (h.health === "too-new" && rate === 0) { skipped.push({ sku: h.sku, productName: h.productName, kind: "new", reason: `Launched ${h.ageDays} days ago with no orders yet: too little history to size a reorder.` }); continue; }
    }
    if (rate <= 0 && !back) continue;
    const needUnits = Math.ceil(target - position);
    if (needUnits <= 0) {
      if (h.coverDays !== null && h.coverDays > 90 && h.stockValue > 2000) skipped.push({ sku: h.sku, productName: h.productName, kind: "slow", value: h.stockValue, reason: `${round1(h.coverDays)} days of cover at ${round1(rate)}/day. Consider ordering less of this.` });
      else if (rate > 0) skipped.push({ sku: h.sku, productName: h.productName, kind: "covered", reason: `Covered: ${units(Math.max(verified, 0))} available + ${units(ord)} on order covers ${rate > 0 ? Math.round((verified + ord - back) / rate) : "∞"} days; target is ${days}.` });
      continue;
    }
    const sup = suppliers.find((s) => s.id === h.supplierId)!;
    const packs = Math.ceil(needUnits / sup.packSize);
    const qty = packs * sup.packSize;
    const cover = rate > 0 ? Math.max(verified, 0) / rate : null;
    const tier: 1 | 2 | 3 = back > 0 ? 1 : cover !== null && cover < h.leadTimeDays ? 2 : 3;
    const urgentUnits = Math.max(0, Math.ceil(back + rate * h.leadTimeDays - Math.max(verified, 0) - ord));
    const urgent = tier <= 2 ? Math.min(qty, Math.max(sup.packSize, Math.ceil(urgentUnits / sup.packSize) * sup.packSize)) : 0;
    const evidence = [
      `Ordered ${h.demand?.ordered28 ?? 0} in 28 days (${round1(rate)}/day${h.demand?.rising ? `, rising: ${h.demand.ordered14} in the last 14` : ""})`,
      `${units(Math.max(h.available, 0))} available (${h.onHand} on hand, ${h.reserved} reserved)${uncertain ? `, ${uncertain} of them under investigation in ${unsureBy.get(h.variantId)!.code}` : ""}`,
      ord ? `${units(ord)} already on order` : "nothing on order",
      back ? `${units(back)} backordered for customers` : null,
      `${sup.name} delivers in ${h.leadTimeDays} days; target ${days} days of cover = ${Math.ceil(target)}`,
    ].filter(Boolean).join("; ");
    candidates.push({
      variantId: h.variantId, sku: h.sku, productName: h.productName, colour: h.colour, size: h.size, supplierId: sup.id, supplier: sup.name,
      qty, packs, packSize: sup.packSize, unitCost: h.unitCost, cost: qty * h.unitCost, unitPrice: h.unitPrice, marginPerUnit: h.unitPrice - h.unitCost,
      tier, tierLabel: TIER_LABEL[tier], need: needUnits, rate, onHand: h.onHand, reserved: h.reserved, available: h.available, verifiedAvailable: verified,
      uncertain, uncertainCase: unsureBy.get(h.variantId)?.code ?? null, onOrder: ord, backordered: back, coverDays: cover, leadTime: h.leadTimeDays,
      target: Math.ceil(target), rising: h.demand?.rising ?? false, evidence: `${evidence}.`, partial: false, toppedUp: false, urgent,
    });
  }
  candidates.sort((a, b) => a.tier - b.tier || b.marginPerUnit / b.unitCost - a.marginPerUnit / a.unitCost || b.need - a.need);

  // Fund in order; a supplier below its minimum is topped up or dropped, then funding re-runs without it.
  const dropped = new Set<number>();
  const supplierStatus = new Map<number, "ok" | "topped-up" | "dropped">();
  let chosen: PlanLine[] = [];
  let budgetSkipped: Skipped[] = [];
  for (let round = 0; round <= suppliers.length; round++) {
    budgetSkipped = [];
    let left = budget;
    // Pass 1 funds the urgent units of every line; pass 2 tops lines up to their target.
    const funded = new Map<number, number>();
    const live = candidates.filter((c) => !dropped.has(c.supplierId));
    for (const pass of [1, 2] as const) {
      for (const c of live) {
        const want = pass === 1 ? c.urgent : c.qty - (funded.get(c.variantId) ?? 0);
        if (want <= 0) continue;
        const affordable = Math.floor(left / (c.packSize * c.unitCost)) * c.packSize;
        const take = Math.min(want, affordable);
        if (take > 0) {
          funded.set(c.variantId, (funded.get(c.variantId) ?? 0) + take);
          left -= take * c.unitCost;
        }
      }
    }
    chosen = [];
    for (const c of live) {
      const qty = funded.get(c.variantId) ?? 0;
      if (!qty) {
        budgetSkipped.push({ sku: c.sku, productName: c.productName, kind: "budget", value: c.cost, reason: `${c.tierLabel}: needs ${units(c.qty)} (${rupees(c.cost)}) but the budget is spent.` });
        continue;
      }
      chosen.push({ ...c, qty, packs: qty / c.packSize, cost: qty * c.unitCost, partial: qty < c.qty });
    }
    let changed = false;
    for (const s of suppliers) {
      const mine = chosen.filter((l) => l.supplierId === s.id);
      if (!mine.length) continue;
      let total = mine.reduce((a, l) => a + l.qty, 0);
      if (total >= s.moq) {
        supplierStatus.set(s.id, supplierStatus.get(s.id) === "topped-up" ? "topped-up" : "ok");
        continue;
      }
      // Top up the most urgent lines by whole packs while the budget allows.
      let spent = chosen.reduce((a, l) => a + l.cost, 0);
      for (let k = 0; total < s.moq && k < 200; k++) {
        const l = mine[k % mine.length];
        const add = l.packSize * l.unitCost;
        if (spent + add > budget) break;
        l.qty += l.packSize;
        l.packs += 1;
        l.cost += add;
        l.toppedUp = true;
        spent += add;
        total += l.packSize;
      }
      if (total >= s.moq) {
        supplierStatus.set(s.id, "topped-up");
      } else {
        dropped.add(s.id);
        supplierStatus.set(s.id, "dropped");
        changed = true;
      }
    }
    if (!changed) break;
  }
  const used = chosen.reduce((a, l) => a + l.cost, 0);
  if (used > budget) throw new Error("plan exceeded its budget"); // the hard limit is an invariant

  for (const s of suppliers) {
    if (supplierStatus.get(s.id) !== "dropped") continue;
    for (const c of candidates.filter((x) => x.supplierId === s.id)) {
      skipped.push({ sku: c.sku, productName: c.productName, kind: "moq", value: c.cost, reason: `${s.name} needs at least ${units(s.moq)} per order; what the budget allows from them falls short, so their lines were dropped.` });
    }
  }

  const planned = new Map(chosen.map((l) => [l.variantId, l]));
  const atRisk = waiting.map((b) => {
    const line = planned.get(b.variantId);
    const ord = onOrderBy.get(b.variantId);
    return {
      orderCode: b.orderCode, orderId: b.orderId, customer: b.customer, sku: health.find((h) => h.variantId === b.variantId)?.sku ?? "",
      short: b.short, covered: line ? Math.min(line.qty, b.short) : 0,
      arrivesInDays: ord ? Math.max(0, Math.ceil((ord.expected.getTime() - now.getTime()) / 86_400_000)) : line ? line.leadTime : null,
    };
  }).sort((a, b) => b.short - a.short);

  const supplierRows = suppliers.map((s) => {
    const mine = chosen.filter((l) => l.supplierId === s.id);
    return { id: s.id, name: s.name, units: mine.reduce((a, l) => a + l.qty, 0), cost: mine.reduce((a, l) => a + l.cost, 0), moq: s.moq, leadTime: s.leadTime, status: supplierStatus.get(s.id) ?? "ok" };
  }).filter((s) => s.units > 0 || s.status === "dropped");

  const uncertainUnits = chosen.reduce((a, l) => a + l.uncertain, 0);
  const rising = chosen.filter((l) => l.rising).length;
  const assumptions = [
    "Demand is what customers ordered in the last 28 days, including what couldn't be shipped, so stockouts don't hide it. Where the last 14 days run more than 30% above that, the plan uses the average of the two.",
    `Target cover is the supplier's lead time + ${REVIEW_DAYS} review days + ${SAFETY_DAYS} safety days.`,
    "Costs are catalogue unit costs, excluding GST and freight. Lead times and minimum orders come from the supplier records, not from delivery history.",
    "Seasonality is not modelled: there isn't a full year of history yet. Out-of-season products are held back by rule instead.",
  ];
  const risks = [
    `Forecast backtest over the last ${bt.weeks} weeks: per variant and week the error is ${pct(bt.wape)} (repeating last week: ${pct(bt.naiveWape)}), because wholesale orders arrive in lumps; per product ${pct(bt.productWape)}, and for total weekly demand ${pct(bt.totalWape)}. Forecasts ran ${bt.bias >= 0 ? "high" : "low"} by ${pct(Math.abs(bt.bias))}. Treat line quantities as estimates.`,
    uncertainUnits ? `${units(uncertainUnits)} of available stock on planned lines is under investigation and was treated as not available. If those units are found, those lines could be ${units(uncertainUnits)} smaller.` : null,
    rising ? `${rising} planned ${rising === 1 ? "line has" : "lines have"} rising demand; if it keeps rising, cover will be shorter than planned.` : null,
    budgetSkipped.length ? `${budgetSkipped.length} more ${budgetSkipped.length === 1 ? "line needs" : "lines need"} stock (${rupees(budgetSkipped.reduce((a, s) => a + (s.value ?? 0), 0))}) that this budget doesn't reach.` : null,
  ].filter((x): x is string => Boolean(x));

  const notOrdered = [...budgetSkipped, ...skipped.filter((s) => s.kind !== "covered").sort((a, b) => (b.value ?? 0) - (a.value ?? 0))];
  return {
    budget, used, remaining: budget - used, lines: chosen, suppliers: supplierRows, notOrdered, atRisk, assumptions, risks,
    backtest: { wape: bt.wape, naiveWape: bt.naiveWape, productWape: bt.productWape, totalWape: bt.totalWape, bias: bt.bias, weeks: bt.weeks }, generatedAt: now.toISOString(),
  };
}

export async function savePlan(ctx: Ctx, budget: number) {
  const plan = await buildPlan(ctx, budget);
  const code = await nextCode(ctx, "recommendations", "PLAN-", 3);
  const row = await one<{ id: number }>(
    `INSERT INTO recommendations (business_id, code, kind, inputs, output, status, created_by, created_at) VALUES ($1, $2, 'purchase_plan', $3, $4, 'proposed', $5, $6) RETURNING id`,
    ctx.businessId, code, JSON.stringify({ budget, reviewDays: REVIEW_DAYS, safetyDays: SAFETY_DAYS }), JSON.stringify(plan), ctx.user.id, nowOf(ctx),
  );
  await audit(ctx, "plan.proposed", { type: "recommendation", id: row!.id, code }, null, { budget, used: plan.used, lines: plan.lines.length });
  return { id: row!.id, code, plan };
}

export async function getPlan(ctx: Ctx, code: string) {
  return one<{ id: number; code: string; status: string; output: PlanResult; createdAt: Date; createdBy: string | null; decidedBy: string | null; decidedAt: Date | null }>(
    `SELECT r.id, r.code, r.status, r.output, r.created_at AS "createdAt", u.name AS "createdBy", d.name AS "decidedBy", r.decided_at AS "decidedAt"
       FROM recommendations r LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users d ON d.id = r.decided_by WHERE r.business_id = $1 AND r.code = $2`,
    ctx.businessId, code.toUpperCase(),
  );
}

export async function listPlans(ctx: Ctx) {
  return q<{ code: string; status: string; budget: number; used: number; lines: number; createdAt: Date; createdBy: string | null }>(
    `SELECT r.code, r.status, (r.inputs->>'budget')::int AS budget, (r.output->>'used')::int AS used, jsonb_array_length(r.output->'lines') AS lines,
            r.created_at AS "createdAt", u.name AS "createdBy"
       FROM recommendations r LEFT JOIN users u ON u.id = r.created_by WHERE r.business_id = $1 ORDER BY r.created_at DESC LIMIT 20`,
    ctx.businessId,
  );
}

/** The owner approves: one purchase order per supplier, linked to the plan. */
export async function approvePlan(ctx: Ctx, code: string) {
  need(ctx, "purchasing.approve");
  const plan = await getPlan(ctx, code);
  if (!plan) throw new DomainError("Plan not found.");
  if (plan.status !== "proposed") throw new DomainError(`${plan.code} is already ${plan.status}.`);
  const age = nowOf(ctx).getTime() - new Date(plan.output.generatedAt).getTime();
  if (age > 6 * 3_600_000) throw new DomainError("This plan is more than 6 hours old. Generate a fresh one before approving.");
  return tx(async () => {
    const pos: string[] = [];
    const bySupplier = new Map<number, { variantId: number; qty: number }[]>();
    for (const l of plan.output.lines) bySupplier.set(l.supplierId, [...(bySupplier.get(l.supplierId) ?? []), { variantId: l.variantId, qty: l.qty }]);
    for (const [supplierId, lines] of bySupplier) pos.push((await placePurchaseOrder(ctx, supplierId, lines, plan.id)).code);
    await run(`UPDATE recommendations SET status = 'approved', decided_by = $2, decided_at = $3 WHERE id = $1`, plan.id, ctx.user.id, nowOf(ctx));
    await audit(ctx, "plan.approved", { type: "recommendation", id: plan.id, code: plan.code }, null, { purchaseOrders: pos });
    return pos;
  });
}

export async function rejectPlan(ctx: Ctx, code: string, reason: string) {
  need(ctx, "purchasing.approve");
  const plan = await getPlan(ctx, code);
  if (!plan || plan.status !== "proposed") throw new DomainError("Only a proposed plan can be rejected.");
  await run(`UPDATE recommendations SET status = 'rejected', decided_by = $2, decided_at = $3 WHERE id = $1`, plan.id, ctx.user.id, nowOf(ctx));
  await audit(ctx, "plan.rejected", { type: "recommendation", id: plan.id, code: plan.code }, reason);
}

export type { VariantHealth };
