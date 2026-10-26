// Builds both synthetic businesses in memory: catalogue, simulated history,
// planted scenarios, then human-readable record codes in time order.

import { BUSINESSES } from "./catalog.ts";
import { INDIGO_POLICIES, SAFFRON_POLICIES } from "./policies.ts";
import { plantScenarios } from "./scenarios.ts";
import { simulate } from "./simulate.ts";
import { SCHEMA_VERSION } from "../db/schema.ts";
import { buildCatalogue, Clock, mulberry32, type Biz, type Row, World } from "./world.ts";

const REF_TABLE: Record<string, string> = {
  order: "orders", shipment: "shipments", receipt: "receipts", transfer: "transfers", return: "returns", investigation: "investigations",
  invoice: "invoices", payment: "payments", pick_list: "pick_lists", purchase_order: "purchase_orders", count: "physical_stock_counts",
};

export interface Built {
  world: World;
  businesses: Biz[];
  now: Date;
}

export function buildWorld(now = new Date(), seed = 20261026): Built {
  const world = new World();
  const clock = new Clock(now);
  const businesses: Biz[] = [];
  for (const def of BUSINESSES) {
    const biz = buildCatalogue(world, def, now, clock);
    const rng = mulberry32(seed + biz.id * 101);
    const planted = def.scenarios ? plantScenarios(world, biz, clock) : null;
    simulate(world, biz, clock, {
      seed: rng,
      gapDays: def.scenarios ? gapDays(clock) : [],
      freeze: planted?.freeze,
      extra: planted?.extra,
    });
    planted?.finish();
    businesses.push(biz);
    addDocuments(world, biz, now, def.scenarios ? SAFFRON_POLICIES : INDIGO_POLICIES);
  }
  assignCodes(world, businesses, clock);
  world.add("meta", { key: "seeded_at", value: now.toISOString() });
  world.add("meta", { key: "schema_version", value: SCHEMA_VERSION });
  return { world, businesses, now };
}

/** Three weekdays about six weeks ago when no orders were entered (staff away, records not kept). */
function gapDays(clock: Clock): number[] {
  let d = -45;
  while ([0, 1].includes(clock.cal(d).weekday) || [0, 1].includes(clock.cal(d + 2).weekday)) d--;
  return [d, d + 1, d + 2];
}

function addDocuments(w: World, biz: Biz, now: Date, docs: typeof SAFFRON_POLICIES) {
  for (const d of docs) {
    const doc = w.add("documents", {
      business_id: biz.id, supplier_id: d.supplier ? biz.suppliers.get(d.supplier)!.id : null, title: d.title, kind: d.kind,
      updated_at: new Date(now.getTime() - 30 * 86_400_000),
    });
    for (const [heading, body] of d.sections) w.add("document_chunks", { business_id: biz.id, document_id: doc.id, heading, body });
  }
}

function assignCodes(w: World, businesses: Biz[], clock: Clock) {
  const anchorAt = clock.at(-1, 10, 4).getTime();
  for (const biz of businesses) {
    const mine = (table: string) => w.rows(table).filter((r) => r.business_id === biz.id);
    const number = (rows: Row[], time: string, prefix: string, width: number, start: number, anchor?: (r: Row) => boolean, anchorN?: number) => {
      const sorted = [...rows].sort((a, b) => (a[time] as Date).getTime() - (b[time] as Date).getTime() || a.id - b.id);
      let first = start;
      if (anchor && anchorN !== undefined) {
        const idx = sorted.findIndex(anchor);
        if (idx >= 0) first = Math.max(1, anchorN - idx);
      }
      sorted.forEach((r, i) => (r.code = `${prefix}${String(first + i).padStart(width, "0")}`));
    };
    const main = biz.def.scenarios;
    const orders = mine("orders");
    const ord1042 = main ? orders.find((o) => (o.created_at as Date).getTime() === anchorAt) : undefined;
    number(orders, "created_at", "ORD-", 4, 1001, ord1042 ? (o) => o === ord1042 : undefined, 1042);
    const invoices = mine("invoices");
    number(invoices.filter((i) => i.kind === "invoice"), "issued_at", "INV-", 4, 1001, ord1042 ? (i) => i.order_id === ord1042.id : undefined, 2058);
    number(invoices.filter((i) => i.kind === "credit_note"), "issued_at", "CN-", 4, 301);
    number(mine("shipments"), "dispatched_at", "SHP-", 3, 101, ord1042 ? (s) => s.order_id === ord1042.id : undefined, 501);
    const payments = mine("payments");
    number(payments.filter((p) => p.kind === "receipt"), "received_at", "PAY-", 4, 3001);
    number(payments.filter((p) => p.kind === "refund"), "received_at", "RFD-", 3, 101);
    number(mine("pick_lists"), "created_at", "PL-", 4, 1101);
    const trf = mine("transfers");
    const trf87 = main ? trf.find((t) => t.status === "sent") : undefined;
    number(trf, "sent_at", "TRF-", 4, 1, trf87 ? (t) => t === trf87 : undefined, 87);
    number(mine("purchase_orders"), "placed_at", "PO-", 4, 2601);
    number(mine("receipts"), "received_at", "GRN-", 4, 401);
    number(mine("returns"), "received_at", "RET-", 4, 51);
    number(mine("physical_stock_counts"), "counted_at", "CNT-", 4, 101);
  }
  const codeOf = (type: string, id: number) => {
    const table = REF_TABLE[type];
    return table ? ((w.rows(table)[id - 1]?.code as string | undefined) ?? null) : null;
  };
  for (const [row, ref] of w.refs) {
    if (!ref) continue;
    if ("ref_code" in row) row.ref_code = codeOf(ref.type, ref.id);
    else if ("entity_code" in row) row.entity_code = codeOf(ref.type, ref.id);
  }
  for (const e of w.rows("investigation_evidence")) if (!e.record_code) e.record_code = codeOf(e.record_type as string, e.record_id as number) ?? "";
}
