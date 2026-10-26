// Deterministic simulation of six months of trading for the synthetic shop.
//
// Day by day it receives supplier deliveries, sells at the counter (Poisson
// demand with a size curve, weekdays and a Navratri/Diwali peak), takes a few
// WhatsApp orders (reserve -> fulfil next day), logs exchanges and damage, and
// reorders every Monday in the supplier's size-set packs. Every change is a
// stock_movements row, so on-hand and reserved always equal the ledger sums.

import { orderCode } from "../format.ts";
import { resolveDue } from "../parser/due.ts";
import { CUSTOMERS, PRODUCTS, SHOP, SUPPLIERS, type ProductDef, type Profile } from "./catalog.ts";

export const HISTORY_DAYS = 180;
const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
const SIZES = ["S", "M", "L", "XL", "XXL"] as const;
const SIZE_SHARE: Record<string, number> = { S: 0.12, M: 0.28, L: 0.3, XL: 0.2, XXL: 0.1, FREE: 1 };
const COLOUR_WEIGHTS = [1, 0.7, 0.55, 0.45];
const BASE_DAILY = 0.9;
const WEEKDAY = [1.35, 0.85, 0.9, 0.95, 1, 1.05, 1.2]; // Sun..Sat
const COLOUR_CODES: Record<string, string> = {
  black: "BLK", white: "WHT", maroon: "MRN", mustard: "MST", navy: "NVY", pink: "PNK", peach: "PCH",
  green: "GRN", rust: "RST", red: "RED", yellow: "YLW", magenta: "MAG", olive: "OLV", beige: "BGE",
  wine: "WIN", teal: "TEL", "sky blue": "SKY", grey: "GRY", lavender: "LAV", orange: "ORG", blue: "BLU",
};

export type MovementType = "receive" | "reserve" | "release" | "sale" | "adjust" | "exchange";
export type OrderStatus = "confirmed" | "fulfilled" | "cancelled";
export type LineStatus = "reserved" | "short" | "unmatched" | "fulfilled" | "released";

export interface SeedSupplier { id: number; name: string; city: string; leadTimeDays: number; packRatio: string }
export interface SeedProduct { id: number; code: string; name: string; category: string; keywords: string; supplierId: number; costPrice: number; sellPrice: number; season: string | null }
export interface SeedVariant { id: number; productId: number; sku: string; colour: string; size: string; location: string; onHand: number; reserved: number }
export interface SeedOrder {
  id: number; code: string; customerName: string; rawMessage: string; parser: "rules"; status: OrderStatus;
  dueLabel: string | null; dueDate: Date | null; createdAt: Date; closedAt: Date | null;
}
export interface SeedOrderLine {
  id: number; orderId: number; variantId: number | null; sourceText: string; qtyRequested: number;
  qtyReserved: number; qtyFulfilled: number; status: LineStatus; note: string | null;
}
export interface SeedMovement {
  id: number; variantId: number; type: MovementType; qty: number; onHandDelta: number; reservedDelta: number;
  orderId: number | null; ref: string | null; note: string | null; createdAt: Date;
}
export interface SeedData {
  suppliers: SeedSupplier[];
  products: SeedProduct[];
  variants: SeedVariant[];
  orders: SeedOrder[];
  orderLines: SeedOrderLine[];
  movements: SeedMovement[];
  meta: { key: string; value: string }[];
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

/** Navratri Oct 11-19 and Dussehra Oct 20, then the run-up to Diwali (Nov 8 in 2026). */
export function seasonMultiplier(profile: Profile, month: number, day: number): number {
  const md = month * 100 + day;
  const navratri = md >= 1011 && md <= 1020;
  const preNavratri = md >= 1001 && md <= 1010;
  const diwaliRun = md >= 1021 && md <= 1108;
  const monsoon = month === 7 || month === 8;
  switch (profile) {
    case "festive":
      return navratri ? 2 : diwaliRun ? 2.4 : preNavratri ? 1.3 : monsoon ? 0.8 : 1;
    case "navratri":
      return navratri ? 4 : preNavratri ? 1.8 : diwaliRun ? 0.6 : monsoon ? 0.8 : 1;
    case "chaniya":
      return navratri ? 12 : md >= 920 && md <= 1010 ? 4 : diwaliRun ? 0.15 : 0.6;
    case "diwali":
      return diwaliRun ? 3.5 : navratri ? 1.5 : 1;
    case "winter":
      return month === 11 || month === 12 || month <= 2 ? 1.5 : month === 10 ? 0.6 : 0.08;
    default:
      return navratri ? 1.5 : diwaliRun ? 1.4 : preNavratri ? 1.15 : monsoon ? 0.85 : 1;
  }
}

const CATEGORY_WORDS: Record<string, string[]> = {
  kurti: ["kurti"], kurta_set: ["kurta set"], palazzo: ["palazzo", "plazo"], legging: ["legging", "leggings"],
  top: ["top"], tshirt: ["tshirt", "t-shirt"], night_suit: ["night suit"], dupatta: ["dupatta"], saree: ["saree"],
  lehenga: ["chaniya choli"], gown: ["gown"], shrug: ["shrug"], jacket: ["jacket"], coord_set: ["co-ord set"],
};
const GREETINGS = ["Bhaiya", "Hi di", "Hello", "Namaste ji", "Didi", "Hi", "Bhai", ""];
const CLOSERS: [string | null, string][] = [
  [null, ""], ["tomorrow", ", kal tak bhej dena"], ["saturday", ", Saturday tak"], ["sunday", ", Sunday ko chahiye"],
  [null, " pls"], [null, ", jaldi chahiye"], ["day-after", ", parso tak"],
];

interface SimVariant {
  row: SeedVariant;
  def: ProductDef;
  colourShare: number;
  sizeShare: number;
  leadTime: number;
}

export function generateSeed(now: Date = new Date(), seed = 20261026): SeedData {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];

  const todayLocal = new Date(now.getTime() + IST);
  const todayStart = Date.UTC(todayLocal.getUTCFullYear(), todayLocal.getUTCMonth(), todayLocal.getUTCDate()) - IST;
  const at = (d: number, hh: number, mm: number) => new Date(todayStart + d * DAY + (hh * 60 + mm) * 60_000);
  const calendar = new Map<number, { month: number; day: number; weekday: number }>();
  const cal = (d: number) => {
    let c = calendar.get(d);
    if (!c) {
      const x = new Date(todayStart + d * DAY + IST + 12 * 3_600_000);
      c = { month: x.getUTCMonth() + 1, day: x.getUTCDate(), weekday: x.getUTCDay() };
      calendar.set(d, c);
    }
    return c;
  };

  // ---- catalogue rows ----
  const suppliers: SeedSupplier[] = SUPPLIERS.map((s) => ({ ...s }));
  const products: SeedProduct[] = [];
  const variants: SeedVariant[] = [];
  const sim: SimVariant[] = [];
  const binCount = new Map<string, number>();
  PRODUCTS.forEach((def, pi) => {
    const productId = pi + 1;
    products.push({ id: productId, code: def.code, name: def.name, category: def.category, keywords: def.keywords, supplierId: def.supplierId, costPrice: def.cost, sellPrice: def.price, season: def.season ?? null });
    const weights = def.colours.map((_, k) => COLOUR_WEIGHTS[k] ?? 0.4);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const leadTime = SUPPLIERS.find((s) => s.id === def.supplierId)!.leadTimeDays;
    def.colours.forEach((colour, ci) => {
      // One bin per product colour: shelves A-D, bins 1-4.
      const n = binCount.get(def.rack) ?? 0;
      binCount.set(def.rack, n + 1);
      const location = `${def.rack}-${"ABCD"[Math.floor(n / 4) % 4]}${(n % 4) + 1}`;
      const sizes = def.free ? ["FREE"] : [...SIZES];
      for (const size of sizes) {
        const row: SeedVariant = {
          id: variants.length + 1,
          productId,
          sku: `${def.code}-${COLOUR_CODES[colour]}-${size === "FREE" ? "FS" : size}`,
          colour,
          size,
          location,
          onHand: 0,
          reserved: 0,
        };
        variants.push(row);
        sim.push({ row, def, colourShare: weights[ci] / wsum, sizeShare: SIZE_SHARE[size], leadTime });
      }
    });
  });

  const demand = (v: SimVariant, d: number) => {
    if (v.def.dead) {
      const { introDay, activeUntilDay, dailyDemand } = v.def.dead;
      return d >= introDay && d <= activeUntilDay ? dailyDemand * v.colourShare * v.sizeShare * 5 : 0;
    }
    const c = cal(d);
    return BASE_DAILY * v.def.popularity * v.colourShare * v.sizeShare * seasonMultiplier(v.def.profile, c.month, c.day) * WEEKDAY[c.weekday];
  };

  // ---- ledger ----
  const movements: SeedMovement[] = [];
  const orders: SeedOrder[] = [];
  const orderLines: SeedOrderLine[] = [];
  const onOrder = new Map<number, number>();
  const move = (v: SimVariant, type: MovementType, qty: number, onHandDelta: number, reservedDelta: number, when: Date, extra: { orderId?: number; ref?: string; note?: string } = {}) => {
    v.row.onHand += onHandDelta;
    v.row.reserved += reservedDelta;
    if (v.row.onHand < 0 || v.row.reserved < 0 || v.row.reserved > v.row.onHand) {
      throw new Error(`stock went inconsistent on ${v.row.sku}: on hand ${v.row.onHand}, reserved ${v.row.reserved}`);
    }
    movements.push({ id: movements.length + 1, variantId: v.row.id, type, qty, onHandDelta, reservedDelta, orderId: extra.orderId ?? null, ref: extra.ref ?? null, note: extra.note ?? null, createdAt: when });
  };
  const available = (v: SimVariant) => v.row.onHand - v.row.reserved;

  // ---- opening stock ----
  const first = -HISTORY_DAYS;
  for (const v of sim) {
    if (v.def.dead) continue;
    const qty = Math.ceil(demand(v, first) * 35) + 1;
    move(v, "receive", qty, qty, 0, at(first, 9, 0), { ref: "Opening stock", note: "Opening count when RackPilot was set up" });
  }

  type Arrival = { day: number; v: SimVariant; qty: number; ref: string };
  const arrivals: Arrival[] = [];
  let poNumber = 2601;
  for (const def of PRODUCTS) {
    if (!def.dead) continue;
    const ref = `PO-${poNumber++}`;
    for (const v of sim.filter((s) => s.def === def)) {
      const qty = v.row.size === "S" || v.row.size === "XXL" ? 1 : 2;
      arrivals.push({ day: def.dead.introDay, v, qty, ref });
    }
  }

  type PendingExchange = { day: number; from: SimVariant; to: SimVariant };
  const exchanges: PendingExchange[] = [];
  type OpenOrder = { order: SeedOrder; lines: { line: SeedOrderLine; v: SimVariant }[]; cancel: boolean };
  const toClose: { day: number; o: OpenOrder }[] = [];
  let exchangeNo = 1;

  const groups = new Map<string, SimVariant[]>();
  for (const v of sim) {
    const key = `${v.def.code}|${v.row.colour}`;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const sellable = sim.filter((v) => !v.def.dead);

  const createOrder = (when: Date, customer: string, picks: { v: SimVariant; qty: number }[], message?: string, closer?: [string | null, string]) => {
    const id = orders.length + 1;
    const code = orderCode(id);
    const [dueLabel, closerText] = closer ?? pick(CLOSERS);
    const phrases = describe(picks.map((p) => ({ def: p.v.def, colour: p.v.row.colour, size: p.v.row.size, qty: p.qty })), rng);
    const text = message ?? `${pick(GREETINGS)} ${phrases.join(rng() < 0.5 ? ", " : " aur ")}${closerText}`.trim();
    const order: SeedOrder = { id, code, customerName: customer, rawMessage: text, parser: "rules", status: "confirmed", dueLabel, dueDate: resolveDue(dueLabel, when), createdAt: when, closedAt: null };
    orders.push(order);
    const lines = picks.map((p, k) => {
      const take = Math.min(p.qty, Math.max(available(p.v), 0));
      if (take > 0) move(p.v, "reserve", take, 0, take, when, { orderId: id, ref: code, note: `Reserved for ${customer}` });
      const line: SeedOrderLine = {
        id: orderLines.length + 1, orderId: id, variantId: p.v.row.id, sourceText: phrases[k] ?? "", qtyRequested: p.qty,
        qtyReserved: take, qtyFulfilled: 0, status: take === p.qty ? "reserved" : "short",
        note: take < p.qty ? `Short by ${p.qty - take} when the order came in` : null,
      };
      orderLines.push(line);
      return { line, v: p.v };
    });
    return { order, lines };
  };

  // ---- day loop ----
  for (let d = first; d <= -1; d++) {
    type Ev = { t: number; run: () => void };
    const events: Ev[] = [];

    for (const a of arrivals.filter((x) => x.day === d)) {
      events.push({ t: 9 * 60 + 30, run: () => {
        move(a.v, "receive", a.qty, a.qty, 0, at(d, 9, 30), { ref: a.ref, note: "Supplier delivery" });
        onOrder.set(a.v.row.id, Math.max(0, (onOrder.get(a.v.row.id) ?? 0) - a.qty));
      } });
    }

    for (const c of toClose.filter((x) => x.day === d)) {
      events.push({ t: 10 * 60 + 15, run: () => {
        const when = at(d, 10, 15);
        for (const { line, v } of c.o.lines) {
          if (line.qtyReserved <= 0) continue;
          if (c.o.cancel) {
            move(v, "release", line.qtyReserved, 0, -line.qtyReserved, when, { orderId: c.o.order.id, ref: c.o.order.code, note: "Customer cancelled" });
            line.status = "released";
          } else {
            move(v, "sale", line.qtyReserved, -line.qtyReserved, -line.qtyReserved, when, { orderId: c.o.order.id, ref: c.o.order.code, note: "WhatsApp order picked and handed over" });
            line.qtyFulfilled = line.qtyReserved;
            line.status = "fulfilled";
          }
        }
        c.o.order.status = c.o.cancel ? "cancelled" : "fulfilled";
        c.o.order.closedAt = when;
      } });
    }

    for (const v of sim) {
      const q = poisson(rng, demand(v, d));
      if (q === 0) continue;
      const parts = q > 2 ? [Math.ceil(q / 2), Math.floor(q / 2)] : [q];
      for (const part of parts) {
        const minute = 10 * 60 + 30 + Math.floor(rng() * (10 * 60 + 15));
        events.push({ t: minute, run: () => {
          const take = Math.min(part, available(v));
          if (take <= 0) return;
          move(v, "sale", take, -take, 0, at(d, Math.floor(minute / 60), minute % 60), { ref: "Counter sale" });
          if (v.row.size !== "FREE" && rng() < 0.012 && d < -2) {
            const sizes = groups.get(`${v.def.code}|${v.row.colour}`)!;
            const idx = sizes.indexOf(v);
            const to = sizes[idx + (rng() < 0.5 && idx > 0 ? -1 : 1)] ?? sizes[idx - 1];
            if (to) exchanges.push({ day: d + 1 + Math.floor(rng() * 3), from: v, to });
          }
        } });
      }
    }

    for (const ex of exchanges.filter((x) => x.day === d && x.day <= -1)) {
      events.push({ t: 17 * 60, run: () => {
        if (available(ex.to) < 1) return;
        const ref = `EXC-${exchangeNo++}`;
        move(ex.from, "exchange", 1, 1, 0, at(d, 17, 0), { ref, note: `Returned in exchange for ${ex.to.row.sku}` });
        move(ex.to, "exchange", 1, -1, 0, at(d, 17, 1), { ref, note: `Given in exchange for ${ex.from.row.sku}` });
      } });
    }

    if (d < -2 && rng() < 0.17) {
      const minute = 11 * 60 + Math.floor(rng() * 8 * 60);
      events.push({ t: minute, run: () => {
        const anchor = weightedPick(sellable, (v) => demand(v, d) + 0.001, rng);
        const sizes = groups.get(`${anchor.def.code}|${anchor.row.colour}`)!;
        const n = 1 + Math.floor(rng() * 3);
        const chosen = new Set<SimVariant>([anchor]);
        while (chosen.size < Math.min(n, sizes.length)) chosen.add(weightedPick(sizes, (v) => v.sizeShare, rng));
        const picks = [...chosen].map((v) => ({ v, qty: rng() < 0.55 ? 1 : rng() < 0.7 ? 2 : 3 }));
        const o = createOrder(at(d, Math.floor(minute / 60), minute % 60), pick(CUSTOMERS), picks);
        toClose.push({ day: d + 1, o: { ...o, cancel: rng() < 0.06 } });
      } });
    }

    if (rng() < 0.12) {
      events.push({ t: 19 * 60 + 40, run: () => {
        const v = pick(sellable);
        if (available(v) < 1) return;
        move(v, "adjust", 1, -1, 0, at(d, 19, 40), { ref: "Damage", note: "Damaged in store, written off" });
      } });
    }

    events.sort((a, b) => a.t - b.t);
    for (const e of events) e.run();

    // Monday review: reorder in the supplier's size-set packs.
    if (cal(d).weekday === 1) {
      for (const [, vs] of groups) {
        const def = vs[0].def;
        if (def.dead) continue;
        const supplier = SUPPLIERS.find((s) => s.id === def.supplierId)!;
        const lead = supplier.leadTimeDays;
        const forecast = (v: SimVariant, days: number) => {
          let f = 0;
          for (let k = 1; k <= days; k++) f += demand(v, d + k);
          return f;
        };
        // Periodic review: stock must last until the next Monday's order lands.
        const position = (v: SimVariant) => available(v) + (onOrder.get(v.row.id) ?? 0);
        const needs = vs.some((v) => position(v) < forecast(v, lead + 7) * 1.4 + 1);
        if (!needs) continue;
        const ref = `PO-${poNumber++}`;
        if (def.free) {
          for (const v of vs) {
            const deficit = forecast(v, lead + 21) * 1.3 + 1 - position(v);
            if (deficit <= 0) continue;
            const qty = Math.ceil(deficit / 4) * 4;
            arrivals.push({ day: d + lead, v, qty, ref });
            onOrder.set(v.row.id, (onOrder.get(v.row.id) ?? 0) + qty);
          }
          continue;
        }
        const ratio = Object.fromEntries(supplier.packRatio.split(":").map((p) => [p.replace(/\d+$/, ""), Number(p.match(/\d+$/)![0])]));
        let packs = 0;
        for (const v of vs) {
          const deficit = forecast(v, lead + 21) * 1.3 + 1 - position(v);
          if (deficit > 0) packs = Math.max(packs, Math.ceil(deficit / (ratio[v.row.size] ?? 1)));
        }
        packs = Math.min(Math.max(packs, 1), 8);
        for (const v of vs) {
          const qty = packs * (ratio[v.row.size] ?? 1);
          arrivals.push({ day: d + lead, v, qty, ref });
          onOrder.set(v.row.id, (onOrder.get(v.row.id) ?? 0) + qty);
        }
      }
    }
  }

  // ---- final evening: stock count that sets up the demo, then three open orders ----
  const bySku = (sku: string) => sim.find((v) => v.row.sku === sku)!;
  const soldLast30 = (v: SimVariant) =>
    movements.filter((m) => m.variantId === v.row.id && m.type === "sale" && m.createdAt.getTime() >= at(-30, 0, 0).getTime()).reduce((a, m) => a - m.onHandDelta, 0);
  const setCount = (sku: string, target: number) => {
    const v = bySku(sku);
    const delta = target - v.row.onHand;
    if (delta === 0) return;
    move(v, "adjust", Math.abs(delta), delta, 0, at(-1, 20, 30), { ref: "Stock count", note: delta > 0 ? "Found in back store during evening count" : "Missing in evening count" });
  };
  const blackM = bySku("K101-BLK-M");
  const rateM = Math.max(soldLast30(blackM), 6) / 30;
  // Enough cover before the demo order (>= 7 days lead time), not after it reserves 3.
  setCount("K101-BLK-M", Math.floor(7 * rateM + 2.5));
  const blackL = bySku("K101-BLK-L");
  setCount("K101-BLK-L", Math.max(blackL.row.onHand, Math.ceil((7 * Math.max(soldLast30(blackL), 3)) / 30 + 4)));
  setCount("K101-MRN-XL", 1);
  for (const [sku, min] of [["K101-MST-L", 2], ["L401-BLK-M", 3], ["L401-WHT-L", 2], ["SR903-RED-FS", 2], ["SR903-MRN-FS", 2]] as const) {
    if (bySku(sku).row.onHand < min) setCount(sku, min);
  }

  createOrder(at(-1, 20, 45), "Priya S.", [{ v: bySku("K101-MRN-XL"), qty: 1 }, { v: bySku("K101-MST-L"), qty: 1 }], "Hi di, maroon kurti XL 1 aur mustard L 1, Friday tak chahiye 🙏", ["friday", ""]);
  createOrder(at(-1, 21, 5), "Neha K.", [{ v: bySku("L401-BLK-M"), qty: 2 }, { v: bySku("L401-WHT-L"), qty: 1 }], "Bhaiya 2 churidar legging black M, 1 white L. Kal tak bhej dena", ["tomorrow", ""]);
  createOrder(at(-1, 21, 20), "Kavita R.", [{ v: bySku("SR903-RED-FS"), qty: 1 }, { v: bySku("SR903-MRN-FS"), qty: 1 }], "Silk saree red 1, maroon 1 — Diwali se pehle chahiye", ["diwali", ""]);
  // Source text for the hand-written messages.
  const tail = orderLines.slice(-6);
  ["maroon kurti XL 1", "mustard L 1", "2 churidar legging black M", "1 white L", "Silk saree red 1", "maroon 1"].forEach((t, k) => (tail[k].sourceText = t));

  const meta = [
    { key: "shop_name", value: SHOP.name },
    { key: "shop_city", value: SHOP.city },
    { key: "seeded_at", value: now.toISOString() },
    { key: "history_days", value: String(HISTORY_DAYS) },
  ];
  return { suppliers, products, variants, orders, orderLines, movements, meta };
}

function weightedPick<T>(items: T[], weight: (x: T) => number, rng: () => number): T {
  const ws = items.map(weight);
  let r = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function describe(lines: { def: ProductDef; colour: string; size: string; qty: number }[], rng: () => number): string[] {
  let prev: { code: string; colour: string } | null = null;
  return lines.map((l) => {
    const word = CATEGORY_WORDS[l.def.category]?.[0] ?? l.def.category;
    const size = l.size === "FREE" ? "" : ` ${l.size}`;
    let text: string;
    if (prev && prev.code === l.def.code && prev.colour === l.colour) text = `${l.qty}${size}`;
    else if (prev && prev.code === l.def.code) text = `${l.qty} ${l.colour}${size}`;
    else text = rng() < 0.5 ? `${l.qty} ${l.colour} ${word}${size}` : `${word} ${l.colour}${size} ${l.qty}`;
    prev = { code: l.def.code, colour: l.colour };
    return text.trim();
  });
}
