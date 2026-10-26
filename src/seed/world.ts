// An in-memory copy of the database that the seed simulation writes into.
// Its operations mirror the app's own (reserve, pick, dispatch, invoice,
// receive, transfer) and keep the same invariants, so the generated history
// reconciles exactly: every balance equals the sum of its ledger rows.

import { COLOUR_CODES, SIZE_SETS, SIZE_SHARE, type BusinessDef, type ProductDef } from "./catalog.ts";

export type Value = string | number | boolean | null | Date | object;
export type Row = { id: number } & Record<string, Value>;

export const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function poisson(rng: () => number, lambda: number): number {
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

export function weighted<T>(items: T[], weight: (x: T) => number, rng: () => number): T {
  const ws = items.map(weight);
  let r = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Calendar helpers anchored on the start of today in India time. */
export class Clock {
  readonly todayStart: number;
  constructor(now: Date) {
    const local = new Date(now.getTime() + IST);
    this.todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - IST;
  }
  at(day: number, hh: number, mm = 0): Date {
    return new Date(this.todayStart + day * DAY + (hh * 60 + mm) * 60_000);
  }
  cal(day: number) {
    const x = new Date(this.todayStart + day * DAY + IST + 12 * 3_600_000);
    return { month: x.getUTCMonth() + 1, date: x.getUTCDate(), weekday: x.getUTCDay() };
  }
}

export interface VariantInfo {
  row: Row;
  def: ProductDef;
  product: Row;
  supplier: Row;
  colourShare: number;
  sizeShare: number;
  home: Row;
}

export interface Biz {
  def: BusinessDef;
  id: number;
  users: Row[];
  owner: Row;
  warehouse: Row;
  accounts: Row;
  picker: Row;
  suppliers: Map<string, Row>;
  customers: Row[];
  variants: VariantInfo[];
  bySku: Map<string, VariantInfo>;
  byId: Map<number, VariantInfo>;
  locations: Map<string, Row>;
  sellable: Row[];
  pack: Row;
  quarantine: Row;
}

export interface Balance {
  business_id: number;
  variant_id: number;
  location_id: number;
  on_hand: number;
  reserved: number;
  needs_verification: boolean;
  verification_note: string | null;
  updated_at: Date;
}

type Ref = { type: string; id: number } | null;

export class World {
  private ids: Record<string, number> = {};
  readonly tables: Record<string, Row[]> = {};
  readonly balances = new Map<string, Balance>();
  /** Codes are given out at the end, in time order; until then rows carry ids. */
  readonly refs = new Map<Row, Ref>();
  private index = new Map<string, Map<number, Row[]>>();

  add(table: string, row: Record<string, Value>): Row {
    const id = (this.ids[table] = (this.ids[table] ?? 0) + 1);
    const r = { id, ...row } as Row;
    (this.tables[table] ??= []).push(r);
    return r;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  /** Rows of a child table grouped by a parent key, maintained as rows are added through link(). */
  link(table: string, key: string, row: Record<string, Value>): Row {
    const r = this.add(table, row);
    const k = `${table}.${key}`;
    let m = this.index.get(k);
    if (!m) this.index.set(k, (m = new Map()));
    const parent = r[key] as number;
    m.set(parent, [...(m.get(parent) ?? []), r]);
    return r;
  }

  children(table: string, key: string, parentId: number): Row[] {
    return this.index.get(`${table}.${key}`)?.get(parentId) ?? [];
  }

  balance(biz: Biz, variantId: number, locationId: number): Balance {
    const k = `${variantId}:${locationId}`;
    let b = this.balances.get(k);
    if (!b) {
      b = { business_id: biz.id, variant_id: variantId, location_id: locationId, on_hand: 0, reserved: 0, needs_verification: false, verification_note: null, updated_at: new Date(0) };
      this.balances.set(k, b);
    }
    return b;
  }

  /** Free (available-to-promise) stock of a variant across sellable bins. */
  free(biz: Biz, variantId: number): number {
    let n = 0;
    for (const loc of biz.sellable) {
      const b = this.balances.get(`${variantId}:${loc.id}`);
      if (b) n += b.on_hand - b.reserved;
    }
    return n;
  }

  // ---- the ledger ----

  move(biz: Biz, variantId: number, locationId: number, type: string, qty: number, at: Date, ref: Ref, actor: Row | null, reason: string | null, process: string | null = null) {
    if (qty === 0) return null;
    const b = this.balance(biz, variantId, locationId);
    b.on_hand += qty;
    b.updated_at = at;
    if (b.on_hand < 0 || b.reserved > b.on_hand) throw new Error(`seed went inconsistent: variant ${variantId} at location ${locationId}: ${b.on_hand} on hand, ${b.reserved} reserved`);
    const m = this.add("stock_movements", {
      business_id: biz.id, variant_id: variantId, location_id: locationId, type, qty,
      ref_type: ref?.type ?? null, ref_id: ref?.id ?? null, ref_code: null,
      actor_user_id: actor?.id ?? null, actor_process: process ?? (actor ? null : "system"), reason, reverses_id: null, created_at: at,
    });
    this.refs.set(m, ref);
    return m;
  }

  audit(biz: Biz, actor: Row | null, action: string, entityType: string, entityId: number, at: Date, reason: string | null = null, data: object = {}) {
    const a = this.add("audit_events", {
      business_id: biz.id, actor_user_id: actor?.id ?? null, actor_process: actor ? null : "system", action, entity_type: entityType,
      entity_id: entityId, entity_code: null, reason, data, created_at: at,
    });
    this.refs.set(a, { type: entityType, id: entityId });
  }

  // ---- orders ----

  createOrder(biz: Biz, customer: Row, at: Date, lines: { v: VariantInfo; qty: number; text?: string }[], opts: { channel?: string; text?: string; extractedBy?: string; due?: Date | null; by?: Row; reserveAt?: Date } = {}) {
    const order = this.add("orders", {
      business_id: biz.id, code: null, customer_id: customer.id, channel: opts.channel ?? "message", source_text: opts.text ?? "",
      extracted_by: opts.extractedBy ?? "rules", status: "confirmed", due_at: opts.due ?? null, created_by: (opts.by ?? biz.accounts).id,
      created_at: at, cancelled_at: null, completed_at: null, note: null,
    });
    this.audit(biz, opts.by ?? biz.accounts, "order.confirmed", "order", order.id, opts.reserveAt ?? at);
    const items = lines.map((l) =>
      this.link("order_items", "order_id", {
        business_id: biz.id, order_id: order.id, variant_id: l.v.row.id, qty_ordered: l.qty, qty_cancelled: 0, backordered: false,
        unit_price: l.v.product.unit_price as number, source_text: l.text ?? null, match_note: l.text ? "Matched on product, colour and size" : null,
      }),
    );
    const shorts: Row[] = [];
    for (const item of items) {
      const got = this.reserve(biz, item, item.qty_ordered as number, opts.reserveAt ?? at);
      if (got < (item.qty_ordered as number)) shorts.push(item);
    }
    return { order, items, shorts };
  }

  /** Reserves up to qty from sellable bins, home bin first. Returns what was reserved. */
  reserve(biz: Biz, item: Row, qty: number, at: Date): number {
    const v = biz.byId.get(item.variant_id as number)!;
    const bins = [v.home, ...biz.sellable.filter((l) => l.id !== v.home.id)];
    let left = qty;
    for (const loc of bins) {
      if (left <= 0) break;
      const b = this.balances.get(`${v.row.id}:${loc.id}`);
      if (!b) continue;
      const take = Math.min(left, b.on_hand - b.reserved);
      if (take <= 0) continue;
      b.reserved += take;
      b.updated_at = at;
      this.link("reservations", "order_item_id", {
        business_id: biz.id, order_item_id: item.id, variant_id: v.row.id, location_id: loc.id, qty: take, status: "active",
        created_at: at, updated_at: at, note: null,
      });
      left -= take;
    }
    return qty - left;
  }

  reservations(item: Row, ...status: string[]) {
    return this.children("reservations", "order_item_id", item.id).filter((r) => status.includes(r.status as string));
  }

  release(biz: Biz, r: Row, at: Date, note: string) {
    const b = this.balance(biz, r.variant_id as number, r.location_id as number);
    b.reserved -= r.qty as number;
    b.updated_at = at;
    r.status = "released";
    r.updated_at = at;
    r.note = note;
  }

  items(order: Row) {
    return this.children("order_items", "order_id", order.id);
  }

  shipped(item: Row) {
    return this.children("shipment_items", "order_item_id", item.id).reduce((a, s) => a + (s.qty as number), 0);
  }

  invoiced(item: Row) {
    let n = 0;
    for (const ii of this.children("invoice_items", "order_item_id", item.id)) {
      const inv = this.rows("invoices")[(ii.invoice_id as number) - 1];
      n += inv.kind === "credit_note" ? -(ii.qty as number) : (ii.qty as number);
    }
    return n;
  }

  pick(biz: Biz, order: Row, at: Date, by: Row) {
    const toPick = this.items(order).flatMap((i) => this.reservations(i, "active"));
    if (!toPick.length) return null;
    const pl = this.add("pick_lists", { business_id: biz.id, code: null, order_id: order.id, status: "picked", created_at: new Date(at.getTime() - 20 * 60_000), picked_at: at, picked_by: by.id });
    for (const r of toPick) {
      this.add("pick_list_items", { pick_list_id: pl.id, reservation_id: r.id, variant_id: r.variant_id, location_id: r.location_id, qty_to_pick: r.qty, qty_picked: r.qty, picked_at: at });
      r.status = "picked";
      r.updated_at = at;
    }
    order.status = "packed";
    this.audit(biz, by, "pick_list.picked", "pick_list", pl.id, at);
    return pl;
  }

  /** Ships every picked reservation of the order, posting dispatch movements. */
  dispatch(biz: Biz, order: Row, at: Date, by: Row, opts: { customer?: Row; carrier?: string } = {}) {
    const picked = this.items(order).flatMap((i) => this.reservations(i, "picked").map((r) => ({ i, r })));
    if (!picked.length) return null;
    const shp = this.add("shipments", {
      business_id: biz.id, code: null, order_id: order.id, customer_id: (opts.customer ?? { id: order.customer_id }).id as number,
      carrier: opts.carrier ?? "Shree Transport", tracking: `ST${(order.id as number) * 7919 % 1_000_000}`, dispatched_at: at, created_by: by.id,
    });
    const byItem = new Map<number, number>();
    for (const { i, r } of picked) {
      const b = this.balance(biz, r.variant_id as number, r.location_id as number);
      b.reserved -= r.qty as number;
      this.move(biz, r.variant_id as number, r.location_id as number, "dispatch", -(r.qty as number), at, { type: "shipment", id: shp.id }, by, null);
      r.status = "consumed";
      r.updated_at = at;
      byItem.set(i.id, (byItem.get(i.id) ?? 0) + (r.qty as number));
    }
    const lines: { item: Row; qty: number }[] = [];
    for (const [itemId, qty] of byItem) {
      const item = this.rows("order_items")[itemId - 1];
      this.link("shipment_items", "order_item_id", { shipment_id: shp.id, order_item_id: itemId, variant_id: item.variant_id, qty });
      lines.push({ item, qty });
    }
    this.audit(biz, by, "shipment.dispatched", "shipment", shp.id, at);
    return { shipment: shp, lines };
  }

  invoice(biz: Biz, order: Row, lines: { item: Row; qty: number }[], at: Date, by: Row, kind: "invoice" | "credit_note" = "invoice") {
    const customer = biz.customers.find((c) => c.id === order.customer_id)!;
    const inv = this.add("invoices", {
      business_id: biz.id, code: null, kind, order_id: order.id, customer_id: order.customer_id, issued_at: at,
      due_at: new Date(at.getTime() + (customer.credit_days as number) * DAY), created_by: by.id, note: null,
    });
    let total = 0;
    const rows: Row[] = [];
    for (const l of lines) {
      rows.push(this.link("invoice_items", "order_item_id", { invoice_id: inv.id, order_item_id: l.item.id, variant_id: l.item.variant_id, qty: l.qty, unit_price: l.item.unit_price }));
      total += l.qty * (l.item.unit_price as number);
    }
    this.invoiceItems.set(inv.id, rows);
    this.audit(biz, by, kind === "invoice" ? "invoice.issued" : "credit_note.issued", "invoice", inv.id, at);
    return { invoice: inv, total };
  }

  pay(biz: Biz, invoice: Row | null, customerId: number, amount: number, at: Date, by: Row, method = "upi", reference = "", kind: "receipt" | "refund" = "receipt") {
    const p = this.link("payments", "invoice_id", {
      business_id: biz.id, code: null, kind, customer_id: customerId, invoice_id: invoice?.id ?? null, amount, method,
      reference: reference || `${method.toUpperCase()}${Math.floor(at.getTime() / 1000) % 100_000_000}`, received_at: at, created_by: by.id,
    });
    this.audit(biz, by, kind === "receipt" ? "payment.recorded" : "refund.recorded", "payment", p.id, at);
    return p;
  }

  /** An invoice's (or credit note's) value. */
  invoiceTotal(inv: Row) {
    return this.itemsOfInvoice(inv).reduce((a, ii) => a + (ii.qty as number) * (ii.unit_price as number), 0);
  }

  readonly invoiceItems = new Map<number, Row[]>();
  itemsOfInvoice(inv: Row) {
    return this.invoiceItems.get(inv.id) ?? [];
  }

  paidOn(inv: Row) {
    return this.children("payments", "invoice_id", inv.id).reduce((a, p) => a + (p.kind === "refund" ? -(p.amount as number) : (p.amount as number)), 0);
  }

  /** Recomputes an order's status from its records. */
  settle(order: Row, at: Date) {
    if (order.status === "cancelled") return;
    const items = this.items(order);
    const due = items.reduce((a, i) => a + (i.qty_ordered as number) - (i.qty_cancelled as number), 0);
    const shipped = items.reduce((a, i) => a + this.shipped(i), 0);
    const open = items.some((i) => this.reservations(i, "active").length) ? "confirmed" : items.some((i) => this.reservations(i, "picked").length) ? "packed" : null;
    if (open) {
      order.status = open;
      return;
    }
    if (shipped < due) {
      order.status = "confirmed";
      return;
    }
    const invoices = this.rows("invoices").filter((x) => x.order_id === order.id);
    const billed = invoices.reduce((a, x) => a + (x.kind === "credit_note" ? -1 : 1) * this.invoiceTotal(x), 0);
    const paid = invoices.reduce((a, x) => a + this.paidOn(x), 0);
    const invoicedAll = items.every((i) => this.invoiced(i) >= this.shipped(i));
    if (invoicedAll && paid >= billed) {
      order.status = "completed";
      order.completed_at ??= at;
    } else order.status = "dispatched";
  }

  // ---- purchasing and stock moves ----

  placePO(biz: Biz, supplier: Row, lines: { v: VariantInfo; qty: number }[], at: Date, by: Row) {
    const po = this.add("purchase_orders", {
      business_id: biz.id, code: null, supplier_id: supplier.id, status: "placed", recommendation_id: null, created_by: by.id, placed_at: at,
      expected_at: new Date(at.getTime() + (supplier.lead_time_days as number) * DAY),
    });
    const items = lines.map((l) => this.link("purchase_order_items", "purchase_order_id", { purchase_order_id: po.id, variant_id: l.v.row.id, qty: l.qty, unit_cost: l.v.product.unit_cost, qty_received: 0 }));
    this.audit(biz, by, "purchase_order.placed", "purchase_order", po.id, at);
    return { po, items };
  }

  receivePO(biz: Biz, po: Row, at: Date, by: Row) {
    const grn = this.add("receipts", { business_id: biz.id, code: null, purchase_order_id: po.id, supplier_id: po.supplier_id, received_at: at, received_by: by.id });
    for (const pi of this.children("purchase_order_items", "purchase_order_id", po.id)) {
      const v = biz.byId.get(pi.variant_id as number)!;
      const qty = (pi.qty as number) - (pi.qty_received as number);
      if (qty <= 0) continue;
      this.add("receipt_items", { receipt_id: grn.id, purchase_order_item_id: pi.id, variant_id: v.row.id, location_id: v.home.id, qty });
      this.move(biz, v.row.id, v.home.id, "receipt", qty, at, { type: "receipt", id: grn.id }, by, null);
      pi.qty_received = pi.qty;
    }
    po.status = "received";
    this.audit(biz, by, "receipt.posted", "receipt", grn.id, at);
    return grn;
  }

  /** A completed transfer: stock is booked out and in when the destination scans it in. */
  transfer(biz: Biz, v: VariantInfo, from: Row, to: Row, qty: number, sentAt: Date, by: Row, receivedAt: Date | null, note: string | null = null) {
    const t = this.add("transfers", {
      business_id: biz.id, code: null, from_location_id: from.id, to_location_id: to.id, status: receivedAt ? "received" : "sent",
      sent_at: sentAt, sent_by: by.id, received_at: receivedAt, received_by: receivedAt ? by.id : null, note,
    });
    this.add("transfer_items", { transfer_id: t.id, variant_id: v.row.id, qty_sent: qty, qty_received: receivedAt ? qty : null });
    this.audit(biz, by, "transfer.sent", "transfer", t.id, sentAt);
    if (receivedAt) {
      this.move(biz, v.row.id, from.id, "transfer_out", -qty, receivedAt, { type: "transfer", id: t.id }, by, null);
      this.move(biz, v.row.id, to.id, "transfer_in", qty, receivedAt, { type: "transfer", id: t.id }, by, null);
      this.audit(biz, by, "transfer.received", "transfer", t.id, receivedAt);
    }
    return t;
  }

  count(biz: Biz, lines: { v: VariantInfo; loc: Row; counted: number }[], at: Date, by: Row, scope: string, source = "handheld") {
    const c = this.add("physical_stock_counts", { business_id: biz.id, code: null, scope, source, counted_by: by.id, counted_at: at });
    for (const l of lines) {
      const recorded = this.balances.get(`${l.v.row.id}:${l.loc.id}`)?.on_hand ?? 0;
      this.add("stock_count_lines", { count_id: c.id, variant_id: l.v.row.id, location_id: l.loc.id, recorded_qty: recorded, counted_qty: l.counted });
    }
    this.audit(biz, by, "count.submitted", "count", c.id, at);
    return c;
  }
}

/** Builds the catalogue rows for one business: users, suppliers, customers, products, locations, variants. */
export function buildCatalogue(w: World, def: BusinessDef, now: Date, clock: Clock): Biz {
  const business = w.add("businesses", { slug: def.slug, name: def.name, kind: def.kind, city: def.city, tagline: def.tagline, created_at: clock.at(-def.historyDays - 1, 9) });
  const id = business.id;
  const users = def.users.map((u) => w.add("users", { business_id: id, name: u.name, email: u.email, role: u.role, title: u.title }));
  const suppliers = new Map(def.suppliers.map((s) => [s.code, w.add("suppliers", {
    business_id: id, code: s.code, name: s.name, city: s.city, lead_time_days: s.leadTimeDays, moq_units: s.moqUnits, pack_size: s.packSize, payment_terms: s.paymentTerms,
  })]));
  const customers = def.customers.map((c, i) => w.add("customers", {
    business_id: id, code: c.code, name: c.name, city: c.city, phone: `+91 98${String(10_000_000 + i * 7_654_321).slice(0, 8)}`, credit_days: c.creditDays,
  }));
  const locations = new Map<string, Row>();
  const addLoc = (code: string, kind: string, sellable: boolean, rack: string | null, shelf: string | null, bin: string | null) =>
    locations.set(code, w.add("locations", { business_id: id, code, warehouse: "A", rack, shelf, bin, kind, sellable }));
  addLoc("A-PACK", "packing", false, null, null, null);
  addLoc("A-RECV", "receiving", false, null, null, null);
  addLoc("A-QUAR", "quarantine", false, null, null, null);
  const variants: VariantInfo[] = [];
  for (const p of def.products) {
    const product = w.add("products", {
      business_id: id, code: p.code, name: p.name, design: p.design, category: p.category, brand: p.brand, keywords: p.keywords,
      supplier_id: suppliers.get(p.supplier)!.id, unit_cost: p.cost, unit_price: p.price, season: p.profile === "steady" ? null : p.profile,
      launched_at: clock.at(p.launchDay ?? -def.historyDays, 9),
    });
    const weights = p.colours.map((_, k) => [1, 0.75, 0.6, 0.45][k] ?? 0.4);
    const wsum = weights.reduce((a, b) => a + b, 0);
    p.colours.forEach((colour, ci) => {
      const shelf = p.shelf + ci;
      SIZE_SETS[p.sizes].forEach((size, si) => {
        const rackNo = p.rack.replace("-", "");
        const code = `A-${rackNo}-S${shelf}-B${11 + si}`;
        if (!locations.has(code)) addLoc(code, "bin", true, p.rack, String(shelf), String(11 + si));
        const home = locations.get(code)!;
        const sku = `${COLOUR_CODES[colour]}-${p.code}-${size}`;
        const row = w.add("product_variants", {
          business_id: id, product_id: product.id, sku, barcode: `89${String(id).padStart(2, "0")}${String(product.id).padStart(3, "0")}${ci}${si}${String(id * 7 + product.id).padStart(4, "0")}`.slice(0, 13),
          colour, size, home_location_id: home.id,
        });
        variants.push({ row, def: p, product, supplier: suppliers.get(p.supplier)!, colourShare: weights[ci] / wsum, sizeShare: SIZE_SHARE[size], home });
      });
    });
  }
  for (const x of def.extraLocations) addLoc(x.code, "bin", true, x.rack, x.shelf, x.bin);
  const role = (r: string, n = 0) => users.filter((u) => u.role === r)[n] ?? users[0];
  void now;
  return {
    def, id, users, owner: role("owner"), warehouse: role("warehouse"), accounts: role("accounts"), picker: role("warehouse", 1),
    suppliers, customers, variants, bySku: new Map(variants.map((v) => [v.row.sku as string, v])), byId: new Map(variants.map((v) => [v.row.id, v])),
    locations, sellable: [...locations.values()].filter((l) => l.sellable), pack: locations.get("A-PACK")!, quarantine: locations.get("A-QUAR")!,
  };
}
