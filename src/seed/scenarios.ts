// The discrepancies planted into the demo wholesaler's history, all on the
// last trading day ("yesterday") unless noted. Each mirrors an example in the
// product spec so the Investigation Centre has real work to show:
//
//  OT  ORD-1042  20 blue oxford shirts ordered, allocated, picked and shipped;
//                invoice INV-2058 bills 18; paid in full; marked completed.
//  SS  BLK-TSH-M at A-R12-S3-B12: recorded 50, counted 44. Four units were
//                picked for an order that was then cancelled (the reservation
//                was never released), and transfer TRF-0087 sent two units to
//                the showroom rail that nobody scanned in.
//  --  ORD-1044  a legitimate partial shipment with six units on backorder,
//                which the rules must not flag.
//  plus a duplicate payment, an unallocated payment, a shipment to the wrong
//  customer, an order closed with a line never shipped, a goods receipt
//  posted twice, a return never restocked, repeated manual adjustments, a
//  balance edited outside the ledger and chinos found in the wrong bin.
//
// SS-001..SS-003 are earlier StockSleuth cases, already resolved and closed.

import type { Clock } from "./world.ts";
import { DAY, type Biz, type Row, type VariantInfo, type World } from "./world.ts";

type Event = { day: number; minute: number; run: (at: Date) => void };

export interface Planted {
  freeze: { fromDay: number; skus: string[] };
  extra: (day: number) => Event[];
  finish: () => void;
}

const minutes = (hh: number, mm: number) => hh * 60 + mm;

export function plantScenarios(w: World, biz: Biz, clock: Clock): Planted {
  const v = (sku: string) => {
    const x = biz.bySku.get(sku);
    if (!x) throw new Error(`scenario needs ${sku}`);
    return x;
  };
  const customer = (code: string) => biz.customers.find((c) => c.code === code)!;
  const loc = (code: string) => biz.locations.get(code)!;
  const bal = (x: VariantInfo, l: Row = x.home) => w.balance(biz, x.row.id, l.id);
  const freeAt = (x: VariantInfo) => bal(x).on_hand - bal(x).reserved;
  const events: Event[] = [];
  const at = (day: number, hh: number, mm: number, run: (when: Date) => void) => events.push({ day, minute: minutes(hh, mm), run });
  const ravi = biz.warehouse;
  const deepak = biz.picker;
  const sana = biz.accounts;
  const arjun = biz.owner;

  const blackTeeM = v("BLK-TSH-M");
  const blueShirtM = v("BLU-SHT-M");

  // ---- setup: known balances on the two bins the main story uses ----
  at(-1, 8, 40, (when) => {
    const b = bal(blackTeeM);
    const base = Math.max(30, b.reserved);
    if (b.on_hand > base) w.transfer(biz, blackTeeM, blackTeeM.home, loc("A-R12-S5-B12"), b.on_hand - base, when, ravi, new Date(when.getTime() + 5 * 60_000), "Overflow to shelf 5 before the delivery");
  });
  at(-1, 9, 0, (when) => {
    const tkm = biz.suppliers.get("TKM")!;
    const need = 50 - bal(blackTeeM).on_hand;
    const lines = [{ v: blackTeeM, qty: need }, { v: v("BLK-TSH-L"), qty: 40 }, { v: v("BLK-TSH-S"), qty: 20 }, { v: v("BLK-TSH-XL"), qty: Math.max(10, 100 - need - 60) }];
    const { po } = w.placePO(biz, tkm, lines, clock.at(-11, 17, 30), arjun);
    w.receivePO(biz, po, when, ravi);
    const free = freeAt(blueShirtM);
    if (free < 26) {
      const { po: p2 } = w.placePO(biz, biz.suppliers.get("KSC")!, [{ v: blueShirtM, qty: Math.ceil((26 - free) / 6) * 6 }, { v: v("WHT-SHT-M"), qty: 30 }], clock.at(-8, 17, 30), arjun);
      w.receivePO(biz, p2, new Date(when.getTime() + 3 * 60_000), ravi);
    }
  });

  // ---- ORD-1042: invoice bills 18 of the 20 shipped ----
  let ord1042: { order: Row; items: Row[] } | null = null;
  at(-1, 10, 4, (when) => {
    const reserveAt = new Date(when.getTime() + 11 * 60_000);
    ord1042 = w.createOrder(biz, customer("C01"), when, [{ v: blueShirtM, qty: 20, text: "20 blue oxford shirt M" }], {
      text: "Bhai, 20 blue oxford shirt M chahiye. Kal tak bhej do.", due: clock.at(0, 18), reserveAt,
    });
  });
  at(-1, 10, 40, (when) => w.pick(biz, ord1042!.order, when, deepak));
  let inv2058: Row | null = null;
  at(-1, 11, 2, (when) => {
    inv2058 = w.invoice(biz, ord1042!.order, [{ item: ord1042!.items[0], qty: 18 }], when, sana).invoice;
  });
  at(-1, 15, 30, (paid) => {
    w.pay(biz, inv2058, customer("C01").id, 18 * (blueShirtM.product.unit_price as number), paid, sana, "upi", "UPI 4471 0923 MEHRA");
    const o = ord1042!.order;
    o.status = "completed";
    o.completed_at = new Date(paid.getTime() + 5 * 60_000);
    w.audit(biz, sana, "order.completed", "order", o.id, o.completed_at as Date, "Invoice paid in full");
  });
  at(-1, 11, 20, (when) => w.dispatch(biz, ord1042!.order, when, ravi, { carrier: "Shree Transport" }));

  // ---- ORD-1043: picked, then cancelled; the picked reservation is never released ----
  let ord1043: { order: Row; items: Row[] } | null = null;
  at(-1, 10, 6, (when) => {
    ord1043 = w.createOrder(biz, customer("C03"), when, [
      { v: blackTeeM, qty: 4, text: "4 black crew tee M" },
      { v: v("GRY-TSH-L"), qty: 10, text: "10 grey crew tee L" },
    ], { text: "Hi, 4 black crew tee M aur 10 grey crew tee L. Jaldi bhejna." });
  });
  at(-1, 10, 15, (when) => {
    const o = ord1043!;
    const pl = w.add("pick_lists", { business_id: biz.id, code: null, order_id: o.order.id, status: "open", created_at: new Date(when.getTime() - 6 * 60_000), picked_at: null, picked_by: deepak.id });
    for (const item of o.items) {
      for (const r of w.reservations(item, "active")) {
        const black = item.variant_id === blackTeeM.row.id;
        w.add("pick_list_items", { pick_list_id: pl.id, reservation_id: r.id, variant_id: r.variant_id, location_id: r.location_id, qty_to_pick: r.qty, qty_picked: black ? r.qty : null, picked_at: black ? when : null });
        if (black) {
          r.status = "picked";
          r.updated_at = when;
        }
      }
    }
    o.order.status = "picking";
    w.audit(biz, deepak, "pick_list.line_picked", "pick_list", pl.id, when, "4 × BLK-TSH-M picked from A-R12-S3-B12");
  });
  at(-1, 12, 40, (when) => {
    const o = ord1043!;
    for (const item of o.items) for (const r of w.reservations(item, "active")) w.release(biz, r, when, "Order cancelled");
    o.order.status = "cancelled";
    o.order.cancelled_at = when;
    o.order.note = "Customer cancelled on the phone";
    const pl = w.rows("pick_lists").find((p) => p.order_id === o.order.id)!;
    pl.status = "cancelled";
    w.audit(biz, arjun, "order.cancelled", "order", o.order.id, when, "Customer cancelled on the phone");
  });

  // ---- TRF-0087: sent to the showroom rail, never scanned in ----
  at(-1, 11, 30, (when) => w.transfer(biz, blackTeeM, blackTeeM.home, loc("A-SR-S1-B01"), 2, when, ravi, null, "Two display pieces for the showroom rail"));

  // ---- ORD-1044: a legitimate partial shipment, six on backorder ----
  at(-1, 10, 30, (when) => {
    const options = ["BLK-OVT-L", "BLK-OVT-M", "WHT-OVT-L", "BGE-OVT-L"].map(v).sort((a, b) => freeAt(b) - freeAt(a));
    const x = options[0];
    const qty = Math.max(freeAt(x), 12) + 6;
    const o = w.createOrder(biz, customer("C02"), when, [{ v: x, qty, text: `${qty} ${x.row.colour} oversized tee ${x.row.size}` }], {
      text: `Bhaiya ${qty} ${x.row.colour} oversized tee ${x.row.size}. Jitna hai abhi bhej do, baaki baad mein.`,
    });
    for (const item of o.shorts) item.backordered = true;
    ord1044 = o.order;
  });
  let ord1044: Row | null = null;
  at(-1, 11, 45, (t) => w.pick(biz, ord1044!, t, deepak));
  at(-1, 16, 10, (t) => {
    const sent = w.dispatch(biz, ord1044!, t, ravi);
    if (sent) w.invoice(biz, ord1044!, sent.lines, new Date(t.getTime() + 8 * 60_000), sana);
    w.settle(ord1044!, t);
  });

  // ---- shipment addressed to the wrong customer ----
  at(-1, 11, 50, (when) => {
    wrongCustomer = w.createOrder(biz, customer("C06"), when, [{ v: v("NVY-JOG-L"), qty: 12, text: "12 navy joggers L" }], { text: "Sir 12 navy joggers L bhej do" }).order;
  });
  let wrongCustomer: Row | null = null;
  at(-1, 13, 30, (t) => w.pick(biz, wrongCustomer!, t, deepak));
  at(-1, 16, 30, (t) => {
    const sent = w.dispatch(biz, wrongCustomer!, t, ravi, { customer: customer("C05") });
    if (sent) w.invoice(biz, wrongCustomer!, sent.lines, new Date(t.getTime() + 10 * 60_000), sana);
    w.settle(wrongCustomer!, t);
  });

  // ---- an order closed with a line that was never shipped, cancelled or backordered ----
  at(-3, 11, 10, (when) => {
    const o = w.createOrder(biz, customer("C11"), when, [
      { v: v("WHT-POL-M"), qty: 15, text: "15 white polo M" },
      { v: v("MRN-POL-L"), qty: 10, text: "10 maroon polo L" },
    ], { text: "15 white polo M, 10 maroon polo L" });
    at(-2, 10, 25, (t) => {
      const pl = w.add("pick_lists", { business_id: biz.id, code: null, order_id: o.order.id, status: "picked", created_at: new Date(t.getTime() - 10 * 60_000), picked_at: t, picked_by: deepak.id });
      for (const item of o.items) {
        for (const r of w.reservations(item, "active")) {
          const found = item.variant_id !== v("MRN-POL-L").row.id;
          w.add("pick_list_items", { pick_list_id: pl.id, reservation_id: r.id, variant_id: r.variant_id, location_id: r.location_id, qty_to_pick: r.qty, qty_picked: found ? r.qty : 0, picked_at: t });
          if (found) {
            r.status = "picked";
            r.updated_at = t;
          } else {
            w.release(biz, r, t, "Picker could not find these on the bin");
            const b = w.balance(biz, r.variant_id as number, r.location_id as number);
            b.needs_verification = true;
            b.verification_note = "Picker found none of the 10 needed for an order; recount the bin";
          }
        }
      }
    });
    at(-2, 16, 5, (t) => {
      const sent = w.dispatch(biz, o.order, t, ravi);
      if (!sent) return;
      const { invoice, total } = w.invoice(biz, o.order, sent.lines, new Date(t.getTime() + 9 * 60_000), sana);
      at(-1, 12, 20, (p) => w.pay(biz, invoice, o.order.customer_id as number, total, p, sana, "bank", "NEFT GFH 2210"));
    });
    at(-1, 18, 0, (t) => {
      o.order.status = "completed";
      o.order.completed_at = t;
      w.audit(biz, sana, "order.completed", "order", o.order.id, t, "Marked complete after payment");
    });
  });

  // ---- a payment recorded twice, and one never allocated ----
  at(-1, 16, 10, (when) => {
    const candidates = w.rows("invoices").filter((inv) => inv.business_id === biz.id && inv.kind === "invoice" && (inv.issued_at as Date).getTime() < when.getTime() - 3 * DAY && w.paidOn(inv) === 0);
    const inv = candidates.at(-1);
    if (!inv) return;
    const amount = w.invoiceTotal(inv);
    w.pay(biz, inv, inv.customer_id as number, amount, when, sana, "upi", "UPI 8812 3307 ROYAL");
    w.pay(biz, inv, inv.customer_id as number, amount, new Date(when.getTime() + 4 * 60_000), sana, "upi", "UPI 8812 3307 ROYAL");
    w.settle(w.rows("orders")[(inv.order_id as number) - 1], when);
  });
  at(-1, 17, 0, (when) => w.pay(biz, null, customer("C07").id, 12_000, when, sana, "bank", "NEFT KAPOOR CLOTH OCT"));

  // ---- a goods receipt posted twice ----
  at(-1, 15, 40, (when) => {
    const hood = v("BLK-HOD-L");
    const { po, items } = w.placePO(biz, biz.suppliers.get("LFH")!, [{ v: hood, qty: 12 }, { v: v("GRY-HOD-L"), qty: 24 }, { v: v("MRN-HOD-M"), qty: 24 }], clock.at(-13, 18), arjun);
    const grn = w.receivePO(biz, po, when, ravi);
    const dup = new Date(when.getTime() + 60_000);
    w.add("receipt_items", { receipt_id: grn.id, purchase_order_item_id: items[0].id, variant_id: hood.row.id, location_id: hood.home.id, qty: 12 });
    w.move(biz, hood.row.id, hood.home.id, "receipt", 12, dup, { type: "receipt", id: grn.id }, ravi, null);
  });

  // ---- a resellable return that was credited but never restocked ----
  at(-1, 12, 10, (when) => {
    const polo = v("NVY-POL-M");
    const shipped = w.rows("shipment_items").filter((si) => si.variant_id === polo.row.id && (si.qty as number) >= 3);
    const unpaid = shipped.filter((si) => w.rows("orders")[(w.rows("order_items")[(si.order_item_id as number) - 1].order_id as number) - 1].status === "dispatched");
    const past = unpaid.at(-1) ?? shipped.at(-1);
    if (!past) return;
    const item = w.rows("order_items")[(past.order_item_id as number) - 1];
    const order = w.rows("orders")[(item.order_id as number) - 1];
    const ret = w.add("returns", { business_id: biz.id, code: null, order_id: order.id, customer_id: order.customer_id, received_at: when, received_by: ravi.id, note: "Retailer over-ordered; tags intact" });
    w.add("return_items", { return_id: ret.id, order_item_id: item.id, variant_id: polo.row.id, qty: 3, condition: "resellable", location_id: polo.home.id, restocked_qty: 0 });
    w.audit(biz, ravi, "return.received", "return", ret.id, when);
    w.invoice(biz, order, [{ item, qty: 3 }], new Date(when.getTime() + 20 * 60_000), sana, "credit_note");
  });

  // ---- three manual adjustments on the same jeans without a count ----
  let jeans: VariantInfo | null = null;
  for (const [day, hh, qty] of [[-9, 18, -2], [-5, 18, -3], [-1, 17, -2]] as const) {
    at(day, hh, 20, (when) => {
      jeans ??= biz.variants.filter((x) => x.def.code === "DNM").sort((a, b) => freeAt(b) - freeAt(a))[0];
      if (freeAt(jeans) >= -qty) w.move(biz, jeans.row.id, jeans.home.id, "adjustment", qty, when, null, ravi, "Count correction");
    });
  }

  // ---- olive chinos found in the khaki bin ----
  at(-1, 16, 45, (when) => {
    const olive = v("OLV-CHN-32");
    const khakiBin = v("KHK-CHN-32").home;
    if (bal(olive).on_hand - bal(olive).reserved < 5) {
      const { po } = w.placePO(biz, biz.suppliers.get("ADW")!, [{ v: olive, qty: 10 }, { v: v("OLV-CHN-30"), qty: 20 }, { v: v("OLV-CHN-34"), qty: 20 }], clock.at(-15, 18), arjun);
      w.receivePO(biz, po, clock.at(-1, 9, 10), ravi);
    }
    const lines = [
      { v: olive, loc: olive.home, counted: bal(olive).on_hand - 5 },
      { v: v("KHK-CHN-32"), loc: khakiBin, counted: bal(v("KHK-CHN-32")).on_hand },
      { v: olive, loc: khakiBin, counted: 5 },
    ];
    w.count(biz, lines, when, ravi, "Rack R-02, size 32 bins");
  });

  // ---- the count that finds BLK-TSH-M short ----
  at(-1, 14, 0, (when) => {
    const shelf = ["S", "M", "L", "XL", "XXL"].map((s) => v(`BLK-TSH-${s}`));
    w.count(biz, shelf.map((x) => ({ v: x, loc: x.home, counted: x === blackTeeM ? bal(x).on_hand - 6 : bal(x).on_hand })), when, ravi, "Rack R-12, shelf 3");
  });

  // ---- three earlier StockSleuth cases, resolved and closed ----
  const history: { day: number; sku: string; diff: number; outcome: string; note: string; adjust: boolean }[] = [
    { day: -40, sku: "GRY-HOD-M", diff: -1, outcome: "counting_error", note: "Recount the same evening found all pieces; the first count missed a folded stack.", adjust: false },
    { day: -25, sku: "WHT-SHT-L", diff: -3, outcome: "goods_located", note: "Three shirts were in the packing area from a cancelled pick; returned to the bin.", adjust: false },
    { day: -12, sku: "KHK-CHN-34", diff: -2, outcome: "adjustment_approved", note: "Two pairs damaged by a roof leak and binned without a write-off. Adjustment approved.", adjust: true },
  ];
  const closed: { inv: Row; count: Row; x: VariantInfo; recorded: number; diff: number; outcome: string; note: string; when: Date }[] = [];
  history.forEach((h, i) => {
    at(h.day, 18, 30, (when) => {
      const x = v(h.sku);
      if (bal(x).on_hand + h.diff < bal(x).reserved) return;
      const recorded = bal(x).on_hand;
      const count = w.count(biz, [{ v: x, loc: x.home, counted: recorded + h.diff }], when, ravi, `Cycle count, rack ${x.def.rack}`, "cycle");
      const inv = w.add("investigations", {
        business_id: biz.id, code: `SS-00${i + 1}`, module: "stocksleuth", case_key: `stock:${x.row.id}:${x.home.id}`,
        title: `Count variance on ${h.sku}: ${h.diff} units`, summary: h.note, status: "closed", outcome: h.outcome, priority: "medium",
        assignee_id: ravi.id, subject_type: "stock", subject_id: x.row.id, subject_code: h.sku, detected_at: new Date(when.getTime() + 15 * 60_000),
        updated_at: new Date(when.getTime() + DAY), resolved_at: new Date(when.getTime() + 20 * 3_600_000), resolved_by: arjun.id, resolution_note: h.note,
      });
      closed.push({ inv, count, x, recorded, diff: h.diff, outcome: h.outcome, note: h.note, when });
      at(h.day + 1, 10, 0, (next) => {
        if (h.adjust) {
          w.move(biz, x.row.id, x.home.id, "adjustment", h.diff, next, { type: "investigation", id: inv.id }, arjun, `Approved in ${inv.code}: ${h.note}`);
        } else {
          w.count(biz, [{ v: x, loc: x.home, counted: bal(x).on_hand }], new Date(next.getTime() - 14 * 3_600_000), ravi, `Recount for ${inv.code}`, "handheld");
        }
      });
    });
  });

  return {
    freeze: { fromDay: -4, skus: ["BLK-TSH-M"] },
    extra: (day) => events.filter((e) => e.day === day),
    finish: () => {
      // A balance edited outside the ledger: +3 on grey joggers L with no movement behind it.
      const jog = v("GRY-JOG-L");
      const b = bal(jog);
      b.on_hand += 3;
      b.updated_at = clock.at(-1, 18, 5);
      for (const c of closed) writeClosedCase(w, biz, c, ravi, arjun);
    },
  };
}

function writeClosedCase(w: World, biz: Biz, c: { inv: Row; count: Row; x: VariantInfo; recorded: number; diff: number; outcome: string; note: string; when: Date }, ravi: Row, arjun: Row) {
  const f = w.add("investigation_findings", {
    investigation_id: c.inv.id, module: "stocksleuth", rule_id: "SS-COUNT", rule_version: 1, fingerprint: `SS-COUNT:${c.count.id}:${c.x.row.id}:${c.x.home.id}`,
    kind: "fact", certainty: "verified", title: `Counted ${c.recorded + c.diff}, recorded ${c.recorded}`, detail: `A cycle count found ${-c.diff} fewer than recorded at ${c.x.home.code}.`,
    expected_value: c.recorded, actual_value: c.recorded + c.diff, unit: "units", calculation: `${c.recorded + c.diff} counted − ${c.recorded} recorded = ${c.diff}`,
    exceptions_checked: [], missing_evidence: [], status: "confirmed", first_seen_at: c.inv.detected_at, last_seen_at: c.inv.resolved_at,
  });
  w.add("investigation_evidence", {
    investigation_id: c.inv.id, finding_id: f.id, record_type: "count", record_id: c.count.id, record_code: "", label: "Cycle count",
    snapshot: { sku: c.x.row.sku, location: c.x.home.code, recorded: c.recorded, counted: c.recorded + c.diff }, occurred_at: c.when,
  });
  const ev = (type: string, body: string, at: Date, actor: Row | null) =>
    w.add("investigation_events", { investigation_id: c.inv.id, actor_user_id: actor?.id ?? null, actor_process: actor ? null : "consistency check", type, body, data: {}, created_at: at });
  ev("detected", "Opened by the count-variance rule.", c.inv.detected_at as Date, null);
  ev("assigned", "Assigned to Ravi Kumar.", new Date((c.inv.detected_at as Date).getTime() + 30 * 60_000), arjun);
  ev("resolution", `Resolved as ${c.outcome.replaceAll("_", " ")}: ${c.note}`, c.inv.resolved_at as Date, arjun);
  ev("status", "Closed.", c.inv.updated_at as Date, arjun);
}
