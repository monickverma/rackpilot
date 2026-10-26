// OrderTrace: reconciles each order with its allocations, invoices, payments
// and dispatches using explicit rules and arithmetic. A difference only
// becomes a finding after the valid exceptions are checked: backorders, split
// shipments and invoices, cancellations, returns and credit notes.

import { q } from "../../db/client.ts";
import { DAY, plural, rupees, units } from "../format.ts";
import { orderRecords, type OrderRecords } from "../records.ts";
import type { Draft, EvidenceRef } from "./types.ts";

const INVOICE_GRACE = 2 * 3_600_000;
const OVERDUE_DAYS = 30;
const IST = 5.5 * 3_600_000;

interface ItemAgg {
  itemId: number; orderId: number; code: string; status: string; customerId: number; completedAt: Date | null; cancelledAt: Date | null;
  sku: string; qtyOrdered: number; qtyCancelled: number; backordered: boolean; unitPrice: number;
  active: number; picked: number; shipped: number; lastShippedAt: Date | null; invoiced: number; credited: number; lastInvoicedAt: Date | null; returned: number;
}

interface PayAgg { orderId: number; code: string; status: string; billed: number; credited: number; received: number; refunded: number; lastPaidAt: Date | null; oldestDue: Date | null; firstIssued: Date | null }

/** Every order event as a timeline entry, the evidence the findings cite. */
export function orderTimeline(rec: OrderRecords): EvidenceRef[] {
  const o = rec.order;
  const out: EvidenceRef[] = [];
  const total = rec.items.reduce((a, i) => a + i.qtyOrdered, 0);
  const what = rec.items.length === 1 ? `${units(rec.items[0].qtyOrdered)} of ${rec.items[0].sku}` : `${units(total)} across ${plural(rec.items.length, "line")}`;
  out.push({ type: "order", id: o.id, code: o.code, label: "Order created", detail: `${what} requested by ${o.customerName}.`, at: o.createdAt, values: { requested: total } });
  const byMinute = new Map<string, OrderRecords["reservations"]>();
  for (const r of rec.reservations) {
    const k = `${r.createdAt.getTime()}|${r.location}`;
    byMinute.set(k, [...(byMinute.get(k) ?? []), r]);
  }
  for (const rs of byMinute.values()) {
    const qty = rs.reduce((a, r) => a + r.qty, 0);
    const skus = [...new Set(rs.map((r) => r.sku))].join(", ");
    out.push({ type: "reservation", id: rs[0].id, code: `RES-${rs[0].id}`, label: "Stock allocated", detail: `${units(qty)} of ${skus} reserved at ${rs[0].location}.`, at: rs[0].createdAt, values: { reserved: qty, location: rs[0].location } });
  }
  for (const p of rec.picks) {
    const picked = p.lines.reduce((a, l) => a + (l.qtyPicked ?? 0), 0);
    const at = p.pickedAt ?? p.lines.find((l) => l.pickedAt)?.pickedAt ?? p.createdAt;
    const unpicked = p.lines.filter((l) => l.qtyPicked === null).reduce((a, l) => a + l.qtyToPick, 0);
    out.push({
      type: "pick_list", id: p.id, code: p.code, label: picked ? "Order picked" : "Pick list created",
      detail: `${p.code} records ${units(picked)} picked${unpicked ? `; ${units(unpicked)} still to pick` : ""}${p.pickedBy ? ` by ${p.pickedBy}` : ""}.`, at, values: { picked },
    });
  }
  for (const i of rec.invoices) {
    const qty = i.lines.reduce((a, l) => a + l.qty, 0);
    out.push({
      type: "invoice", id: i.id, code: i.code, label: i.kind === "invoice" ? "Invoice recorded" : "Credit note recorded",
      detail: `${i.code} lists ${units(qty)} (${rupees(i.total)})${i.customerId !== o.customerId ? `, billed to ${i.customerName}` : ""}.`, at: i.issuedAt, values: { qty, amount: i.total },
    });
  }
  for (const s of rec.shipments) {
    const qty = s.lines.reduce((a, l) => a + l.qty, 0);
    out.push({ type: "shipment", id: s.id, code: s.code, label: "Dispatch recorded", detail: `${s.code} lists ${units(qty)} shipped to ${s.customerName} via ${s.carrier}.`, at: s.dispatchedAt, values: { qty, customer: s.customerName } });
  }
  for (const p of rec.payments) {
    out.push({
      type: "payment", id: p.id, code: p.code, label: p.kind === "receipt" ? "Payment received" : "Refund paid",
      detail: `${rupees(p.amount)} by ${p.method.toUpperCase()} (ref ${p.reference})${p.invoiceCode ? ` against ${p.invoiceCode}` : ""}.`, at: p.receivedAt, values: { amount: p.amount },
    });
  }
  for (const r of rec.returns) {
    const qty = r.lines.reduce((a, l) => a + l.qty, 0);
    out.push({ type: "return", id: r.id, code: r.code, label: "Return received", detail: `${r.code}: ${units(qty)} back (${r.lines.map((l) => l.condition).join(", ")}).`, at: r.receivedAt, values: { qty } });
  }
  for (const a of rec.audit) {
    if (a.action === "order.completed") out.push({ type: "order", id: o.id, code: o.code, label: "Marked completed", detail: `Status set to completed${a.actor ? ` by ${a.actor}` : ""}${a.reason ? ` (${a.reason})` : ""}.`, at: a.at });
    if (a.action === "order.cancelled") out.push({ type: "order", id: o.id, code: o.code, label: "Order cancelled", detail: `Cancelled${a.actor ? ` by ${a.actor}` : ""}${a.reason ? `: ${a.reason}` : ""}.`, at: a.at });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const pickEvidence = (tl: EvidenceRef[], ...types: string[]) => tl.filter((e) => types.includes(e.type));

export async function orderTraceDrafts(businessId: number, now: Date): Promise<Draft[]> {
  const items = await q<ItemAgg>(
    `WITH res AS (
       SELECT order_item_id, SUM(qty) FILTER (WHERE status = 'active')::int AS active, SUM(qty) FILTER (WHERE status = 'picked')::int AS picked
         FROM reservations WHERE business_id = $1 GROUP BY order_item_id),
     shp AS (
       SELECT si.order_item_id, SUM(si.qty)::int AS shipped, MAX(s.dispatched_at) AS last_at
         FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id WHERE s.business_id = $1 GROUP BY si.order_item_id),
     inv AS (
       SELECT ii.order_item_id, SUM(ii.qty) FILTER (WHERE i.kind = 'invoice')::int AS invoiced, SUM(ii.qty) FILTER (WHERE i.kind = 'credit_note')::int AS credited,
              MAX(i.issued_at) AS last_at
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.business_id = $1 AND ii.order_item_id IS NOT NULL GROUP BY ii.order_item_id),
     ret AS (
       SELECT ri.order_item_id, SUM(ri.qty)::int AS returned FROM return_items ri JOIN returns r ON r.id = ri.return_id
        WHERE r.business_id = $1 AND ri.order_item_id IS NOT NULL GROUP BY ri.order_item_id)
     SELECT oi.id AS "itemId", o.id AS "orderId", o.code, o.status, o.customer_id AS "customerId", o.completed_at AS "completedAt", o.cancelled_at AS "cancelledAt",
            v.sku, oi.qty_ordered AS "qtyOrdered", oi.qty_cancelled AS "qtyCancelled", oi.backordered, oi.unit_price AS "unitPrice",
            COALESCE(res.active, 0) AS active, COALESCE(res.picked, 0) AS picked, COALESCE(shp.shipped, 0) AS shipped, shp.last_at AS "lastShippedAt",
            COALESCE(inv.invoiced, 0) AS invoiced, COALESCE(inv.credited, 0) AS credited, inv.last_at AS "lastInvoicedAt", COALESCE(ret.returned, 0) AS returned
       FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN product_variants v ON v.id = oi.variant_id
       LEFT JOIN res ON res.order_item_id = oi.id LEFT JOIN shp ON shp.order_item_id = oi.id
       LEFT JOIN inv ON inv.order_item_id = oi.id LEFT JOIN ret ON ret.order_item_id = oi.id
      WHERE oi.business_id = $1`,
    businessId,
  );
  const pays = await q<PayAgg>(
    `WITH b AS (
       SELECT i.order_id, SUM(ii.qty * ii.unit_price) FILTER (WHERE i.kind = 'invoice')::int AS billed,
              SUM(ii.qty * ii.unit_price) FILTER (WHERE i.kind = 'credit_note')::int AS credited,
              MIN(i.due_at) FILTER (WHERE i.kind = 'invoice') AS oldest_due, MIN(i.issued_at) AS first_issued
         FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.business_id = $1 GROUP BY i.order_id),
     p AS (
       SELECT i.order_id, SUM(p.amount) FILTER (WHERE p.kind = 'receipt')::int AS received, SUM(p.amount) FILTER (WHERE p.kind = 'refund')::int AS refunded,
              MAX(p.received_at) AS last_paid
         FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.business_id = $1 GROUP BY i.order_id)
     SELECT o.id AS "orderId", o.code, o.status, COALESCE(b.billed, 0) AS billed, COALESCE(b.credited, 0) AS credited, COALESCE(p.received, 0) AS received,
            COALESCE(p.refunded, 0) AS refunded, p.last_paid AS "lastPaidAt", b.oldest_due AS "oldestDue", b.first_issued AS "firstIssued"
       FROM orders o JOIN b ON b.order_id = o.id LEFT JOIN p ON p.order_id = o.id WHERE o.business_id = $1`,
    businessId,
  );

  type Hit = { orderId: number; build: (rec: OrderRecords, tl: EvidenceRef[]) => Draft[] };
  const hits: Hit[] = [];
  const byOrder = new Map<number, ItemAgg[]>();
  for (const i of items) byOrder.set(i.orderId, [...(byOrder.get(i.orderId) ?? []), i]);
  const payByOrder = new Map(pays.map((p) => [p.orderId, p]));

  for (const [orderId, list] of byOrder) {
    const first = list[0];
    const unbilled = list.filter((i) => i.shipped - i.returned > i.invoiced - i.credited && i.lastShippedAt && now.getTime() - i.lastShippedAt.getTime() > INVOICE_GRACE);
    const overbilled = list.filter((i) => i.invoiced - i.credited > i.shipped - i.returned);
    if (unbilled.length || overbilled.length) hits.push({ orderId, build: (rec, tl) => invoiceFindings(rec, tl, unbilled, overbilled) });

    const overShipped = list.filter((i) => i.shipped > i.qtyOrdered - i.qtyCancelled);
    if (overShipped.length) {
      hits.push({
        orderId, build: (rec, tl) => overShipped.map((i) => ({
          ...base(rec, "OT-SHP", `over:${i.itemId}:${i.shipped}:${i.qtyOrdered - i.qtyCancelled}`, i.lastShippedAt ?? now),
          kind: "fact", certainty: "verified", priority: "high", rank: 10,
          title: `${units(i.shipped - (i.qtyOrdered - i.qtyCancelled))} of ${i.sku} shipped beyond the order`,
          detail: `${rec.order.code} allows ${units(i.qtyOrdered - i.qtyCancelled)} of ${i.sku} after cancellations, but shipments record ${units(i.shipped)}.`,
          expected: i.qtyOrdered - i.qtyCancelled, actual: i.shipped, unit: "units",
          calculation: `${i.shipped} shipped − (${i.qtyOrdered} ordered − ${i.qtyCancelled} cancelled) = ${i.shipped - i.qtyOrdered + i.qtyCancelled}`,
          exceptions: ["Checked for a later order change that raised the quantity: none recorded"],
          evidence: pickEvidence(tl, "order", "shipment"),
          checks: ["Confirm with the customer how many they received", "Check the packing slip for each shipment"],
        })),
      });
    }

    const leftBehind = ["dispatched", "completed"].includes(first.status) ? list.filter((i) => i.picked > 0 || i.active > 0) : [];
    if (leftBehind.length) {
      hits.push({
        orderId, build: (rec, tl) => leftBehind.map((i) => ({
          ...base(rec, "OT-ALLOC", `left:${i.itemId}:${i.picked}:${i.active}`, rec.order.completedAt ?? i.lastShippedAt ?? now),
          kind: "fact", certainty: "verified", priority: "medium", rank: 20,
          title: `${units(i.picked + i.active)} of ${i.sku} still allocated after dispatch`,
          detail: `${rec.order.code} is ${first.status}, but ${units(i.picked)} picked and ${units(i.active)} reserved for ${i.sku} were never shipped or released.`,
          expected: 0, actual: i.picked + i.active, unit: "units",
          evidence: pickEvidence(tl, "reservation", "pick_list", "shipment"),
          checks: ["Look for the picked units in the packing area", "Release the reservation or ship the units"],
        })),
      });
    }

    if (first.status === "completed") {
      const unsupplied = list.filter((i) => !i.backordered && i.qtyOrdered - i.qtyCancelled - i.shipped > 0);
      const pay = payByOrder.get(orderId);
      const outstanding = pay ? pay.billed - pay.credited - (pay.received - pay.refunded) : 0;
      const noShipment = list.every((i) => i.shipped === 0);
      if (unsupplied.length || outstanding > 0 || noShipment || unbilled.length) {
        hits.push({ orderId, build: (rec, tl) => statusFindings(rec, tl, unsupplied, outstanding, noShipment, unbilled) });
      }
    }

    const pay = payByOrder.get(orderId);
    if (pay) {
      const billedNet = pay.billed - pay.credited;
      const receivedNet = pay.received - pay.refunded;
      if (receivedNet > billedNet && pay.lastPaidAt) {
        hits.push({
          orderId, build: (rec, tl) => [{
            ...base(rec, "OT-PAY", `over:${orderId}:${billedNet}:${receivedNet}`, pay.lastPaidAt!),
            kind: "fact", certainty: "verified", priority: receivedNet - billedNet >= 5000 ? "high" : "medium", rank: 15,
            title: `${rupees(receivedNet - billedNet)} received beyond what was billed`,
            detail: `Invoices for ${rec.order.code} come to ${rupees(billedNet)} after credit notes; payments come to ${rupees(receivedNet)} after refunds.`,
            expected: billedNet, actual: receivedNet, unit: "₹",
            calculation: `${rupees(pay.received)} received − ${rupees(pay.refunded)} refunded − (${rupees(pay.billed)} billed − ${rupees(pay.credited)} credited) = ${rupees(receivedNet - billedNet)}`,
            exceptions: [`Credit notes counted: ${rupees(pay.credited)}`, `Refunds counted: ${rupees(pay.refunded)}`],
            missing: ["Bank or UPI statement line for each payment"],
            evidence: pickEvidence(tl, "invoice", "payment"),
            checks: ["Match each payment to the bank or UPI statement", "Refund or carry forward the excess once confirmed"],
          }],
        });
      }
      const outstanding = billedNet - receivedNet;
      if (outstanding > 0 && pay.oldestDue && now.getTime() - pay.oldestDue.getTime() > OVERDUE_DAYS * DAY) {
        const late = Math.floor((now.getTime() - pay.oldestDue.getTime()) / DAY);
        hits.push({
          orderId, build: (rec, tl) => [{
            ...base(rec, "OT-PAY", `overdue:${orderId}:${outstanding}`, new Date(pay.oldestDue!.getTime() + OVERDUE_DAYS * DAY)),
            kind: "fact", certainty: "verified", priority: "medium", rank: 16,
            title: `${rupees(outstanding)} outstanding, ${late} days past due`,
            detail: `${rec.order.customerName} owes ${rupees(outstanding)} on ${rec.order.code}; the first invoice fell due ${late} days ago.`,
            expected: 0, actual: outstanding, unit: "₹",
            evidence: pickEvidence(tl, "invoice", "payment"),
            checks: ["Call the customer about the balance", "Put new orders on hold per the credit policy"],
          }],
        });
      }
    }
  }

  // Shipments, invoices and payments that name a different customer or variant than the order.
  const mismatches = await q<{ kind: string; orderId: number; recordId: number; recordCode: string; at: Date; expected: string; actual: string }>(
    `SELECT 'shipment' AS kind, s.order_id AS "orderId", s.id AS "recordId", s.code AS "recordCode", s.dispatched_at AS at, oc.name AS expected, sc.name AS actual
       FROM shipments s JOIN orders o ON o.id = s.order_id JOIN customers oc ON oc.id = o.customer_id JOIN customers sc ON sc.id = s.customer_id
      WHERE s.business_id = $1 AND s.customer_id <> o.customer_id
     UNION ALL
     SELECT 'invoice', i.order_id, i.id, i.code, i.issued_at, oc.name, ic.name
       FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers oc ON oc.id = o.customer_id JOIN customers ic ON ic.id = i.customer_id
      WHERE i.business_id = $1 AND i.customer_id <> o.customer_id
     UNION ALL
     SELECT 'invoice line', i.order_id, i.id, i.code, i.issued_at, ov.sku, iv.sku
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN order_items oi ON oi.id = ii.order_item_id
       JOIN product_variants ov ON ov.id = oi.variant_id JOIN product_variants iv ON iv.id = ii.variant_id
      WHERE i.business_id = $1 AND ii.variant_id <> oi.variant_id
     UNION ALL
     SELECT 'shipment line', s.order_id, s.id, s.code, s.dispatched_at, ov.sku, sv.sku
       FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id JOIN order_items oi ON oi.id = si.order_item_id
       JOIN product_variants ov ON ov.id = oi.variant_id JOIN product_variants sv ON sv.id = si.variant_id
      WHERE s.business_id = $1 AND si.variant_id <> oi.variant_id
     UNION ALL
     SELECT 'payment', i.order_id, p.id, p.code, p.received_at, ic.name, pc.name
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers ic ON ic.id = i.customer_id JOIN customers pc ON pc.id = p.customer_id
      WHERE p.business_id = $1 AND p.customer_id <> i.customer_id`,
    businessId,
  );
  for (const m of mismatches) {
    hits.push({
      orderId: m.orderId, build: (rec, tl) => [{
        ...base(rec, "OT-MATCH", `${m.kind}:${m.recordId}:${m.actual}`, m.at),
        kind: "fact", certainty: "verified", priority: "high", rank: 5,
        title: m.kind.endsWith("line") ? `${m.recordCode} records ${m.actual} for an ${m.expected} line` : `${m.recordCode} names ${m.actual}, not ${m.expected}`,
        detail: m.kind.endsWith("line")
          ? `A ${m.kind} on ${m.recordCode} is linked to the ${rec.order.code} line for ${m.expected} but records variant ${m.actual}.`
          : `${rec.order.code} is for ${m.expected}, but ${m.kind} ${m.recordCode} is recorded against ${m.actual}.`,
        evidence: tl.filter((e) => e.type === "order" || e.code === m.recordCode),
        checks: m.kind === "shipment"
          ? [`Check the consignment note and transporter receipt for ${m.recordCode}`, `Confirm with ${m.expected} that the goods arrived`, "Correct the shipment's customer if it was a data-entry slip"]
          : [`Check which customer ${m.recordCode} should name`, "Correct the record or link it to the right order"],
        missing: m.kind === "shipment" ? ["Transporter's delivery receipt"] : [],
      }],
    });
  }

  // Payments recorded twice: same customer, amount and reference within 30 minutes.
  const dups = await q<{ a: number; b: number; aCode: string; bCode: string; amount: number; reference: string; at: Date; orderId: number | null }>(
    `SELECT p1.id AS a, p2.id AS b, p1.code AS "aCode", p2.code AS "bCode", p1.amount, p1.reference, p2.received_at AS at, i.order_id AS "orderId"
       FROM payments p1 JOIN payments p2 ON p2.business_id = p1.business_id AND p2.customer_id = p1.customer_id AND p2.amount = p1.amount
        AND p2.kind = p1.kind AND p2.id > p1.id AND p2.reference = p1.reference AND p2.received_at - p1.received_at < interval '30 minutes'
       LEFT JOIN invoices i ON i.id = p1.invoice_id
      WHERE p1.business_id = $1 AND p1.kind = 'receipt'`,
    businessId,
  );
  for (const d of dups) {
    if (!d.orderId) continue;
    hits.push({
      orderId: d.orderId, build: (rec, tl) => [{
        ...base(rec, "OT-DUP", `payment:${d.a}:${d.b}`, d.at),
        kind: "inference", certainty: "likely", priority: "high", rank: 4,
        title: `${d.bCode} looks like a duplicate of ${d.aCode}`,
        detail: `Both record ${rupees(d.amount)} from ${rec.order.customerName} with reference ${d.reference}, minutes apart. One payment may have been entered twice.`,
        evidence: tl.filter((e) => e.code === d.aCode || e.code === d.bCode || e.type === "invoice"),
        exceptions: ["Checked for two different invoices: both payments are allocated to the same invoice"],
        missing: ["Bank or UPI statement showing whether one or two credits arrived"],
        checks: ["Match the reference against the UPI statement", "Void the duplicate payment record if only one credit arrived"],
      }],
    });
  }

  // Load each flagged order's records once and build its findings.
  const out: Draft[] = [];
  const cache = new Map<number, { rec: OrderRecords; tl: EvidenceRef[] } | null>();
  for (const h of hits) {
    if (!cache.has(h.orderId)) {
      const rec = await orderRecords(businessId, h.orderId);
      cache.set(h.orderId, rec ? { rec, tl: orderTimeline(rec) } : null);
    }
    const c = cache.get(h.orderId);
    if (c) out.push(...h.build(c.rec, c.tl));
  }

  // Payments not allocated to any invoice by the end of the day they arrived.
  const loose = await q<{ id: number; code: string; amount: number; method: string; reference: string; receivedAt: Date; customer: string; customerId: number }>(
    `SELECT p.id, p.code, p.amount, p.method, p.reference, p.received_at AS "receivedAt", c.name AS customer, c.id AS "customerId"
       FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.business_id = $1 AND p.kind = 'receipt' AND p.invoice_id IS NULL`,
    businessId,
  );
  for (const p of loose) {
    const endOfDay = new Date(Math.floor((p.receivedAt.getTime() + IST) / DAY) * DAY - IST + DAY - 60_000);
    if (now.getTime() < endOfDay.getTime()) continue;
    const ev: EvidenceRef = { type: "payment", id: p.id, code: p.code, label: "Payment received", detail: `${rupees(p.amount)} from ${p.customer} by ${p.method.toUpperCase()} (ref ${p.reference}), not linked to any invoice.`, at: p.receivedAt, values: { amount: p.amount } };
    out.push({
      caseKey: `payment:${p.id}`, subject: { type: "payment", id: p.id, code: p.code }, module: "ordertrace", rule: "OT-PAY", version: 1,
      fingerprint: `OT-PAY:unallocated:${p.id}`, kind: "fact", certainty: "verified", priority: "medium", rank: 10, at: endOfDay,
      caseTitle: `Unallocated payment ${p.code} from ${p.customer}`,
      title: `${rupees(p.amount)} from ${p.customer} not allocated to an invoice`,
      detail: `${p.code} arrived ${p.receivedAt.toISOString().slice(0, 10)} and was still unallocated at the end of that day, against the billing policy.`,
      expected: 0, actual: p.amount, unit: "₹", evidence: [ev],
      checks: [`List ${p.customer}'s open invoices and allocate the payment`, "If it doesn't match an invoice, record it as an advance"],
      missing: ["Remittance advice from the customer"],
    });
  }
  return out;
}

function base(rec: OrderRecords, rule: string, key: string, at: Date) {
  return {
    caseKey: `order:${rec.order.id}`, subject: { type: "order", id: rec.order.id, code: rec.order.code }, module: "ordertrace" as const,
    rule, version: 1, fingerprint: `${rule}:${key}`, at,
  };
}

function invoiceFindings(rec: OrderRecords, tl: EvidenceRef[], unbilled: ItemAgg[], overbilled: ItemAgg[]): Draft[] {
  const o = rec.order;
  const others = rec.invoices.filter((i) => i.kind === "invoice");
  const credits = rec.invoices.filter((i) => i.kind === "credit_note");
  const exceptions = [
    others.length > 1 ? `Split invoicing: ${others.map((i) => i.code).join(", ")} all counted` : `Other invoices on ${o.code}: none besides ${others[0]?.code ?? "—"}`,
    credits.length ? `Credit notes counted: ${credits.map((c) => c.code).join(", ")}` : "Credit notes: none",
    rec.returns.length ? `Returns counted: ${rec.returns.map((r) => r.code).join(", ")}` : "Returns: none",
  ];
  const out: Draft[] = [];
  for (const i of unbilled) {
    const shippedNet = i.shipped - i.returned;
    const billedNet = i.invoiced - i.credited;
    const diff = shippedNet - billedNet;
    const value = diff * i.unitPrice;
    const backorderNote = i.backordered || i.qtyOrdered - i.qtyCancelled > i.shipped
      ? `Backorder: ${units(i.qtyOrdered - i.qtyCancelled - i.shipped)} still to ship; not part of this difference`
      : `Backorder: none — all ${units(i.qtyOrdered - i.qtyCancelled)} due were dispatched`;
    const shipCodes = rec.shipments.filter((s) => s.lines.some((l) => l.orderItemId === i.itemId)).map((s) => s.code).join(", ");
    const invCodes = others.filter((x) => x.lines.some((l) => l.orderItemId === i.itemId)).map((x) => x.code).join(", ") || "no invoice";
    const at = new Date(Math.max(i.lastShippedAt!.getTime(), i.lastInvoicedAt?.getTime() ?? 0));
    out.push({
      ...base(rec, "OT-INV", `unbilled:${i.itemId}:${shippedNet}:${billedNet}`, at),
      kind: "fact", certainty: "verified", priority: value >= 500 ? "high" : "medium", rank: 1,
      caseTitle: `Quantity mismatch on ${o.code}: ${units(diff)} of ${i.sku} dispatched but not invoiced`,
      title: `Dispatch quantity exceeds invoiced quantity by ${units(diff)}`,
      detail: `${shipCodes} records ${units(shippedNet)} of ${i.sku} dispatched; ${invCodes} bills ${units(billedNet)}.`,
      expected: shippedNet, actual: billedNet, unit: "units",
      calculation: `${shippedNet} dispatched − ${billedNet} invoiced = ${diff} units unbilled; ${diff} × ${rupees(i.unitPrice)} = ${rupees(value)}`,
      exceptions: [...exceptions, backorderNote, `Cancelled quantity: ${i.qtyCancelled}`],
      missing: [`Signed packing slip for ${shipCodes}`, `Goods-received note from ${o.customerName}`],
      evidence: tl,
      checks: [`Verify ${invCodes} against the packing records for ${shipCodes}`, `Ask ${o.customerName} how many they received`, "Check whether any units were agreed as free or replacement pieces"],
    });
    out.push({
      ...base(rec, "OT-INV", `unbilled-inference:${i.itemId}:${diff}`, at),
      kind: "inference", certainty: "likely", priority: "medium", rank: 30,
      title: `The transaction may have an invoicing discrepancy worth ${rupees(value)}`,
      detail: "The billing record and the dispatch record disagree and no credit note, second invoice or return explains the gap. This establishes a mismatch, not its cause.",
      evidence: [],
    });
    const hyp = (key: string, title: string, detail: string, missing: string[]): Draft => ({
      ...base(rec, "OT-INV", `hyp-${key}:${i.itemId}:${diff}`, at), kind: "hypothesis", certainty: "possible", priority: "low", rank: 40, title, detail, missing, evidence: [],
    });
    out.push(hyp("missing-line", `${invCodes} may be missing ${units(diff)}`, `An invoicing slip would leave the dispatched units unbilled. A supplementary invoice for ${units(diff)} (${rupees(value)}) would correct it.`, ["Accounts' working for the invoice"]));
    out.push(hyp("free-pieces", `${units(diff)} may have gone as free or replacement pieces`, "If this was agreed with the customer, it should be recorded as a zero-value line or a credit note so the records agree.", ["Written agreement or message from the customer"]));
    out.push(hyp("overstated-dispatch", `The dispatch record may overstate what left`, `If only ${units(billedNet)} were packed, ${units(diff)} could still be in the packing area. The stock ledger records ${units(i.shipped)} leaving, so a packing-area check would settle it.`, ["Packing-area count", "Transporter's carton count"]));
  }
  for (const i of overbilled) {
    const shippedNet = i.shipped - i.returned;
    const billedNet = i.invoiced - i.credited;
    out.push({
      ...base(rec, "OT-INV", `overbilled:${i.itemId}:${shippedNet}:${billedNet}`, i.lastInvoicedAt ?? new Date()),
      kind: "fact", certainty: "verified", priority: "high", rank: 2,
      caseTitle: `Billing ahead of dispatch on ${o.code}: ${units(billedNet - shippedNet)} of ${i.sku}`,
      title: `Invoiced ${units(billedNet - shippedNet)} more than dispatched`,
      detail: `Invoices bill ${units(billedNet)} of ${i.sku}; shipments record ${units(shippedNet)} after returns. Policy is to invoice what is dispatched.`,
      expected: shippedNet, actual: billedNet, unit: "units",
      calculation: `${billedNet} invoiced − ${shippedNet} dispatched = ${billedNet - shippedNet}; × ${rupees(i.unitPrice)} = ${rupees((billedNet - shippedNet) * i.unitPrice)}`,
      exceptions,
      evidence: tl,
      checks: ["Check whether a shipment is missing from the records", "Issue a credit note if the units will not ship"],
    });
  }
  return out;
}

function statusFindings(rec: OrderRecords, tl: EvidenceRef[], unsupplied: ItemAgg[], outstanding: number, noShipment: boolean, unbilled: ItemAgg[]): Draft[] {
  const o = rec.order;
  const at = o.completedAt ?? new Date();
  const out: Draft[] = [];
  for (const i of unsupplied) {
    const gap = i.qtyOrdered - i.qtyCancelled - i.shipped;
    out.push({
      ...base(rec, "OT-STATUS", `unsupplied:${i.itemId}:${gap}`, at),
      kind: "fact", certainty: "verified", priority: "high", rank: 3,
      caseTitle: `${o.code} marked completed with ${units(gap)} of ${i.sku} never shipped`,
      title: `Completed with ${units(gap)} of ${i.sku} neither shipped, cancelled nor backordered`,
      detail: `${o.code} asked for ${units(i.qtyOrdered)} of ${i.sku}; ${units(i.shipped)} shipped and ${units(i.qtyCancelled)} were cancelled. The line is not on backorder.`,
      expected: i.qtyOrdered - i.qtyCancelled, actual: i.shipped, unit: "units",
      calculation: `${i.qtyOrdered} ordered − ${i.qtyCancelled} cancelled − ${i.shipped} shipped = ${gap} unaccounted`,
      exceptions: ["Backorder: not flagged", "Cancellation: none recorded for these units"],
      evidence: tl,
      checks: [`Ask ${o.customerName} whether they still want ${units(gap)} of ${i.sku}`, "Cancel the remainder or put it on backorder", "Reopen the order if it is still due"],
    });
  }
  if (unbilled.length) {
    const diff = unbilled.reduce((a, i) => a + (i.shipped - i.returned) - (i.invoiced - i.credited), 0);
    out.push({
      ...base(rec, "OT-STATUS", `completed-unbilled:${o.id}:${diff}`, at),
      kind: "inference", certainty: "likely", priority: "medium", rank: 25,
      title: `Marked completed while ${units(diff)} remain unbilled`,
      detail: "A dashboard would show this order as done. The completion was recorded without the billing and dispatch records agreeing.",
      evidence: tl.filter((e) => e.label === "Marked completed"),
    });
  }
  if (outstanding > 0) {
    out.push({
      ...base(rec, "OT-STATUS", `completed-outstanding:${o.id}:${outstanding}`, at),
      kind: "fact", certainty: "verified", priority: "medium", rank: 26,
      title: `Marked completed with ${rupees(outstanding)} unpaid`,
      detail: `Invoices net of credit notes exceed payments net of refunds by ${rupees(outstanding)}.`,
      expected: 0, actual: outstanding, unit: "₹", evidence: tl.filter((e) => e.type === "invoice" || e.type === "payment"),
    });
  }
  if (noShipment) {
    out.push({
      ...base(rec, "OT-STATUS", `completed-unshipped:${o.id}`, at),
      kind: "fact", certainty: "verified", priority: "high", rank: 3,
      title: "Marked completed with no shipment recorded",
      detail: `${o.code} has no dispatch record at all.`, evidence: tl,
    });
  }
  return out;
}
