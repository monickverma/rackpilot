// End-to-end check of the 90-second demo against an in-memory database:
// seed -> read message -> confirm -> pick list -> flags -> fulfil -> ledger.
// Usage: node scripts/smoke.ts   (writes nothing to disk)

import assert from "node:assert/strict";
import { counterSale, countStock, insights, movements, reconcile, StockError, variantBySku } from "../src/lib/inventory.ts";
import { cancelOrder, confirmOrder, draftOrder, fulfilOrder, getOrder, listOrders, pickList } from "../src/lib/orders.ts";

process.env.DATABASE_PATH = ":memory:";
const now = new Date();
const ok = (msg: string) => console.log(`  ok  ${msg}`);

const before = reconcile();
assert.equal(before.ledgerMismatches.length, 0, "seed ledger reconciles");
assert.equal(before.reservationMismatches.length, 0, "seed reservations reconcile");
ok(`seeded ${before.variants} variants and ${before.movements} ledger rows; totals rebuild exactly from the ledger`);

const lowBefore = insights(now).low.map((f) => f.row.sku);
assert.ok(!lowBefore.includes("K101-BLK-M"), "black M is not low before the order");

const message = "Bhaiya 3 black kurti M, 2 L, 1 maroon XL, Saturday tak";
const draft = draftOrder(message, now);
console.log(`\n  "${message}"`);
for (const l of draft.lines) {
  const c = l.match.candidates.find((x) => x.variantId === l.match.chosenId);
  console.log(`   ${String(l.qty).padStart(2)} x ${l.product} ${l.colour} ${l.size} -> ${c?.sku ?? "-"}  ${l.match.reason}`);
}
assert.equal(draft.due?.label, "saturday");
assert.deepEqual(draft.lines.map((l) => [l.qty, l.match.candidates.find((c) => c.variantId === l.match.chosenId)?.sku]), [
  [3, "K101-BLK-M"], [2, "K101-BLK-L"], [1, "K101-MRN-XL"],
]);
ok("parsed 3 lines and matched them to K101 variants, due Saturday");

const { id, code } = confirmOrder({
  customerName: "Sunita B.", message, dueLabel: draft.due!.label,
  lines: draft.lines.map((l) => ({ sourceText: l.sourceText, qty: l.qty, variantId: l.match.chosenId, matchNote: l.match.reason })),
}, now);
const order = getOrder(id)!;
for (const l of order.detail) console.log(`   ${l.sku?.padEnd(12)} ${l.status.padEnd(9)} reserved ${l.qtyReserved}/${l.qtyRequested} ${l.note ?? ""}`);
assert.deepEqual(order.detail.map((l) => l.status), ["reserved", "reserved", "short"]);
assert.equal(order.detail[2].holders[0]?.customerName, "Priya S.", "maroon XL conflict names Priya's order");
ok(`${code}: black M and L reserved; maroon XL short because the last one is held for Priya`);

const pick = pickList(id)!;
console.log(`   pick: ${pick.items.map((i) => `${i.location} ${i.sku} x${i.qty}`).join(" | ")}; not available: ${pick.missing.map((m) => m.sku).join(", ")}`);
assert.deepEqual(pick.items.map((i) => i.sku), ["K101-BLK-L", "K101-BLK-M"]);
ok("pick list walks the racks in order and lists the short line separately");

const after = insights(now);
const flag = after.low.find((f) => f.row.sku === "K101-BLK-M");
assert.ok(flag, "black M is low after reserving 3");
console.log(`   ${flag.severity}: ${flag.evidence}`);
ok("low-stock flag appears for black M once the order holds 3 of them");
assert.ok(after.deadGroups.some((g) => g.productCode === "G1101"), "the sequin gown is dead stock");
ok(`dead stock: ${after.deadGroups.slice(0, 3).map((g) => `${g.productCode} (${g.units})`).join(", ")}...`);

assert.throws(() => counterSale(variantBySku("K101-MRN-XL")!.id, 1, now), StockError);
ok("a counter sale can't take maroon XL: it is reserved");
assert.throws(() => countStock(variantBySku("K101-BLK-M")!.id, 1, null, now), StockError);
ok("a stock count can't go below what is reserved");

fulfilOrder(id, now);
const rows = movements({ orderId: id });
console.log(`   ledger for ${code}: ${rows.map((m) => `${m.type} ${m.sku} ${m.onHandDelta >= 0 ? "+" : ""}${m.onHandDelta}/${m.reservedDelta >= 0 ? "+" : ""}${m.reservedDelta}`).join(", ")}`);
assert.deepEqual(rows.map((m) => m.type).sort(), ["reserve", "reserve", "sale", "sale"]);
assert.equal(getOrder(id)!.status, "fulfilled");
ok("fulfil turned both reservations into sales");

const priya = listOrders("confirmed").find((o) => o.customerName === "Priya S.")!;
cancelOrder(priya.id, now);
assert.equal(variantBySku("K101-MRN-XL")!.reserved, 0);
ok("cancelling Priya's order releases maroon XL");

const end = reconcile();
assert.equal(end.ledgerMismatches.length + end.reservationMismatches.length, 0);
ok(`ledger still reconciles: ${end.movements} rows`);
console.log("\nsmoke test passed");
