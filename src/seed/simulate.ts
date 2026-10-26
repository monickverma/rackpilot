// Simulates a business's trading history day by day, oldest first:
// retailer orders arrive as messages and reserve stock; the next day they are
// picked, dispatched and invoiced; customers pay within their credit terms;
// short lines wait on backorder until a purchase order arrives; purchasing
// runs every Tuesday in the supplier's packs and above its minimum order; a
// few goods come back, get damaged or move to the showroom rail.
//
// The history it writes is clean: every record agrees with every other one.
// The discrepancies the investigation modules find are planted afterwards in
// scenarios.ts, so each one is deliberate and documented.

import { SPOKEN } from "../lib/intake/lexicon.ts";
import { seasonFactor } from "./catalog.ts";
import { Clock, DAY, poisson, weighted, type Biz, type Row, type VariantInfo, type World } from "./world.ts";

const QTY_CHOICES = [5, 6, 10, 12, 15, 20, 24];
const QTY_WEIGHTS = [2, 1, 4, 2, 2, 1.5, 0.5];
const GREETINGS = ["Bhai,", "Bhaiya", "Hi", "Namaste ji,", "Hello sir,", "Sir", ""];
const CLOSERS: [number | null, string][] = [
  [1, "Kal tak bhej do."], [2, "Parso tak chahiye."], [null, "Jaldi bhejna."], [null, "Same rate as last time."], [3, "Is hafte chahiye."], [null, ""], [1, "Need by tomorrow."],
];

interface Planned {
  day: number;
  minute: number;
  run: (at: Date) => void;
}

export interface SimOptions {
  /** Days on which nobody entered orders (a recording gap the analytics should notice). */
  gapDays?: number[];
  /** SKUs kept out of new orders from this day on, so a scenario starts from a known balance. */
  freeze?: { fromDay: number; skus: string[] };
  /** Extra timed events per day, merged into the simulation (used by the scenarios). */
  extra?: (day: number) => Planned[];
  seed: () => number;
}

export function expectedDailyUnits(biz: Biz, v: VariantInfo, clock: Clock, day: number): number {
  const c = clock.cal(day);
  const active = (x: VariantInfo) =>
    day >= (x.def.launchDay ?? -biz.def.historyDays) && (x.def.demandUntilDay === undefined || day <= x.def.demandUntilDay);
  if (!active(v)) return 0;
  const total = biz.variants.reduce((a, x) => a + (active(x) ? x.def.weight * x.colourShare * x.sizeShare * seasonFactor(x.def.profile, c.month, c.date) : 0), 0);
  const share = (v.def.weight * v.colourShare * v.sizeShare * seasonFactor(v.def.profile, c.month, c.date)) / total;
  return biz.def.ordersPerDay * 46 * share;
}

const roundUp = (n: number, pack: number) => Math.ceil(n / pack) * pack;

export function simulate(w: World, biz: Biz, clock: Clock, opts: SimOptions) {
  const rng = opts.seed;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const H = biz.def.historyDays;
  const queue: Planned[] = [];
  const schedule = (day: number, minute: number, run: (at: Date) => void) => queue.push({ day, minute, run });
  const groups = new Map<string, VariantInfo[]>();
  for (const v of biz.variants) groups.set(`${v.def.code}|${v.row.colour}`, [...(groups.get(`${v.def.code}|${v.row.colour}`) ?? []), v]);
  const orderedQty = new Map<number, { day: number; qty: number }[]>();
  const onOrder = new Map<number, number>();
  const openOrders: Row[] = [];
  const pack = (v: VariantInfo) => v.supplier.pack_size as number;

  // ---- opening stock and launches ----
  for (const v of biz.variants) {
    const launch = v.def.launchDay ?? -H;
    const days = v.def.demandUntilDay !== undefined ? 70 : 32;
    const qty = roundUp(expectedDailyUnits(biz, v, clock, Math.max(launch, -H) + 3) * days, pack(v)) + pack(v);
    if (launch <= -H) {
      w.move(biz, v.row.id, v.home.id, "opening", qty, clock.at(-H, 8, 30), null, null, "Opening balance when RackPilot was set up", "import");
    } else {
      schedule(launch, 540, () => {
        const { po } = w.placePO(biz, v.supplier, [{ v, qty }], clock.at(launch - (v.supplier.lead_time_days as number), 17), biz.owner);
        w.receivePO(biz, po, clock.at(launch, 9), biz.warehouse);
      });
    }
  }

  const freeQty = (v: VariantInfo) => w.free(biz, v.row.id);
  const openShort = (item: Row) =>
    (item.qty_ordered as number) - (item.qty_cancelled as number) - w.shipped(item) - w.reservations(item, "active", "picked").reduce((a, r) => a + (r.qty as number), 0);

  function message(lines: { v: VariantInfo; qty: number }[], closer: string) {
    const parts: string[] = [];
    let prev: VariantInfo | null = null;
    for (const l of lines) {
      const name = pick(SPOKEN[l.v.def.code] ?? [l.v.def.name.toLowerCase()]);
      if (prev && prev.def.code === l.v.def.code && prev.row.colour === l.v.row.colour) parts.push(`${l.qty} ${l.v.row.size}`);
      else parts.push(rng() < 0.6 ? `${l.qty} ${l.v.row.colour} ${name} ${l.v.row.size}` : `${l.v.row.colour} ${name} ${l.v.row.size} - ${l.qty}`);
      prev = l.v;
    }
    return `${pick(GREETINGS)} ${parts.join(rng() < 0.5 ? ", " : " aur ")}. ${closer}`.replace(/\s+/g, " ").trim();
  }

  function newOrder(day: number, minute: number) {
    const at = clock.at(day, Math.floor(minute / 60), minute % 60);
    const pairs = [...groups.values()].filter((g) => expectedDailyUnits(biz, g[0], clock, day) > 0 && !(opts.freeze && day >= opts.freeze.fromDay && g.some((v) => opts.freeze!.skus.includes(v.row.sku as string))));
    if (!pairs.length) return;
    const nGroups = 1 + Math.min(poisson(rng, 0.9), 3);
    const chosen = new Set<VariantInfo[]>();
    for (let k = 0; k < nGroups * 3 && chosen.size < nGroups; k++) chosen.add(weighted(pairs, (g) => g.reduce((a, v) => a + expectedDailyUnits(biz, v, clock, day), 0), rng));
    const lines: { v: VariantInfo; qty: number }[] = [];
    for (const g of chosen) {
      const nSizes = Math.min(g.length, 1 + Math.floor(rng() * 3.2));
      const sizes = new Set<VariantInfo>();
      for (let k = 0; k < 12 && sizes.size < nSizes; k++) sizes.add(weighted(g, (v) => v.sizeShare, rng));
      const base = weighted(QTY_CHOICES, (q) => QTY_WEIGHTS[QTY_CHOICES.indexOf(q)], rng);
      for (const v of [...sizes].sort((a, b) => g.indexOf(a) - g.indexOf(b))) lines.push({ v, qty: rng() < 0.7 ? base : weighted(QTY_CHOICES, (q) => QTY_WEIGHTS[QTY_CHOICES.indexOf(q)], rng) });
    }
    const customer = weighted(biz.customers, (c) => 1 + ((c.id * 37) % 5), rng);
    const [dueDays, closer] = pick(CLOSERS);
    const { order, items, shorts } = w.createOrder(biz, customer, at, lines, { text: message(lines, closer), due: dueDays ? clock.at(day + dueDays, 18) : null });
    for (const l of lines) orderedQty.set(l.v.row.id, [...(orderedQty.get(l.v.row.id) ?? []), { day, qty: l.qty }]);
    for (const item of shorts) {
      if (rng() < 0.75) item.backordered = true;
      else {
        item.qty_cancelled = openShort(item);
        item.match_note = `${item.match_note ?? ""} Customer accepted part shipment; ${item.qty_cancelled} not supplied.`.trim();
      }
    }
    if (items.every((i) => i.qty_cancelled === i.qty_ordered)) {
      order.status = "cancelled";
      order.cancelled_at = at;
      order.note = "Nothing in stock; customer will order again";
      return;
    }
    openOrders.push(order);
    if (rng() < 0.03) {
      schedule(day, Math.min(minute + 50, 1190), (when) => {
        if (order.status !== "confirmed") return;
        for (const item of w.items(order)) for (const r of w.reservations(item, "active")) w.release(biz, r, when, "Order cancelled by customer");
        order.status = "cancelled";
        order.cancelled_at = when;
        order.note = "Customer cancelled on the phone";
        w.audit(biz, biz.accounts, "order.cancelled", "order", order.id, when, "Customer cancelled on the phone");
      });
    }
  }

  function fillBackorders(at: Date, day: number) {
    const frozen = opts.freeze && day >= opts.freeze.fromDay ? new Set(opts.freeze.skus.map((s) => biz.bySku.get(s)!.row.id)) : null;
    for (const order of openOrders) {
      if (order.status === "cancelled" || order.status === "completed") continue;
      for (const item of w.items(order)) {
        if (!item.backordered || frozen?.has(item.variant_id as number)) continue;
        const short = openShort(item);
        if (short > 0) w.reserve(biz, item, short, at);
      }
    }
  }

  function receivable(order: Row) {
    const invoices = w.rows("invoices").filter((x) => x.order_id === order.id);
    const billed = invoices.reduce((a, x) => a + (x.kind === "credit_note" ? -1 : 1) * w.invoiceTotal(x), 0);
    const paid = invoices.reduce((a, x) => a + w.paidOn(x), 0);
    return billed - paid;
  }

  function schedulePayments(day: number, order: Row, invoice: Row, total: number) {
    const customer = biz.customers.find((c) => c.id === order.customer_id)!;
    const credit = customer.credit_days as number;
    const r = rng();
    const method = pick(["upi", "upi", "bank", "bank", "cheque", "cash"]);
    const payAt = (d: number, amount: number) => schedule(d, 660 + Math.floor(rng() * 420), (at) => {
      const due = Math.min(amount, receivable(order));
      if (due > 0) w.pay(biz, invoice, customer.id, due, at, biz.accounts, method);
      w.settle(order, at);
    });
    if (r < 0.88) payAt(day + 2 + Math.floor(rng() * (credit + 4)), total);
    else if (r < 0.96) {
      const first = Math.round((total * 0.5) / 100) * 100;
      payAt(day + 3 + Math.floor(rng() * 8), first);
      payAt(day + 12 + Math.floor(rng() * (credit + 6)), total);
    } else payAt(day + credit + 6 + Math.floor(rng() * 18), total);
  }

  function processReturn(day: number, order: Row, item: Row, qty: number) {
    schedule(day, 750, (at) => {
      const v = biz.byId.get(item.variant_id as number)!;
      const resellable = rng() < 0.85;
      const ret = w.add("returns", { business_id: biz.id, code: null, order_id: order.id, customer_id: order.customer_id, received_at: at, received_by: biz.warehouse.id, note: resellable ? "Customer over-ordered; resellable" : "Damaged in transit" });
      const loc = resellable ? v.home : biz.quarantine;
      w.add("return_items", { return_id: ret.id, order_item_id: item.id, variant_id: v.row.id, qty, condition: resellable ? "resellable" : "damaged", location_id: loc.id, restocked_qty: qty });
      w.move(biz, v.row.id, loc.id, "customer_return", qty, at, { type: "return", id: ret.id }, biz.warehouse, resellable ? null : "Damaged in transit; held in quarantine");
      w.audit(biz, biz.warehouse, "return.received", "return", ret.id, at);
      w.invoice(biz, order, [{ item, qty }], new Date(at.getTime() + 20 * 60_000), biz.accounts, "credit_note");
      const balance = receivable(order);
      if (balance < 0) {
        const inv = w.rows("invoices").filter((x) => x.order_id === order.id && x.kind === "invoice").at(-1) ?? null;
        w.pay(biz, inv, order.customer_id as number, -balance, new Date(at.getTime() + 40 * 60_000), biz.accounts, "bank", "", "refund");
      }
      w.settle(order, at);
    });
  }

  function purchasing(day: number) {
    const at = clock.at(day, 18);
    const backorders = new Map<number, number>();
    for (const o of openOrders) {
      if (o.status === "cancelled" || o.status === "completed") continue;
      for (const i of w.items(o)) if (i.backordered) backorders.set(i.variant_id as number, (backorders.get(i.variant_id as number) ?? 0) + Math.max(openShort(i), 0));
    }
    for (const supplier of biz.suppliers.values()) {
      const vs = biz.variants.filter((v) => v.supplier.id === supplier.id && day >= (v.def.launchDay ?? -H));
      const lead = supplier.lead_time_days as number;
      const lines: { v: VariantInfo; qty: number; need: number }[] = [];
      for (const v of vs) {
        const lines28 = (orderedQty.get(v.row.id) ?? []).filter((o) => o.day > day - 28);
        const recent = lines28.reduce((a, o) => a + o.qty, 0);
        const rate = Math.max(recent / 28, expectedDailyUnits(biz, v, clock, day) * 0.8);
        const ahead = expectedDailyUnits(biz, v, clock, day + lead) / Math.max(expectedDailyUnits(biz, v, clock, day), 0.001);
        // Wholesale demand is lumpy: one retailer can take 20 at once, so keep the largest recent line on top.
        const biggest = lines28.reduce((a, o) => Math.max(a, o.qty), 0);
        const target = rate * Math.min(Math.max(ahead, 0.4), 2.5) * (lead + 7 + 6) + Math.min(biggest, rate * 10);
        const backorder = backorders.get(v.row.id) ?? 0;
        const position = freeQty(v) + (onOrder.get(v.row.id) ?? 0) - backorder;
        const need = target - position;
        if (need > 0.5 && rate > 0) lines.push({ v, qty: roundUp(need, pack(v)), need });
      }
      if (!lines.length) continue;
      let total = lines.reduce((a, l) => a + l.qty, 0);
      const moq = supplier.moq_units as number;
      lines.sort((a, b) => b.need - a.need);
      for (let k = 0; total < moq; k = (k + 1) % lines.length) {
        lines[k].qty += pack(lines[k].v);
        total += pack(lines[k].v);
      }
      const { po } = w.placePO(biz, supplier, lines, at, biz.owner);
      for (const l of lines) onOrder.set(l.v.row.id, (onOrder.get(l.v.row.id) ?? 0) + l.qty);
      const arrive = day + lead + Math.floor(rng() * 3) - 1;
      schedule(arrive, 540, (when) => {
        w.receivePO(biz, po, when, biz.warehouse);
        for (const l of lines) onOrder.set(l.v.row.id, (onOrder.get(l.v.row.id) ?? 0) - l.qty);
      });
    }
  }

  // ---- the day loop ----
  for (let day = -H; day <= -1; day++) {
    const c = clock.cal(day);
    const closed = c.weekday === biz.def.closedWeekday;
    const events: Planned[] = queue.filter((e) => e.day === day);
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].day === day) queue.splice(i, 1);

    events.push({ day, minute: 575, run: (at) => fillBackorders(at, day) });

    if (!closed) {
      // Pick everything reserved before today, then dispatch and invoice it.
      const ready = openOrders.filter((o) => o.status !== "cancelled" && w.items(o).some((i) => w.reservations(i, "active").some((r) => (r.created_at as Date).getTime() < clock.at(day, 0).getTime())));
      ready.forEach((order, k) => {
        const pm = 600 + Math.min(k * 9, 110) + Math.floor(rng() * 8);
        const dm = 900 + Math.min(k * 11, 140) + Math.floor(rng() * 9);
        events.push({ day, minute: pm, run: (at) => w.pick(biz, order, at, pick([biz.picker, biz.warehouse])) });
        events.push({
          day, minute: dm, run: (at) => {
            const sent = w.dispatch(biz, order, at, biz.warehouse);
            if (!sent) return;
            const { invoice, total } = w.invoice(biz, order, sent.lines, new Date(at.getTime() + 12 * 60_000), biz.accounts);
            schedulePayments(day, order, invoice, total);
            if (rng() < 0.03) {
              const line = pick(sent.lines);
              processReturn(day + 3 + Math.floor(rng() * 4), order, line.item, Math.min(line.qty, 1 + Math.floor(rng() * 3)));
            }
            w.settle(order, at);
          },
        });
      });

      if (!opts.gapDays?.includes(day)) {
        const weekdayFactor = [0.4, 1, 1.05, 1, 1, 1.1, 1.3][c.weekday];
        const festive = c.month === 10 || (c.month === 11 && c.date <= 5) ? 1.35 : 1;
        const n = poisson(rng, biz.def.ordersPerDay * weekdayFactor * festive);
        for (let k = 0; k < n; k++) {
          const minute = 645 + Math.floor(rng() * 495);
          events.push({ day, minute, run: () => newOrder(day, minute) });
        }
      }

      if (rng() < 0.18 && biz.locations.has("A-SR-S1-B01")) {
        events.push({
          day, minute: 1080, run: (at) => {
            const v = weighted(biz.variants.filter((x) => w.balance(biz, x.row.id, x.home.id).on_hand - w.balance(biz, x.row.id, x.home.id).reserved >= 8), (x) => x.sizeShare * x.def.weight, rng);
            if (!v) return;
            const rail = biz.locations.get(rng() < 0.5 ? "A-SR-S1-B01" : "A-SR-S1-B02")!;
            w.transfer(biz, v, v.home, rail, 2, at, biz.warehouse, new Date(at.getTime() + 15 * 60_000), "Display pieces for the showroom rail");
            schedule(day + 6 + Math.floor(rng() * 6), 1080, (back) => {
              const b = w.balance(biz, v.row.id, rail.id);
              const qty = Math.min(2, b.on_hand - b.reserved);
              if (qty > 0) w.transfer(biz, v, rail, v.home, qty, back, biz.warehouse, new Date(back.getTime() + 10 * 60_000), "Back from the showroom rail");
            });
          },
        });
      }

      if (rng() < 0.07) {
        events.push({
          day, minute: 1110, run: (at) => {
            const v = pick(biz.variants);
            const b = w.balance(biz, v.row.id, v.home.id);
            if (b.on_hand - b.reserved < 3) return;
            w.move(biz, v.row.id, v.home.id, "damage", -1, at, null, biz.warehouse, pick(["Stain found while folding", "Torn seam, written off", "Print defect, written off"]));
          },
        });
      }

      if (c.weekday === 2) events.push({ day, minute: 1085, run: () => purchasing(day) });
    }

    if (opts.extra) events.push(...opts.extra(day));
    events.sort((a, b) => a.minute - b.minute);
    for (const e of events) e.run(clock.at(day, Math.floor(e.minute / 60), e.minute % 60));
  }

  return { openOrders, onOrder, orderedQty, schedule, receivable };
}

export { DAY };
