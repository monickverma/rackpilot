// Invoices, credit notes and payments. By default an invoice bills what was
// dispatched and not yet billed; quantities can be overridden (a real
// business sometimes does), and OrderTrace checks the result.

import { one, q, run, tx } from "../../db/client.ts";
import { audit, DomainError, need, NotFoundError, nowOf, type Ctx } from "../context.ts";
import { DAY, rupees } from "../format.ts";
import { refreshStatus } from "./orders.ts";
import { nextCode } from "./stock.ts";

export async function billable(ctx: Ctx, orderId: number) {
  return q<{ orderItemId: number; variantId: number; sku: string; unitPrice: number; shipped: number; returned: number; invoiced: number; credited: number }>(
    `SELECT oi.id AS "orderItemId", oi.variant_id AS "variantId", v.sku, oi.unit_price AS "unitPrice",
            COALESCE((SELECT SUM(qty) FROM shipment_items s WHERE s.order_item_id = oi.id), 0)::int AS shipped,
            COALESCE((SELECT SUM(qty) FROM return_items r WHERE r.order_item_id = oi.id), 0)::int AS returned,
            COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'invoice'), 0)::int AS invoiced,
            COALESCE((SELECT SUM(ii.qty) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'credit_note'), 0)::int AS credited
       FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE oi.business_id = $1 AND oi.order_id = $2 ORDER BY oi.id`,
    ctx.businessId, orderId,
  );
}

export async function issueInvoice(ctx: Ctx, orderId: number, input: { kind?: "invoice" | "credit_note"; lines?: { orderItemId: number; qty: number; unitPrice?: number }[]; note?: string | null } = {}) {
  need(ctx, "billing.write");
  const kind = input.kind ?? "invoice";
  return tx(async () => {
    const order = await one<{ id: number; code: string; customerId: number; creditDays: number }>(
      `SELECT o.id, o.code, o.customer_id AS "customerId", c.credit_days AS "creditDays" FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.business_id = $1 AND o.id = $2`,
      ctx.businessId, orderId,
    );
    if (!order) throw new NotFoundError("Order not found.");
    const items = await billable(ctx, order.id);
    const lines: { orderItemId: number; qty: number; unitPrice?: number }[] = (input.lines ?? items.map((i) => ({ orderItemId: i.orderItemId, qty: i.shipped - i.returned - (i.invoiced - i.credited) }))).filter((l) => l.qty > 0);
    if (!lines.length) throw new DomainError(kind === "invoice" ? "Everything dispatched is already invoiced." : "Give the quantities to credit.");
    const code = await nextCode(ctx, "invoices", kind === "invoice" ? "INV-" : "CN-", 4);
    const inv = await one<{ id: number }>(
      `INSERT INTO invoices (business_id, code, kind, order_id, customer_id, issued_at, due_at, created_by, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      ctx.businessId, code, kind, order.id, order.customerId, nowOf(ctx), new Date(nowOf(ctx).getTime() + order.creditDays * DAY), ctx.user.id, input.note ?? null,
    );
    let total = 0;
    for (const l of lines) {
      const item = items.find((i) => i.orderItemId === l.orderItemId);
      if (!item) throw new DomainError("An invoice line points at a line this order doesn't have.");
      if (!Number.isInteger(l.qty) || l.qty > 5000) throw new DomainError("Quantities must be whole numbers.");
      const price = l.unitPrice ?? item.unitPrice;
      if (!Number.isInteger(price) || price < 0) throw new DomainError("Prices must be whole rupees, 0 or more.");
      await run(`INSERT INTO invoice_items (invoice_id, order_item_id, variant_id, qty, unit_price) VALUES ($1, $2, $3, $4, $5)`, inv!.id, item.orderItemId, item.variantId, l.qty, price);
      total += l.qty * price;
    }
    await audit(ctx, kind === "invoice" ? "invoice.issued" : "credit_note.issued", { type: "invoice", id: inv!.id, code }, input.note ?? null, { order: order.code, total });
    // A new invoice on a completed order means money is due again.
    if (kind === "invoice" && total > 0 && (await run(`UPDATE orders SET status = 'dispatched', completed_at = NULL WHERE id = $1 AND status = 'completed'`, order.id))) {
      await audit(ctx, "order.reopened", { type: "order", id: order.id, code: order.code }, `New invoice ${code} awaits payment`);
    }
    await refreshStatus(ctx, order.id);
    return { id: inv!.id, code, total };
  });
}

export async function recordPayment(ctx: Ctx, input: { customerId: number; invoiceId: number | null; amount: number; method: "upi" | "bank" | "cash" | "cheque"; reference: string; kind?: "receipt" | "refund" }) {
  need(ctx, "billing.write");
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > 10_000_000) throw new DomainError("Amount must be whole rupees above zero.");
  return tx(async () => {
    const customer = await one<{ id: number }>(`SELECT id FROM customers WHERE business_id = $1 AND id = $2`, ctx.businessId, input.customerId);
    if (!customer) throw new NotFoundError("Customer not found.");
    let orderId: number | null = null;
    if (input.invoiceId) {
      const inv = await one<{ id: number; orderId: number }>(`SELECT id, order_id AS "orderId" FROM invoices WHERE business_id = $1 AND id = $2 AND kind = 'invoice'`, ctx.businessId, input.invoiceId);
      if (!inv) throw new NotFoundError("Invoice not found.");
      orderId = inv.orderId;
    }
    const kind = input.kind ?? "receipt";
    const code = await nextCode(ctx, "payments", kind === "receipt" ? "PAY-" : "RFD-", kind === "receipt" ? 4 : 3);
    const p = await one<{ id: number }>(
      `INSERT INTO payments (business_id, code, kind, customer_id, invoice_id, amount, method, reference, received_at, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      ctx.businessId, code, kind, customer.id, input.invoiceId, input.amount, input.method, input.reference.slice(0, 80) || `${input.method.toUpperCase()}-${Date.now() % 1e8}`, nowOf(ctx), ctx.user.id,
    );
    await audit(ctx, kind === "receipt" ? "payment.recorded" : "refund.recorded", { type: "payment", id: p!.id, code }, null, { amount: input.amount, invoice: input.invoiceId });
    if (orderId) await refreshStatus(ctx, orderId);
    return { id: p!.id, code };
  });
}

export async function allocatePayment(ctx: Ctx, paymentId: number, invoiceId: number) {
  need(ctx, "billing.write");
  return tx(async () => {
    const p = await one<{ id: number; code: string; customerId: number; invoiceId: number | null; amount: number }>(
      `SELECT id, code, customer_id AS "customerId", invoice_id AS "invoiceId", amount FROM payments WHERE business_id = $1 AND id = $2 FOR UPDATE`, ctx.businessId, paymentId,
    );
    if (!p) throw new NotFoundError("Payment not found.");
    if (p.invoiceId) throw new DomainError(`${p.code} is already allocated.`);
    const inv = await one<{ id: number; code: string; customerId: number; orderId: number }>(`SELECT id, code, customer_id AS "customerId", order_id AS "orderId" FROM invoices WHERE business_id = $1 AND id = $2`, ctx.businessId, invoiceId);
    if (!inv) throw new NotFoundError("Invoice not found.");
    if (inv.customerId !== p.customerId) throw new DomainError("That invoice belongs to a different customer.");
    await run(`UPDATE payments SET invoice_id = $2 WHERE id = $1`, p.id, inv.id);
    await audit(ctx, "payment.allocated", { type: "payment", id: p.id, code: p.code }, null, { invoice: inv.code, amount: p.amount });
    await refreshStatus(ctx, inv.orderId);
    return `${p.code} (${rupees(p.amount)}) allocated to ${inv.code}`;
  });
}

export async function openInvoices(ctx: Ctx, customerId: number) {
  return q<{ id: number; code: string; orderCode: string; total: number; paid: number; issuedAt: Date }>(
    `SELECT i.id, i.code, o.code AS "orderCode", (SELECT SUM(qty * unit_price) FROM invoice_items WHERE invoice_id = i.id)::int AS total,
            COALESCE((SELECT SUM(CASE WHEN kind = 'receipt' THEN amount ELSE -amount END) FROM payments WHERE invoice_id = i.id), 0)::int AS paid, i.issued_at AS "issuedAt"
       FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.business_id = $1 AND i.customer_id = $2 AND i.kind = 'invoice' ORDER BY i.issued_at DESC LIMIT 30`,
    ctx.businessId, customerId,
  );
}
