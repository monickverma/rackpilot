// Everything linked to one order, read in one place: the order and its items,
// reservations, pick lists, shipments, invoices, payments, returns and audit
// events. OrderTrace's record view and the investigation rules both build on
// this, so what a finding cites is exactly what the page shows.

import { q, one } from "../db/client.ts";

export interface ItemRecord {
  id: number;
  variantId: number;
  sku: string;
  productName: string;
  colour: string;
  size: string;
  unitCost: number;
  qtyOrdered: number;
  qtyCancelled: number;
  backordered: boolean;
  unitPrice: number;
  sourceText: string | null;
  matchNote: string | null;
  homeLocation: string;
  active: number;
  picked: number;
  consumed: number;
  released: number;
  shipped: number;
  invoiced: number;
  credited: number;
  returned: number;
}

export interface OrderRecords {
  order: {
    id: number; code: string; status: string; channel: string; sourceText: string; extractedBy: string; customerId: number; customerName: string;
    customerCode: string; customerCity: string; creditDays: number; createdAt: Date; dueAt: Date | null; cancelledAt: Date | null; completedAt: Date | null;
    note: string | null; createdBy: string | null;
  };
  items: ItemRecord[];
  reservations: { id: number; orderItemId: number; sku: string; location: string; locationId: number; qty: number; status: string; createdAt: Date; updatedAt: Date; note: string | null }[];
  picks: { id: number; code: string; status: string; createdAt: Date; pickedAt: Date | null; pickedBy: string | null; lines: { id: number; reservationId: number; sku: string; location: string; qtyToPick: number; qtyPicked: number | null; pickedAt: Date | null }[] }[];
  shipments: { id: number; code: string; customerId: number; customerName: string; carrier: string; tracking: string; dispatchedAt: Date; by: string | null; lines: { orderItemId: number; variantId: number; sku: string; qty: number }[] }[];
  invoices: { id: number; code: string; kind: string; customerId: number; customerName: string; issuedAt: Date; dueAt: Date; by: string | null; total: number; lines: { orderItemId: number | null; variantId: number; sku: string; qty: number; unitPrice: number }[] }[];
  payments: { id: number; code: string; kind: string; invoiceId: number | null; invoiceCode: string | null; customerId: number; amount: number; method: string; reference: string; receivedAt: Date; by: string | null }[];
  returns: { id: number; code: string; receivedAt: Date; note: string | null; lines: { orderItemId: number | null; sku: string; qty: number; condition: string; restocked: number }[] }[];
  audit: { action: string; actor: string | null; reason: string | null; at: Date }[];
  totals: { billed: number; credited: number; received: number; refunded: number; outstanding: number };
}

export async function orderRecords(businessId: number, orderId: number): Promise<OrderRecords | null> {
  const order = await one<OrderRecords["order"]>(
    `SELECT o.id, o.code, o.status, o.channel, o.source_text AS "sourceText", o.extracted_by AS "extractedBy", o.customer_id AS "customerId",
            c.name AS "customerName", c.code AS "customerCode", c.city AS "customerCity", c.credit_days AS "creditDays", o.created_at AS "createdAt",
            o.due_at AS "dueAt", o.cancelled_at AS "cancelledAt", o.completed_at AS "completedAt", o.note, u.name AS "createdBy"
       FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.created_by
      WHERE o.business_id = $1 AND o.id = $2`,
    businessId, orderId,
  );
  if (!order) return null;
  const [items, reservations, pickRows, shipRows, invRows, payments, retRows, audit] = await Promise.all([
    q<ItemRecord>(
      `SELECT oi.id, oi.variant_id AS "variantId", v.sku, p.name AS "productName", v.colour, v.size, p.unit_cost AS "unitCost",
              oi.qty_ordered AS "qtyOrdered", oi.qty_cancelled AS "qtyCancelled", oi.backordered, oi.unit_price AS "unitPrice",
              oi.source_text AS "sourceText", oi.match_note AS "matchNote", hl.code AS "homeLocation",
              COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'active'), 0)::int AS active,
              COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'picked'), 0)::int AS picked,
              COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'consumed'), 0)::int AS consumed,
              COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.order_item_id = oi.id AND r.status = 'released'), 0)::int AS released,
              COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)::int AS shipped,
              COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'invoice'), 0)::int AS invoiced,
              COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'credit_note'), 0)::int AS credited,
              COALESCE((SELECT SUM(ri.qty) FROM return_items ri WHERE ri.order_item_id = oi.id), 0)::int AS returned
         FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id JOIN products p ON p.id = v.product_id
         JOIN locations hl ON hl.id = v.home_location_id
        WHERE oi.order_id = $1 ORDER BY oi.id`,
      orderId,
    ),
    q<OrderRecords["reservations"][number]>(
      `SELECT r.id, r.order_item_id AS "orderItemId", v.sku, l.code AS location, l.id AS "locationId", r.qty, r.status, r.created_at AS "createdAt",
              r.updated_at AS "updatedAt", r.note
         FROM reservations r JOIN order_items oi ON oi.id = r.order_item_id JOIN product_variants v ON v.id = r.variant_id JOIN locations l ON l.id = r.location_id
        WHERE oi.order_id = $1 ORDER BY r.created_at, r.id`,
      orderId,
    ),
    q<{ id: number; code: string; status: string; createdAt: Date; pickedAt: Date | null; pickedBy: string | null; lineId: number | null; reservationId: number; sku: string; location: string; qtyToPick: number; qtyPicked: number | null; linePickedAt: Date | null }>(
      `SELECT pl.id, pl.code, pl.status, pl.created_at AS "createdAt", pl.picked_at AS "pickedAt", u.name AS "pickedBy", pli.id AS "lineId",
              pli.reservation_id AS "reservationId", v.sku, l.code AS location, pli.qty_to_pick AS "qtyToPick", pli.qty_picked AS "qtyPicked", pli.picked_at AS "linePickedAt"
         FROM pick_lists pl LEFT JOIN users u ON u.id = pl.picked_by LEFT JOIN pick_list_items pli ON pli.pick_list_id = pl.id
         LEFT JOIN product_variants v ON v.id = pli.variant_id LEFT JOIN locations l ON l.id = pli.location_id
        WHERE pl.order_id = $1 ORDER BY pl.created_at, pli.id`,
      orderId,
    ),
    q<{ id: number; code: string; customerId: number; customerName: string; carrier: string; tracking: string; dispatchedAt: Date; by: string | null; orderItemId: number; variantId: number; sku: string; qty: number }>(
      `SELECT s.id, s.code, s.customer_id AS "customerId", c.name AS "customerName", s.carrier, s.tracking, s.dispatched_at AS "dispatchedAt", u.name AS by,
              si.order_item_id AS "orderItemId", si.variant_id AS "variantId", v.sku, si.qty
         FROM shipments s JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.created_by
         JOIN shipment_items si ON si.shipment_id = s.id JOIN product_variants v ON v.id = si.variant_id
        WHERE s.order_id = $1 ORDER BY s.dispatched_at, si.id`,
      orderId,
    ),
    q<{ id: number; code: string; kind: string; customerId: number; customerName: string; issuedAt: Date; dueAt: Date; by: string | null; orderItemId: number | null; variantId: number; sku: string; qty: number; unitPrice: number }>(
      `SELECT i.id, i.code, i.kind, i.customer_id AS "customerId", c.name AS "customerName", i.issued_at AS "issuedAt", i.due_at AS "dueAt", u.name AS by,
              ii.order_item_id AS "orderItemId", ii.variant_id AS "variantId", v.sku, ii.qty, ii.unit_price AS "unitPrice"
         FROM invoices i JOIN customers c ON c.id = i.customer_id LEFT JOIN users u ON u.id = i.created_by
         JOIN invoice_items ii ON ii.invoice_id = i.id JOIN product_variants v ON v.id = ii.variant_id
        WHERE i.order_id = $1 ORDER BY i.issued_at, ii.id`,
      orderId,
    ),
    q<OrderRecords["payments"][number]>(
      `SELECT p.id, p.code, p.kind, p.invoice_id AS "invoiceId", i.code AS "invoiceCode", p.customer_id AS "customerId", p.amount, p.method, p.reference,
              p.received_at AS "receivedAt", u.name AS by
         FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.created_by
        WHERE i.order_id = $1 ORDER BY p.received_at, p.id`,
      orderId,
    ),
    q<{ id: number; code: string; receivedAt: Date; note: string | null; orderItemId: number | null; sku: string; qty: number; condition: string; restocked: number }>(
      `SELECT r.id, r.code, r.received_at AS "receivedAt", r.note, ri.order_item_id AS "orderItemId", v.sku, ri.qty, ri.condition, ri.restocked_qty AS restocked
         FROM returns r JOIN return_items ri ON ri.return_id = r.id JOIN product_variants v ON v.id = ri.variant_id
        WHERE r.order_id = $1 ORDER BY r.received_at`,
      orderId,
    ),
    q<OrderRecords["audit"][number]>(
      `SELECT a.action, u.name AS actor, a.reason, a.created_at AS at FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.business_id = $1 AND a.entity_type = 'order' AND a.entity_id = $2 ORDER BY a.created_at`,
      businessId, orderId,
    ),
  ]);

  const picks = groupBy(pickRows, (r) => r.id, (r) => ({ id: r.id, code: r.code, status: r.status, createdAt: r.createdAt, pickedAt: r.pickedAt, pickedBy: r.pickedBy, lines: [] as OrderRecords["picks"][number]["lines"] }), (g, r) => {
    if (r.lineId) g.lines.push({ id: r.lineId, reservationId: r.reservationId, sku: r.sku, location: r.location, qtyToPick: r.qtyToPick, qtyPicked: r.qtyPicked, pickedAt: r.linePickedAt });
  });
  const shipments = groupBy(shipRows, (r) => r.id, (r) => ({ id: r.id, code: r.code, customerId: r.customerId, customerName: r.customerName, carrier: r.carrier, tracking: r.tracking, dispatchedAt: r.dispatchedAt, by: r.by, lines: [] as OrderRecords["shipments"][number]["lines"] }), (g, r) => g.lines.push({ orderItemId: r.orderItemId, variantId: r.variantId, sku: r.sku, qty: r.qty }));
  const invoices = groupBy(invRows, (r) => r.id, (r) => ({ id: r.id, code: r.code, kind: r.kind, customerId: r.customerId, customerName: r.customerName, issuedAt: r.issuedAt, dueAt: r.dueAt, by: r.by, total: 0, lines: [] as OrderRecords["invoices"][number]["lines"] }), (g, r) => {
    g.lines.push({ orderItemId: r.orderItemId, variantId: r.variantId, sku: r.sku, qty: r.qty, unitPrice: r.unitPrice });
    g.total += r.qty * r.unitPrice;
  });
  const returns = groupBy(retRows, (r) => r.id, (r) => ({ id: r.id, code: r.code, receivedAt: r.receivedAt, note: r.note, lines: [] as OrderRecords["returns"][number]["lines"] }), (g, r) => g.lines.push({ orderItemId: r.orderItemId, sku: r.sku, qty: r.qty, condition: r.condition, restocked: r.restocked }));

  const billed = invoices.filter((i) => i.kind === "invoice").reduce((a, i) => a + i.total, 0);
  const credited = invoices.filter((i) => i.kind === "credit_note").reduce((a, i) => a + i.total, 0);
  const received = payments.filter((p) => p.kind === "receipt").reduce((a, p) => a + p.amount, 0);
  const refunded = payments.filter((p) => p.kind === "refund").reduce((a, p) => a + p.amount, 0);
  return {
    order, items, reservations, picks, shipments, invoices, payments, returns, audit,
    totals: { billed, credited, received, refunded, outstanding: billed - credited - (received - refunded) },
  };
}

function groupBy<R, G>(rows: R[], key: (r: R) => number, make: (r: R) => G, add: (g: G, r: R) => void): G[] {
  const out = new Map<number, G>();
  for (const r of rows) {
    let g = out.get(key(r));
    if (!g) out.set(key(r), (g = make(r)));
    add(g, r);
  }
  return [...out.values()];
}
