// Prints what the synthetic seed looks like, without touching a database.
// Usage: node scripts/seed-preview.ts

import { bestSellers, deadStockFlags, groupDeadStock, lowStockFlags, reorderSuggestions, seasonHolds, SALES_WINDOW_DAYS, type SalesStats, type StockRow } from "../src/lib/insights.ts";
import { generateSeed } from "../src/lib/seed/generate.ts";

const now = new Date();
const t0 = performance.now();
const seed = generateSeed(now);
console.log(`generated in ${Math.round(performance.now() - t0)} ms`);

const { products, variants, movements, orders, orderLines, suppliers } = seed;
console.log(`${products.length} products, ${variants.length} variants, ${orders.length} orders, ${orderLines.length} order lines, ${movements.length} movements`);

const byType = new Map<string, number>();
for (const m of movements) byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
console.log("movements by type:", Object.fromEntries(byType));

// Ledger reconciliation: the sums of deltas must equal the stored columns.
const sums = new Map<number, { onHand: number; reserved: number }>();
for (const m of movements) {
  const s = sums.get(m.variantId) ?? { onHand: 0, reserved: 0 };
  s.onHand += m.onHandDelta;
  s.reserved += m.reservedDelta;
  sums.set(m.variantId, s);
}
const mismatched = variants.filter((v) => {
  const s = sums.get(v.id) ?? { onHand: 0, reserved: 0 };
  return s.onHand !== v.onHand || s.reserved !== v.reserved;
});
console.log(`ledger reconciles: ${mismatched.length === 0 ? "yes" : `NO (${mismatched.length} variants differ)`}`);

const productById = new Map(products.map((p) => [p.id, p]));
const supplierById = new Map(suppliers.map((s) => [s.id, s]));
const variantById = new Map(variants.map((v) => [v.id, v]));

const months = new Map<string, { units: number; revenue: number }>();
const sizeUnits = new Map<string, number>();
for (const m of movements) {
  if (m.type !== "sale") continue;
  const units = -m.onHandDelta;
  const key = new Date(m.createdAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
  const v = variantById.get(m.variantId)!;
  const price = productById.get(v.productId)!.sellPrice;
  const row = months.get(key) ?? { units: 0, revenue: 0 };
  row.units += units;
  row.revenue += units * price;
  months.set(key, row);
  sizeUnits.set(v.size, (sizeUnits.get(v.size) ?? 0) + units);
}
console.log("\nsales by month (IST):");
for (const [k, r] of [...months].sort()) console.log(`  ${k}  ${String(r.units).padStart(5)} units  ₹${r.revenue.toLocaleString("en-IN")}`);
const sizedTotal = [...sizeUnits].filter(([s]) => s !== "FREE").reduce((a, [, n]) => a + n, 0);
console.log("size share:", [...sizeUnits].filter(([s]) => s !== "FREE").map(([s, n]) => `${s} ${Math.round((100 * n) / sizedTotal)}%`).join(", "));

const rows: StockRow[] = variants.map((v) => {
  const p = productById.get(v.productId)!;
  const s = supplierById.get(p.supplierId)!;
  return {
    variantId: v.id, sku: v.sku, productId: p.id, productCode: p.code, productName: p.name, colour: v.colour, size: v.size,
    location: v.location, onHand: v.onHand, reserved: v.reserved, costPrice: p.costPrice, sellPrice: p.sellPrice,
    supplierName: s.name, leadTimeDays: s.leadTimeDays, packRatio: s.packRatio, season: p.season,
  };
});
const windowStart = now.getTime() - SALES_WINDOW_DAYS * 86_400_000;
const stats = new Map<number, SalesStats>();
for (const m of movements) {
  const s = stats.get(m.variantId) ?? { sold30: 0, lastSaleAt: null, firstReceivedAt: null };
  if (m.type === "sale") {
    if (m.createdAt.getTime() >= windowStart) s.sold30 += -m.onHandDelta;
    if (!s.lastSaleAt || m.createdAt > s.lastSaleAt) s.lastSaleAt = m.createdAt;
  }
  if (m.type === "receive" && (!s.firstReceivedAt || m.createdAt < s.firstReceivedAt)) s.firstReceivedAt = m.createdAt;
  stats.set(m.variantId, s);
}

const low = lowStockFlags(rows, stats, now);
console.log(`\nlow stock: ${low.length} variants (${low.filter((f) => f.severity === "out").length} out, ${low.filter((f) => f.severity === "critical").length} critical)`);
for (const f of low.slice(0, 8)) console.log(`  ${f.severity.padEnd(8)} ${f.row.sku.padEnd(16)} ${f.evidence}`);

const dead = deadStockFlags(rows, stats, now);
const deadValue = dead.reduce((a, f) => a + f.valueAtCost, 0);
console.log(`\ndead stock: ${dead.length} variants, ₹${deadValue.toLocaleString("en-IN")} at cost`);
for (const f of dead.slice(0, 8)) console.log(`  ${f.row.sku.padEnd(16)} ${f.evidence}`);

const reorder = reorderSuggestions(rows, stats, now);
console.log(`\nreorder suggestions: ${reorder.length}, ₹${reorder.reduce((a, r) => a + r.costEstimate, 0).toLocaleString("en-IN")} at cost`);
for (const r of reorder.slice(0, 5)) console.log(`  ${r.productCode} ${r.colour}: ${r.units} units ₹${r.costEstimate.toLocaleString("en-IN")} — ${r.evidence}`);

console.log("\nbest sellers (30 days):");
for (const b of bestSellers(rows, stats, 6)) console.log(`  ${b.productCode.padEnd(7)} ${b.productName.padEnd(26)} ${String(b.units).padStart(4)} units  top: ${b.topVariants.map((t) => t.sku).join(", ")}`);

console.log("\ndemo variants:");
for (const sku of ["K101-BLK-M", "K101-BLK-L", "K101-MRN-XL", "K101-MST-L"]) {
  const r = rows.find((x) => x.sku === sku)!;
  const s = stats.get(r.variantId)!;
  const avail = r.onHand - r.reserved;
  console.log(`  ${sku.padEnd(12)} ${r.location}  on hand ${r.onHand}, reserved ${r.reserved}, available ${avail}, sold30 ${s.sold30}, cover ${s.sold30 ? Math.round((10 * avail) / (s.sold30 / 30)) / 10 : "-"} days`);
}

const open = orders.filter((o) => o.status === "confirmed");
console.log(`\nopen orders: ${open.length}`);
for (const o of open) console.log(`  ${o.code} ${o.customerName.padEnd(10)} due ${o.dueLabel ?? "-"}  ${JSON.stringify(o.rawMessage)}`);
console.log(`orders by status:`, Object.fromEntries(["confirmed", "fulfilled", "cancelled"].map((s) => [s, orders.filter((o) => o.status === s).length])));

console.log("\ndead stock by product:");
for (const g of groupDeadStock(dead)) console.log(`  ${g.productCode.padEnd(7)} ${g.productName.padEnd(24)} ${String(g.units).padStart(3)} units ₹${g.valueAtCost.toLocaleString("en-IN").padStart(7)}  idle ≥${g.daysIdle}d${g.neverSold ? " (never sold)" : ""}`);
console.log("season holds:", seasonHolds(rows, now).map((h) => `${h.productCode} ${h.units} units after ${h.seasonLabel}`));
