// End-to-end and edge-case tests against a fresh in-memory database.
// Usage: node scripts/test.ts [--write]   (--write saves data/test-report.json)
//
// Covers the spec's demo scenario (order 20 shirts, bill 18, a transfer that
// is never scanned in, investigate, explain, correct, resolve) and the edge
// cases section 9 asks for, plus tenant isolation, permissions, the
// append-only ledger and the budget limit.

process.env.RACKPILOT_DB = "memory";
delete process.env.ANTHROPIC_API_KEY;

import { writeFileSync } from "node:fs";

const { database, one, q, run } = await import("../src/db/client.ts");
const { runChecks } = await import("../src/lib/investigate/engine.ts");
const cases = await import("../src/lib/investigate/cases.ts");
const { explainCase } = await import("../src/lib/investigate/explain.ts");
const orders = await import("../src/lib/ops/orders.ts");
const billing = await import("../src/lib/ops/billing.ts");
const stock = await import("../src/lib/ops/stock.ts");
const { draftWithRules } = await import("../src/lib/intake/draft.ts");
const { buildPlan } = await import("../src/lib/intel/plan.ts");
const { variantHealth, dataGaps } = await import("../src/lib/intel/analytics.ts");
const { backtest } = await import("../src/lib/intel/demand.ts");
const { evalIntake, evalRetrieval } = await import("../src/lib/eval.ts");
const { ForbiddenError, DomainError } = await import("../src/lib/context.ts");
type Ctx = import("../src/lib/context.ts").Ctx;

const results: { area: string; name: string; passed: boolean; detail: string }[] = [];
async function test(area: string, name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ area, name, passed: true, detail });
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (e) {
    results.push({ area, name, passed: false, detail: (e as Error).message });
    console.log(`  FAIL ${name} — ${(e as Error).message}`);
  }
}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
async function throws(fn: () => Promise<unknown>, kind: typeof DomainError) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof kind) return (e as Error).message;
    throw new Error(`threw the wrong error: ${(e as Error).message}`);
  }
  throw new Error("did not throw");
}

const t0 = Date.now();
await database();
console.log(`seeded in ${Date.now() - t0} ms\n`);
const users = await q<{ id: number; name: string; role: "owner" | "warehouse" | "accounts"; businessId: number }>(`SELECT id, name, role, business_id AS "businessId" FROM users ORDER BY id`);
const ctxOf = (biz: number, role: string, now?: Date): Ctx => {
  const u = users.find((x) => x.businessId === biz && x.role === role)!;
  return { businessId: biz, user: { id: u.id, name: u.name, role: u.role }, now };
};
const owner = ctxOf(1, "owner"), ware = ctxOf(1, "warehouse"), acct = ctxOf(1, "accounts"), other = ctxOf(2, "owner");
const variant = (sku: string) => one<{ id: number; home: number }>(`SELECT id, home_location_id AS home FROM product_variants WHERE business_id = 1 AND sku = $1`, sku).then((v) => v!);
const free = async (sku: string) => (await one<{ n: number }>(`SELECT COALESCE(SUM(b.on_hand - b.reserved), 0)::int AS n FROM inventory_balances b JOIN locations l ON l.id = b.location_id JOIN product_variants v ON v.id = b.variant_id WHERE v.business_id = 1 AND v.sku = $1 AND l.sellable`, sku))!.n;

console.log("seed");
await test("Seed", "Planted discrepancies are detected, and nothing else", async () => {
  const open = await q<{ code: string; title: string }>(`SELECT code, title FROM investigations WHERE business_id = 1 AND status NOT IN ('resolved', 'closed') ORDER BY code`);
  expect(open.length === 11, `expected 11 open cases, got ${open.length}: ${open.map((c) => c.code).join(", ")}`);
  expect(open[0].code === "OT-001" && /ORD-1042/.test(open[0].title), "OT-001 should be the ORD-1042 invoice mismatch");
  expect(open.some((c) => c.code === "SS-004" && /BLK-TSH-M/.test(c.title)), "SS-004 should be the BLK-TSH-M variance");
  const other2 = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM investigations WHERE business_id = 2`);
  expect(other2!.n === 0, "the second business should have no cases");
  return `${open.length} open cases: ${open.map((c) => c.code).join(", ")}`;
});
await test("Seed", "History reconciles except the planted balance edit", async () => {
  const off = await q<{ sku: string }>(`SELECT v.sku FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id WHERE b.on_hand <> COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.variant_id = b.variant_id AND m.location_id = b.location_id), 0)`);
  expect(off.length === 1 && off[0].sku === "GRY-JOG-L", `unexpected ledger mismatches: ${off.map((x) => x.sku).join(", ")}`);
  const rows = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM stock_movements`);
  return `${rows!.n} movements; only GRY-JOG-L differs, as planted`;
});
await test("Seed", "ORD-1044's partial shipment with a backorder is not flagged", async () => {
  const c = await one<{ code: string }>(`SELECT i.code FROM investigations i JOIN orders o ON i.case_key = 'order:' || o.id WHERE o.business_id = 1 AND o.code = 'ORD-1044'`);
  expect(!c, `ORD-1044 has a case: ${c?.code}`);
  return "legitimate partial fulfilment recognised";
});

console.log("\ndemo scenario (spec section 9)");
const shirt = "BLU-SHT-L";
let orderCode = "";
let orderId = 0;
await test("Scenario", "1-2. Receive stock into its home bin", async () => {
  const v = await variant(shirt);
  const f = await free(shirt);
  const sup = await one<{ id: number }>(`SELECT supplier_id AS id FROM products p JOIN product_variants v ON v.product_id = p.id WHERE v.id = $1`, v.id);
  const po = await (await import("../src/lib/ops/purchasing.ts")).placePurchaseOrder(owner, sup!.id, [{ variantId: v.id, qty: 36 }], null);
  const r = await (await import("../src/lib/ops/purchasing.ts")).receivePurchaseOrder(ware, po.id);
  const after = await free(shirt);
  expect(after >= f + 36 - r.backfilled, "free stock should rise by the receipt less any backorders filled");
  return `${po.code} received as ${r.code}: ${r.units} units into the home bin, ${r.backfilled} reserved for backorders`;
});
await test("Scenario", "3. An order for 20 shirts is read, matched and reserved", async () => {
  const d = await draftWithRules(acct, `Bhai, 20 blue oxford shirt L chahiye, kal tak`);
  expect(d.lines.length === 1 && d.lines[0].match.status === "matched" && d.lines[0].match.candidates[0].sku === shirt && d.lines[0].qty === 20, "the message should read as 20 × BLU-SHT-L");
  const c = await orders.confirmOrder(acct, { customerId: 1, channel: "message", sourceText: d.text, extractedBy: "rules", lines: [{ variantId: d.lines[0].match.chosenId!, qty: 20 }] });
  expect(!c.shortages.length, "20 should be free after the receipt");
  orderCode = c.code;
  orderId = c.id;
  return `${c.code} confirmed with 20 reserved`;
});
await test("Scenario", "4. Picked and shipped 20, invoiced only 18", async () => {
  const pl = await orders.createPickList(ware, orderId);
  const lines = await q<{ id: number; qty: number }>(`SELECT id, qty_to_pick AS qty FROM pick_list_items WHERE pick_list_id = $1`, pl.id);
  await orders.confirmPick(ware, pl.id, lines.map((l) => ({ lineId: l.id, qtyPicked: l.qty })));
  const shp = await orders.dispatchOrder(ware, orderId);
  const item = await one<{ id: number }>(`SELECT id FROM order_items WHERE order_id = $1`, orderId);
  const inv = await billing.issueInvoice(acct, orderId, { lines: [{ orderItemId: item!.id, qty: 18 }] });
  expect(shp.units === 20, "20 should ship");
  return `${shp.code} ships 20; ${inv.code} bills 18`;
});
const later = new Date(Date.now() + 3 * 3_600_000);
let otCode = "";
await test("Scenario", "OrderTrace opens a case for the 2 unbilled units", async () => {
  const r = await runChecks(1, later);
  const c = await one<{ code: string }>(`SELECT code FROM investigations WHERE business_id = 1 AND case_key = $1`, `order:${orderId}`);
  expect(c, `no case for ${orderCode}; created ${r.created.join(", ")}`);
  otCode = c.code;
  const v = (await cases.getCase(owner, c.code))!;
  const f = v.findings.find((x) => x.rule === "OT-INV" && x.kind === "fact");
  expect(f && f.expected === 20 && f.actual === 18, "the fact should be 20 dispatched vs 18 invoiced");
  expect(v.findings.some((x) => x.module === "stocksleuth" && /agree/.test(x.title)), "StockSleuth's view should confirm the 20 left the warehouse");
  expect(v.findings.some((x) => x.kind === "hypothesis"), "hypotheses should be listed separately");
  return `${c.code}: ${f!.calculation}`;
});
let ssCode = "";
await test("Scenario", "5. A transfer-out with no transfer-in, then a count, opens a StockSleuth case", async () => {
  const sku = "NVY-POL-L";
  const v = await variant(sku);
  const rail = await one<{ id: number }>(`SELECT id FROM locations WHERE business_id = 1 AND code = 'A-SR-S1-B02'`);
  const bal = await one<{ onHand: number; reserved: number }>(`SELECT on_hand AS "onHand", reserved FROM inventory_balances WHERE variant_id = $1 AND location_id = $2`, v.id, v.home);
  if ((bal?.onHand ?? 0) - (bal?.reserved ?? 0) < 2) await stock.adjustStock(owner, { variantId: v.id, locationId: v.home, qty: 10, reason: "Test setup: found in back store" });
  const t = await stock.sendTransfer({ ...ware, now: new Date() }, { variantId: v.id, fromLocationId: v.home, toLocationId: rail!.id, qty: 2 });
  const recorded = (await one<{ onHand: number }>(`SELECT on_hand AS "onHand" FROM inventory_balances WHERE variant_id = $1 AND location_id = $2`, v.id, v.home))!.onHand;
  await stock.recordCount({ ...ware, now: new Date(Date.now() + 60_000) }, { scope: "Test count", lines: [{ variantId: v.id, locationId: v.home, counted: recorded - 2 }] });
  await runChecks(1, later);
  const c = await one<{ code: string }>(`SELECT code FROM investigations WHERE business_id = 1 AND case_key = $1 AND status NOT IN ('resolved', 'closed')`, `stock:${v.id}:${v.home}`);
  expect(c, "no StockSleuth case opened");
  ssCode = c.code;
  const view = (await cases.getCase(owner, c.code))!;
  expect(view.findings.some((f) => f.rule === "SS-TRF"), "the unreceived transfer should be a finding");
  expect(view.findings.some((f) => f.rule === "SS-COUNT" && f.kind === "inference" && /2 of the 2/.test(f.title)), "coverage should say 2 of 2");
  return `${c.code}: ${t.code} sent, count −2, transfer explains 2 of 2`;
});
await test("Scenario", "6-7. The case explains why it was flagged, from its own records", async () => {
  const e = await explainCase(acct, orderCode, { useClaude: false });
  expect(e && e.caseCode === otCode && /20/.test(e.text) && /18/.test(e.text), "explanation should cite 20 and 18");
  return e!.text.slice(0, 140) + "…";
});
await test("Scenario", "8. Authorised corrections make the records agree; cases resolve and close", async () => {
  const v1 = (await cases.getCase(acct, otCode))!;
  const fix = (await cases.corrections(acct, v1)).find((c) => c.id.startsWith("invoice:"))!;
  await throws(() => cases.applyCorrection(ware, otCode, fix.id), ForbiddenError);
  await cases.applyCorrection({ ...acct, now: later }, otCode, fix.id);
  await cases.resolveCase(acct, otCode, "record_corrected", "Packing slip shows 20; supplementary invoice issued.");
  const v2 = (await cases.getCase(ware, ssCode))!;
  const fixes = await cases.corrections(ware, v2);
  await cases.applyCorrection({ ...ware, now: later }, ssCode, fixes.find((c) => c.id.startsWith("receive:"))!.id);
  const v3 = (await cases.getCase(ware, ssCode))!;
  const recount = (await cases.corrections(ware, v3)).find((c) => c.id.startsWith("recount:"))!;
  const [, vid, lid] = recount.id.split(":");
  const now = (await one<{ onHand: number }>(`SELECT on_hand AS "onHand" FROM inventory_balances WHERE variant_id = $1 AND location_id = $2`, Number(vid), Number(lid)))!.onHand;
  await cases.applyCorrection({ ...ware, now: later }, ssCode, recount.id, { counted: String(now) });
  const v4 = (await cases.getCase(ware, ssCode))!;
  expect(v4.findings.filter((f) => f.kind === "fact" && f.status === "open").length === 0, "all stock facts should now reconcile");
  await cases.resolveCase(ware, ssCode, "goods_located", "Two polos were on the showroom rail; received and recounted.");
  await throws(() => cases.closeCase(ware, ssCode), ForbiddenError);
  await cases.closeCase(owner, ssCode);
  const audit = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_events WHERE business_id = 1 AND entity_code IN ($1, $2)`, otCode, ssCode);
  expect(audit!.n >= 4, "corrections and resolutions should be audited");
  return `${otCode} resolved; ${ssCode} resolved and closed; ${audit!.n} audit events`;
});
await test("Scenario", "Resolved findings don't reopen", async () => {
  const r = await runChecks(1, later);
  expect(!r.created.length, `checks reopened: ${r.created.join(", ")}`);
  return "a second check run opened nothing";
});

console.log("\nedge cases (spec section 9)");
await test("Intake", "Ambiguous order: the reader asks instead of picking", async () => {
  const d = await draftWithRules(acct, "1 white tee size M");
  expect(d.lines[0].match.status === "needs-choice" && d.lines[0].match.chosenId === null, "should need a choice");
  return d.lines[0].match.reason;
});
await test("Intake", "Unknown variant: never matched to a made-up SKU", async () => {
  const d = await draftWithRules(acct, "10 navy hoodie M");
  expect(d.lines[0].match.status === "unmatched" && d.lines[0].match.chosenId === null, "should be unmatched");
  return d.lines[0].match.reason;
});
await test("Reservations", "Insufficient stock: reserves what is free, reports the rest, decides nothing", async () => {
  const sku = "BLK-OVT-S";
  const v = await variant(sku);
  const f = await free(sku);
  const c = await orders.confirmOrder(acct, { customerId: 2, channel: "manual", sourceText: "", extractedBy: "manual", lines: [{ variantId: v.id, qty: f + 5 }] });
  expect(c.shortages.length === 1 && c.shortages[0].reserved === f, "should reserve exactly what was free");
  expect((await free(sku)) === 0, "nothing should be left free");
  const item = await one<{ backordered: boolean; cancelled: number }>(`SELECT backordered, qty_cancelled AS cancelled FROM order_items WHERE id = $1`, c.shortages[0].orderItemId);
  expect(!item!.backordered && item!.cancelled === 0, "the shortfall waits for the owner's decision");
  return `${f} reserved, 5 short, waiting for a decision`;
});
await test("Reservations", "Simultaneous orders can't oversell", async () => {
  const best = await one<{ sku: string }>(
    `SELECT v.sku FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id JOIN locations l ON l.id = b.location_id
      WHERE v.business_id = 1 AND l.sellable GROUP BY v.sku ORDER BY SUM(b.on_hand - b.reserved) DESC LIMIT 1`,
  );
  const sku = best!.sku;
  const v = await variant(sku);
  const f = await free(sku);
  expect(f > 0, "need a variant with free stock");
  const both = await Promise.all([1, 2].map((cust) => orders.confirmOrder(acct, { customerId: cust, channel: "manual", sourceText: "", extractedBy: "manual", lines: [{ variantId: v.id, qty: f }] })));
  const reserved = both.reduce((a, c) => a + (c.shortages[0]?.reserved ?? f), 0);
  expect(reserved === f, `reserved ${reserved} of ${f} free`);
  expect(both.filter((c) => c.shortages.length).length === 1, "exactly one order should come up short");
  expect((await free(sku)) === 0, "free stock should be exactly zero");
  return `two concurrent orders each wanting all ${f} free ${sku}: ${reserved} reserved in total, one order short`;
});
await test("Reservations", "The database refuses a balance that would oversell", async () => {
  const v = await variant("WHT-POL-M");
  let refused = false;
  try {
    await run(`UPDATE inventory_balances SET reserved = on_hand + 1 WHERE variant_id = $1 AND location_id = $2`, v.id, v.home);
  } catch {
    refused = true;
  }
  expect(refused, "CHECK constraint should reject reserved > on_hand");
  return "CHECK (reserved <= on_hand) holds";
});
await test("Ledger", "Stock movements are append-only", async () => {
  let refused = false;
  try {
    await run(`UPDATE stock_movements SET qty = qty + 1 WHERE id = 1`);
  } catch {
    refused = true;
  }
  expect(refused, "UPDATE should be rejected");
  return "UPDATE rejected by trigger; corrections are new rows";
});
await test("Analytics", "Missing sales history: new products are 'too new', and a recording gap is flagged", async () => {
  const h = await variantHealth(owner);
  const crd = h.filter((x) => x.productCode === "CRD");
  expect(crd.length && crd.every((x) => x.health !== "dead"), "a new product must not be called dead");
  const gaps = await dataGaps(owner);
  expect(gaps.some((g) => g.days >= 3), "the 3-day recording gap should be found");
  return `${crd.filter((x) => x.health === "too-new").length} CRD variants too new to judge; gap of ${gaps[0].days} days found`;
});
await test("Security", "Tenant isolation: one business can't read or use another's records", async () => {
  expect(!(await cases.getCase(other, "OT-001")), "business 2 can read business 1's case");
  const v = await variant("BLK-TSH-M");
  await throws(() => orders.confirmOrder(other, { customerId: users.find((u) => u.businessId === 2)!.id, channel: "manual", sourceText: "", extractedBy: "manual", lines: [{ variantId: v.id, qty: 1 }] }), DomainError);
  return "cases and variants are scoped to the signed-in business";
});
await test("Security", "Role permissions are enforced in the backend", async () => {
  const v = await variant("BLK-TSH-L");
  await throws(() => stock.adjustStock(ware, { variantId: v.id, locationId: v.home, qty: -1, reason: "test" }), ForbiddenError);
  await throws(() => billing.issueInvoice(ware, 1), ForbiddenError);
  await throws(() => orders.dispatchOrder(acct, 1), ForbiddenError);
  return "warehouse can't adjust or invoice; accounts can't dispatch";
});
await test("Engine", "Running the checks twice changes nothing", async () => {
  await runChecks(1, later);
  const r = await runChecks(1, later);
  expect(!r.created.length && !r.updated.length && !r.findings, "second run made changes");
  return "idempotent";
});
await test("Purchasing", "Budget is a hard limit and supplier minimums hold", async () => {
  const out: string[] = [];
  for (const b of [5000, 30000, 75000]) {
    const p = await buildPlan(owner, b);
    expect(p.used <= b, `plan for ${b} used ${p.used}`);
    for (const s of p.suppliers) if (s.status !== "dropped") expect(s.units >= s.moq, `${s.name} below its minimum`);
    out.push(`₹${b}: ₹${p.used} on ${p.lines.length} lines`);
  }
  return out.join("; ");
});

console.log("\nmeasurements");
const intake = await evalIntake(owner);
const retrieval = await evalRetrieval(owner);
const bt = await backtest(owner);
console.log(`  intake: ${intake.exact}/${intake.cases} messages fully right; retrieval top-1 ${retrieval.top1}/${retrieval.cases}; forecast WAPE ${(bt.productWape * 100).toFixed(0)}% per product-week`);

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
if (process.argv.includes("--write")) {
  writeFileSync("data/test-report.json", JSON.stringify({
    ranAt: new Date().toISOString(), node: process.version, results,
    intake: { cases: intake.cases, exact: intake.exact, bySet: intake.bySet, byLang: intake.byLang, lines: intake.lines, matched: intake.matched, asked: intake.asked, refused: intake.refused, wrongSku: intake.wrongSku },
    retrieval: { cases: retrieval.cases, top1: retrieval.top1, top3: retrieval.top3 },
    backtest: { weeks: bt.weeks, wape: bt.wape, naiveWape: bt.naiveWape, productWape: bt.productWape, productNaiveWape: bt.productNaiveWape, totalWape: bt.totalWape, bias: bt.bias },
  }, null, 2) + "\n");
  console.log("wrote data/test-report.json");
}
process.exit(failed.length ? 1 : 0);
