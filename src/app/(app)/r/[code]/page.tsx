// Every record code links here and lands on the page that shows it.

import { notFound, redirect } from "next/navigation";
import { one } from "@/db/client";
import { requireSession } from "@/lib/auth";

export default async function Resolve({ params }: { params: Promise<{ code: string }> }) {
  const s = await requireSession();
  const code = decodeURIComponent((await params).code).toUpperCase();
  const b = s.businessId;
  const order = async (sql: string) => (await one<{ code: string }>(sql, b, code))?.code;
  let to: string | undefined;
  if (/^(OT|SS)-\d+$/.test(code)) to = `/investigations/${code}`;
  else if (/^ORD-\d+$/.test(code)) to = `/orders/${code}`;
  else if (/^(INV|CN)-\d+$/.test(code)) to = (await order(`SELECT o.code FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.business_id = $1 AND i.code = $2`)) ?? undefined;
  else if (/^SHP-\d+$/.test(code)) to = (await order(`SELECT o.code FROM shipments s JOIN orders o ON o.id = s.order_id WHERE s.business_id = $1 AND s.code = $2`)) ?? undefined;
  else if (/^(PAY|RFD)-\d+$/.test(code)) {
    to = (await order(`SELECT o.code FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN orders o ON o.id = i.order_id WHERE p.business_id = $1 AND p.code = $2`)) ?? undefined;
    if (!to) to = "/ordertrace?view=payments";
  } else if (/^PL-\d+$/.test(code)) {
    const pl = await one<{ id: number; orderCode: string }>(`SELECT pl.id, o.code AS "orderCode" FROM pick_lists pl JOIN orders o ON o.id = pl.order_id WHERE pl.business_id = $1 AND pl.code = $2`, b, code);
    if (pl) to = `/orders/${pl.orderCode}/pick/${pl.id}`;
  } else if (/^RET-\d+$/.test(code)) to = (await order(`SELECT o.code FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.business_id = $1 AND r.code = $2`)) ?? undefined;
  else if (/^TRF-\d+$/.test(code)) to = "/stock?tab=transfers";
  else if (/^CNT-\d+$/.test(code)) to = "/stock?tab=counts";
  else if (/^(PO|GRN)-\d+$/.test(code)) to = "/purchasing#orders";
  else if (/^PLAN-\d+$/.test(code)) to = `/purchasing/${code}`;
  else if (/^A-/.test(code)) to = `/stocksleuth?loc=${code}`;
  else if (await one(`SELECT 1 FROM product_variants WHERE business_id = $1 AND sku = $2`, b, code)) to = `/inventory/${code}`;
  if (!to) notFound();
  redirect(to.startsWith("/") ? to : `/orders/${to}`);
}
