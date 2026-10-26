// "Ask your business": a question is routed to one of a fixed set of query
// templates, the database computes the answer, and the answer is explained.
// No free-form SQL is ever written by a model. Without Claude, routing is by
// rules; with Claude, Claude picks the template and its parameters from a
// closed schema, and may reword the answer, which is checked against the
// computed results before it is shown.

import * as z from "zod/v4";
import { one, q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import { claudeConfigured, ClaudeError, structured } from "../ai/claude.ts";
import { checkGrounding } from "../ai/grounding.ts";
import { pct, plural, round1, rupees, units } from "../format.ts";
import { catalogue, matchLine } from "../intake/match.ts";
import { parseOrder } from "../intake/parse.ts";
import { explainCase } from "../investigate/explain.ts";
import { rollup, sales, variantHealth } from "./analytics.ts";
import { backtest } from "./demand.ts";
import { buildPlan } from "./plan.ts";
import { searchPolicies } from "./retrieval.ts";

export const TEMPLATES = {
  fastest_sizes: "Which sizes and colours are selling fastest over a period",
  best_sellers: "Best-selling products and designs over a period",
  unfulfillable_orders: "Open orders that can't be fully fulfilled with current stock",
  unsold_for: "Products with stock that have had no orders for N days",
  why_running_out: "Why a product, colour or size is running out",
  budget_plan: "What to buy with a budget, and which orders could run short",
  order_less: "Products to consider ordering less of",
  why_flagged: "Why an order, payment, SKU or investigation is flagged",
  supplier_policy: "Supplier terms and house policies (lead time, minimum order, returns, payment terms)",
  margin: "Gross margin by product over a period",
  where_is: "Where a product or SKU is stored",
  stock_value: "Inventory value at cost",
  open_cases: "Open investigations",
} as const;
export type Template = keyof typeof TEMPLATES;

export interface Params {
  days?: number | null;
  amount?: number | null;
  ref?: string | null;
  words?: string | null;
}

export interface Answer {
  question: string;
  template: Template | null;
  params: Params;
  routedBy: "rules" | "claude";
  text: string;
  explainedBy: "rules" | "claude";
  note?: string;
  table?: { columns: string[]; rows: (string | number)[][] };
  links: { label: string; href: string }[];
  method: string;
}

// ---- routing ----

export function routeByRules(question: string): { template: Template | null; params: Params } {
  const s = question.toLowerCase();
  const ref = question.toUpperCase().match(/\b(?:ORD|PAY|OT|SS|SHP|INV)-\d+\b|\b[A-Z]{3}-[A-Z]{3}-(?:XXL|XL|[SML]|\d{2})\b/)?.[0] ?? null;
  const amount = (() => {
    const m = s.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|l|lakh)?|([\d,]+)\s*(k|lakh|l)\b|([\d,]{4,})\s*(?:rupees|rs)/);
    if (!m) return null;
    const n = Number((m[1] ?? m[3] ?? m[5]).replaceAll(",", ""));
    const unit = m[2] ?? m[4];
    return unit === "k" ? n * 1000 : unit === "l" || unit === "lakh" ? n * 100_000 : n;
  })();
  const days = (() => {
    const m = s.match(/(\d+)\s*(day|week|month)/);
    if (m) return Number(m[1]) * (m[2] === "week" ? 7 : m[2] === "month" ? 30 : 1);
    if (/\bthis month|\bmonth\b/.test(s)) return 30;
    if (/\bthis week|\bweek\b/.test(s)) return 7;
    if (/\btoday\b/.test(s)) return 1;
    return null;
  })();
  const p = { days, amount, ref, words: null as string | null };
  if (/\b(why|flag|flagged|investigat)/.test(s) && ref) return { template: "why_flagged", params: p };
  if (amount || /\bbudget|spend|spent|what (should|to) (i )?(order|buy)|purchas/.test(s)) return { template: "budget_plan", params: { ...p, amount: amount ?? 30000 } };
  if (/\b(cannot|can't|cant|unable to|not able to)\b.*\bfulfil|\bshort\b.*\borders?|orders?.*\b(short|backorder)|unfulfil/.test(s)) return { template: "unfulfillable_orders", params: p };
  if (/\b(unsold|not sold|sitting|dead stock|no sales|no orders)\b/.test(s)) return { template: "unsold_for", params: { ...p, days: days ?? 45 } };
  if (/\b(order less|less of|overstock|too much|reduce)\b/.test(s)) return { template: "order_less", params: p };
  if (/\b(running out|run out|out of stock|stockout|why.*(short|low))\b/.test(s)) return { template: "why_running_out", params: { ...p, words: question } };
  if (/\bsize|colou?r/.test(s) && /\b(fast|best|sell|top|most)/.test(s)) return { template: "fastest_sizes", params: { ...p, days: days ?? 30 } };
  if (/\b(best|top|fast).*(sell|product|design)|\bbestsell/.test(s)) return { template: "best_sellers", params: { ...p, days: days ?? 30 } };
  if (/\bmargin|profit/.test(s)) return { template: "margin", params: { ...p, days: days ?? 30 } };
  if (/\bwhere\b|\blocation|\brack|\bbin\b|\bshelf/.test(s)) return { template: "where_is", params: { ...p, words: question } };
  if (/\b(stock|inventory) (value|worth)|\bvalue of (stock|inventory)|worth/.test(s)) return { template: "stock_value", params: p };
  if (/\binvestigation|\bdiscrepanc|\bcases?\b|\bmismatch/.test(s)) return { template: "open_cases", params: p };
  if (/\b(lead time|moq|minimum order|payment terms?|return|defect|advance|credit|supplier|terms|deliver)/.test(s)) return { template: "supplier_policy", params: { ...p, words: question } };
  if (ref) return { template: "why_flagged", params: p };
  return { template: null, params: p };
}

const Route = z.object({
  template: z.enum(Object.keys(TEMPLATES) as [Template, ...Template[]]).nullable().describe("null if no template fits"),
  days: z.number().int().min(1).max(365).nullable(),
  amount: z.number().int().min(1000).max(10_000_000).nullable().describe("Budget in rupees"),
  ref: z.string().nullable().describe("An order, payment, SKU or case code mentioned, e.g. ORD-1042"),
  words: z.string().nullable().describe("The product description the question is about, e.g. 'black oversized tees'"),
});

async function routeWithClaude(question: string) {
  const r = await structured(Route, {
    system: `You route a clothing wholesaler's questions about their own business to one fixed query template. You never answer the question yourself.\n\nTemplates:\n${Object.entries(TEMPLATES).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`,
    content: question, effort: "low", maxTokens: 2000,
  });
  return { template: r.template, params: { days: r.days, amount: r.amount, ref: r.ref, words: r.words } };
}

// ---- templates ----

type Result = Omit<Answer, "question" | "routedBy" | "explainedBy" | "params" | "template">;

async function run(ctx: Ctx, t: Template, p: Params, question: string): Promise<Result> {
  switch (t) {
    case "fastest_sizes": {
      const days = p.days ?? 30;
      const rows = await sales(ctx, days);
      const bySize = rollup(rows, (r) => r.size);
      const byColour = rollup(rows, (r) => r.colour);
      const top = rows.slice(0, 5);
      const total = bySize.reduce((a, x) => a + x.units, 0);
      return {
        text: total
          ? `Over the last ${days} days, ${bySize[0].key} sold most (${units(bySize[0].units)}, ${pct(bySize[0].units / total)} of ${units(total)}), then ${bySize[1]?.key ?? "—"} (${units(bySize[1]?.units ?? 0)}). By colour, ${byColour[0].key} leads with ${units(byColour[0].units)}. The fastest single variant is ${top[0].sku} at ${units(top[0].units)}.`
          : `Nothing was dispatched in the last ${days} days.`,
        table: { columns: ["Size", "Units", "Share", "Per day"], rows: bySize.map((x) => [x.key, x.units, pct(x.units / total), round1(x.units / days)]) },
        links: top.map((r) => ({ label: r.sku, href: `/inventory/${r.sku}` })),
        method: `Units on dispatch records in the last ${days} days, grouped by size and by colour.`,
      };
    }
    case "best_sellers": {
      const days = p.days ?? 30;
      const rows = await sales(ctx, days);
      const products = rollup(rows, (r) => `${r.productName}`);
      return {
        text: products.length ? `Best sellers over ${days} days: ${products.slice(0, 3).map((x) => `${x.key} (${units(x.units)}, ${rupees(x.revenue)})`).join("; ")}.` : `Nothing was dispatched in the last ${days} days.`,
        table: { columns: ["Product", "Units", "Revenue", "Margin"], rows: products.slice(0, 10).map((x) => [x.key, x.units, rupees(x.revenue), pct(x.marginPct)]) },
        links: [{ label: "Analytics", href: "/analytics" }], method: `Dispatched units and their order value, last ${days} days, by product.`,
      };
    }
    case "unfulfillable_orders": {
      const rows = await q<{ code: string; customer: string; sku: string; short: number; backordered: boolean; status: string }>(
        `SELECT o.code, c.name AS customer, v.sku, oi.backordered, o.status,
                (oi.qty_ordered - oi.qty_cancelled - COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)
                  - COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status IN ('active', 'picked')), 0))::int AS short
           FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN customers c ON c.id = o.customer_id JOIN product_variants v ON v.id = oi.variant_id
          WHERE oi.business_id = $1 AND o.status IN ('confirmed', 'picking', 'packed') ORDER BY o.created_at`,
        ctx.businessId,
      );
      const s = rows.filter((r) => r.short > 0);
      const orders = new Set(s.map((r) => r.code));
      return {
        text: s.length ? `${plural(orders.size, "open order")} can't be fully fulfilled from current stock: ${units(s.reduce((a, r) => a + r.short, 0))} short across ${plural(s.length, "line")}. ${s.filter((r) => r.backordered).length} of those lines are on backorder.` : "Every open order is fully reserved.",
        table: { columns: ["Order", "Customer", "SKU", "Short", "Backorder"], rows: s.map((r) => [r.code, r.customer, r.sku, r.short, r.backordered ? "yes" : "decide"]) },
        links: [...orders].slice(0, 6).map((c) => ({ label: c, href: `/orders/${c}` })), method: "Open order lines: ordered − cancelled − shipped − reserved > 0.",
      };
    }
    case "unsold_for": {
      const days = p.days ?? 45;
      const health = await variantHealth(ctx);
      const rows = health.filter((h) => h.onHand > 0 && (h.daysSinceOrder === null || h.daysSinceOrder >= days) && h.ageDays >= days).sort((a, b) => b.stockValue - a.stockValue);
      return {
        text: rows.length ? `${plural(rows.length, "variant")} with stock had no orders in ${days}+ days, ${rupees(rows.reduce((a, r) => a + r.stockValue, 0))} at cost. The largest is ${rows[0].sku}: ${units(rows[0].onHand)} (${rupees(rows[0].stockValue)}).` : `Every stocked variant had an order in the last ${days} days.`,
        table: { columns: ["SKU", "On hand", "Value at cost", "Days since order", "Note"], rows: rows.slice(0, 15).map((r) => [r.sku, r.onHand, rupees(r.stockValue), r.daysSinceOrder ?? "never", r.health === "out-of-season" ? `out of season (${r.season})` : r.health]) },
        links: rows.slice(0, 5).map((r) => ({ label: r.sku, href: `/inventory/${r.sku}` })), method: `Variants with on-hand > 0, no order line in ${days} days, and launched more than ${days} days ago.`,
      };
    }
    case "why_running_out": {
      const parsed = parseOrder(`1 ${p.words ?? question}`).lines[0];
      const cat = await catalogue(ctx);
      const health = await variantHealth(ctx);
      const m = parsed ? matchLine({ ...parsed, size: parsed.size }, cat) : null;
      let ids = m?.candidates.map((c) => c.variantId) ?? [];
      if (m && parsed && !parsed.size) ids = cat.filter((v) => m.candidates.some((c) => c.sku.split("-").slice(0, 2).join("-") === v.sku.split("-").slice(0, 2).join("-"))).map((v) => v.variantId);
      const rows = health.filter((h) => ids.includes(h.variantId)).sort((a, b) => (a.coverDays ?? 999) - (b.coverDays ?? 999));
      if (!rows.length) return { text: "I couldn't tell which product you mean. Try a colour and product, like \"black oversized tees\".", links: [], method: "Product words matched against the catalogue." };
      const worst = rows[0];
      return {
        text: `${worst.sku} has ${units(Math.max(worst.available, 0))} free (${worst.onHand} on hand, ${worst.reserved} reserved)${worst.onOrder ? ` and ${units(worst.onOrder)} on order` : ", nothing on order,"} against ${worst.demand?.ordered28 ?? 0} ordered in 28 days (${round1(worst.demand?.rate ?? 0)}/day${worst.demand?.rising ? `, rising: ${worst.demand.ordered14} in the last 14 days` : ""}). That is ${worst.coverDays === null ? "no recent demand" : `${round1(worst.coverDays)} days of cover`}, while ${worst.supplierName} takes ${worst.leadTimeDays} days to deliver.`,
        table: { columns: ["SKU", "Free", "Reserved", "On order", "Ordered 28d", "Cover (days)", "Lead time"], rows: rows.map((r) => [r.sku, Math.max(r.available, 0), r.reserved, r.onOrder, r.demand?.ordered28 ?? 0, r.coverDays === null ? "—" : round1(r.coverDays), r.leadTimeDays]) },
        links: rows.slice(0, 5).map((r) => ({ label: r.sku, href: `/inventory/${r.sku}` })), method: "Free stock ÷ (ordered in 28 days ÷ 28), compared with the supplier's lead time.",
      };
    }
    case "budget_plan": {
      const amount = p.amount ?? 30000;
      const plan = await buildPlan(ctx, amount);
      return {
        text: `With ${rupees(amount)}, the plan buys ${plural(plan.lines.length, "line")} (${units(plan.lines.reduce((a, l) => a + l.qty, 0))}) for ${rupees(plan.used)}, leaving ${rupees(plan.remaining)}. ${plan.lines.filter((l) => l.tier === 1).length} lines cover customers already waiting. ${plan.atRisk.length ? `${plural(new Set(plan.atRisk.map((r) => r.orderCode)).size, "open order")} could run short; the plan covers ${units(plan.atRisk.reduce((a, r) => a + r.covered, 0))} of the ${units(plan.atRisk.reduce((a, r) => a + r.short, 0))} they need.` : "No open order is short."} Forecast error in backtests: ${pct(plan.backtest.productWape)} per product and week, ${pct(plan.backtest.wape)} per variant.`,
        table: { columns: ["SKU", "Qty", "Cost", "Why"], rows: plan.lines.slice(0, 12).map((l) => [l.sku, l.qty, rupees(l.cost), l.tierLabel]) },
        links: [{ label: `Open the ${rupees(amount)} plan`, href: `/purchasing?budget=${amount}` }],
        method: "Need = rate × (lead time + review + safety) − (verified available + on order − backorders), in supplier packs, funded by priority within a hard budget.",
      };
    }
    case "order_less": {
      const health = await variantHealth(ctx);
      const rows = health.filter((h) => h.onHand > 0 && ((h.coverDays ?? 0) > 90 || h.health === "dead" || h.health === "slow")).sort((a, b) => b.stockValue - a.stockValue);
      return {
        text: rows.length ? `${plural(rows.length, "variant")} have far more stock than demand, ${rupees(rows.reduce((a, r) => a + r.stockValue, 0))} at cost. Biggest: ${rows.slice(0, 3).map((r) => `${r.sku} (${r.coverDays === null ? "no recent orders" : `${Math.round(r.coverDays)} days of cover`})`).join(", ")}.` : "Nothing is badly overstocked.",
        table: { columns: ["SKU", "On hand", "Ordered 28d", "Cover (days)", "Value at cost"], rows: rows.slice(0, 15).map((r) => [r.sku, r.onHand, r.demand?.ordered28 ?? 0, r.coverDays === null ? "—" : Math.round(r.coverDays), rupees(r.stockValue)]) },
        links: rows.slice(0, 5).map((r) => ({ label: r.sku, href: `/inventory/${r.sku}` })), method: "Variants with more than 90 days of cover, or none sold recently.",
      };
    }
    case "why_flagged": {
      const ref = p.ref ?? question.toUpperCase().match(/\b(?:ORD|PAY|OT|SS)-\d+\b/)?.[0] ?? null;
      const e = ref ? await explainCase(ctx, ref) : null;
      if (!e) return { text: ref ? `${ref} has no investigation.` : "Name the order or case, e.g. ORD-1042.", links: [], method: "Looked up the investigation for that record." };
      return { text: e.text, links: [{ label: `Open ${e.caseCode}`, href: `/investigations/${e.caseCode}` }], method: `The findings and source records of ${e.caseCode}${e.by === "claude" ? ", worded by Claude and checked against them" : ""}.`, note: e.note };
    }
    case "supplier_policy": {
      const hits = await searchPolicies(ctx, p.words ?? question);
      if (!hits.length) return { text: "I didn't find that in the supplier terms or house policies.", links: [{ label: "Policies", href: "/assistant#policies" }], method: "Full-text search over supplier terms and policies." };
      return {
        text: `${hits[0].title} — ${hits[0].heading}: ${hits[0].body}`,
        table: { columns: ["Document", "Section", "Text"], rows: hits.map((h) => [h.title, h.heading, h.body]) },
        links: [], method: "Postgres full-text search over supplier terms and house policies; the best-ranked passages, quoted.",
      };
    }
    case "margin": {
      const days = p.days ?? 30;
      const rows = rollup(await sales(ctx, days), (r) => r.productName);
      const rev = rows.reduce((a, r) => a + r.revenue, 0);
      const cost = rows.reduce((a, r) => a + r.cost, 0);
      return {
        text: rev ? `Over ${days} days: ${rupees(rev)} revenue, ${rupees(rev - cost)} gross margin (${pct((rev - cost) / rev)}). Highest margin share: ${[...rows].sort((a, b) => b.margin - a.margin).slice(0, 2).map((r) => `${r.key} ${rupees(r.margin)}`).join(", ")}.` : `Nothing was dispatched in the last ${days} days.`,
        table: { columns: ["Product", "Revenue", "Cost", "Margin", "Margin %"], rows: rows.map((r) => [r.key, rupees(r.revenue), rupees(r.cost), rupees(r.margin), pct(r.marginPct)]) },
        links: [{ label: "Analytics", href: "/analytics" }], method: "Dispatched units × order price, minus units × catalogue unit cost. Excludes GST.",
      };
    }
    case "where_is": {
      const sku = (p.ref ?? question.toUpperCase().match(/\b[A-Z]{3}-[A-Z]{3}-(?:XXL|XL|[SML]|\d{2})\b/)?.[0]) || null;
      let ids: number[] = [];
      if (sku) {
        const v = await one<{ id: number }>(`SELECT id FROM product_variants WHERE business_id = $1 AND sku = $2`, ctx.businessId, sku);
        if (v) ids = [v.id];
      } else {
        const parsed = parseOrder(`1 ${p.words ?? question}`).lines[0];
        const m = parsed ? matchLine(parsed, await catalogue(ctx)) : null;
        ids = m?.candidates.map((c) => c.variantId) ?? [];
      }
      if (!ids.length) return { text: "Name a SKU or a product with its colour and size.", links: [], method: "Catalogue lookup." };
      const rows = await q<{ sku: string; code: string; onHand: number; reserved: number; flagged: boolean }>(
        `SELECT v.sku, l.code, b.on_hand AS "onHand", b.reserved, b.needs_verification AS flagged FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id
           JOIN locations l ON l.id = b.location_id WHERE b.business_id = $1 AND v.id = ANY($2::int[]) AND b.on_hand > 0 ORDER BY v.sku, b.on_hand DESC`,
        ctx.businessId, ids,
      );
      return {
        text: rows.length ? rows.slice(0, 4).map((r) => `${r.sku}: ${units(r.onHand)} at ${r.code}${r.flagged ? " (needs verification)" : ""}`).join("; ") + "." : "None of that is on hand anywhere.",
        table: { columns: ["SKU", "Location", "On hand", "Reserved"], rows: rows.map((r) => [r.sku, r.code, r.onHand, r.reserved]) },
        links: [...new Set(rows.map((r) => r.sku))].slice(0, 4).map((s) => ({ label: s, href: `/inventory/${s}` })), method: "Recorded balances by location.",
      };
    }
    case "stock_value": {
      const health = await variantHealth(ctx);
      const total = health.reduce((a, h) => a + h.stockValue, 0);
      const byHealth = new Map<string, { units: number; value: number }>();
      for (const h of health) {
        const x = byHealth.get(h.health) ?? { units: 0, value: 0 };
        x.units += h.onHand;
        x.value += h.stockValue;
        byHealth.set(h.health, x);
      }
      return {
        text: `Stock on hand is worth ${rupees(total)} at cost across ${units(health.reduce((a, h) => a + h.onHand, 0))}.`,
        table: { columns: ["Status", "Units", "Value at cost"], rows: [...byHealth].filter(([, x]) => x.units > 0).sort((a, b) => b[1].value - a[1].value).map(([k, x]) => [k, x.units, rupees(x.value)]) },
        links: [{ label: "Analytics", href: "/analytics" }], method: "On-hand × catalogue unit cost, every location.",
      };
    }
    case "open_cases": {
      const rows = await q<{ code: string; title: string; priority: string; status: string }>(
        `SELECT code, title, priority, status FROM investigations WHERE business_id = $1 AND status NOT IN ('resolved', 'closed') ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, detected_at`,
        ctx.businessId,
      );
      return {
        text: rows.length ? `${plural(rows.length, "open investigation")}, ${rows.filter((r) => r.priority === "high").length} high priority. First: ${rows[0].code}, ${rows[0].title}.` : "No open investigations.",
        table: { columns: ["Case", "Title", "Priority", "Status"], rows: rows.map((r) => [r.code, r.title, r.priority, r.status.replace("_", " ")]) },
        links: rows.slice(0, 5).map((r) => ({ label: r.code, href: `/investigations/${r.code}` })), method: "Investigations not resolved or closed.",
      };
    }
  }
}

const Wording = z.object({ answer: z.string().describe("2 to 4 sentences") });

export async function ask(ctx: Ctx, question: string, opts: { useClaude?: boolean } = {}): Promise<Answer> {
  const qn = question.trim().slice(0, 500);
  const useClaude = (opts.useClaude ?? true) && claudeConfigured();
  let route = routeByRules(qn);
  let routedBy: Answer["routedBy"] = "rules";
  let note: string | undefined;
  if (useClaude) {
    try {
      const r = await routeWithClaude(qn);
      if (r.template) {
        route = { template: r.template, params: { ...route.params, ...Object.fromEntries(Object.entries(r.params).filter(([, v]) => v !== null)) } };
        routedBy = "claude";
      }
    } catch (e) {
      note = e instanceof ClaudeError ? `${e.message} Routed by rules instead.` : undefined;
    }
  }
  if (!route.template) {
    return {
      question: qn, template: null, params: route.params, routedBy, explainedBy: "rules", links: [], method: "No template matched.",
      text: `I can answer questions like: which sizes sell fastest this month, which orders can't be fulfilled, what has sat unsold for 45 days, why a product is running out, what to buy with ₹30,000, why ORD-1042 is flagged, or what a supplier's minimum order is.`,
    };
  }
  const result = await run(ctx, route.template, route.params, qn);
  let text = result.text;
  let explainedBy: Answer["explainedBy"] = "rules";
  if (useClaude && route.template !== "why_flagged" && route.template !== "supplier_policy") {
    try {
      const source = { question: qn, answer: result.text, table: result.table ?? null };
      const w = await structured(Wording, {
        system: "Reword a computed business answer for a clothing wholesaler in plain English. Use only the numbers and codes in the JSON; do not calculate anything new. Keep it short.",
        content: JSON.stringify(source), effort: "low", maxTokens: 2000,
      });
      const check = checkGrounding(w.answer, source);
      if (check.ok) {
        text = w.answer;
        explainedBy = "claude";
      } else note = `Claude's wording mentioned ${[...check.unsupportedNumbers, ...check.unknownCodes].slice(0, 3).join(", ")}, which the results don't contain, so the computed wording is shown.`;
    } catch (e) {
      if (e instanceof ClaudeError) note = `${e.message} Showing the computed wording.`;
    }
  }
  return { question: qn, template: route.template, params: route.params, routedBy, explainedBy, ...result, text, note: result.note ?? note };
}

export async function forecastSummary(ctx: Ctx) {
  return backtest(ctx);
}
