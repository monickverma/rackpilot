import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchIcon } from "@/components/icons";
import { CaseBadge, OrderBadge } from "@/components/status";
import { Badge, Button, Card, CardHeader, cn, Empty, inputClass, PageHeader, RecordLink, Table, Td, Th, tabClass } from "@/components/ui";
import { one, q } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { rupees, shortDay } from "@/lib/format";
import { listCases } from "@/lib/investigate/cases";
import { RULES } from "@/lib/investigate/types";

export const metadata: Metadata = { title: "OrderTrace" };

interface Row {
  id: number; code: string; status: string; customer: string; createdAt: Date; due: number; allocated: number; shipped: number; returned: number;
  invoiced: number; credited: number; billed: number; received: number; backordered: boolean; caseCode: string | null; caseStatus: string | null;
}

export default async function OrderTrace({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  if (sp.q?.trim()) {
    const term = sp.q.trim().toUpperCase();
    const hit = await one<{ code: string }>(
      `SELECT o.code FROM orders o WHERE o.business_id = $1 AND (o.code = $2
          OR o.id IN (SELECT order_id FROM invoices WHERE business_id = $1 AND code = $2) OR o.id IN (SELECT order_id FROM shipments WHERE business_id = $1 AND code = $2)
          OR o.id IN (SELECT i.order_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.business_id = $1 AND p.code = $2)) LIMIT 1`,
      s.businessId, term,
    );
    if (hit) redirect(`/orders/${hit.code}`);
  }
  const view = sp.view ?? "mismatch";
  const rows = await q<Row>(
    `SELECT o.id, o.code, o.status, c.name AS customer, o.created_at AS "createdAt",
            SUM(oi.qty_ordered - oi.qty_cancelled)::int AS due,
            SUM((SELECT COALESCE(SUM(qty), 0) FROM reservations r WHERE r.order_item_id = oi.id AND r.status <> 'released'))::int AS allocated,
            SUM((SELECT COALESCE(SUM(qty), 0) FROM shipment_items si WHERE si.order_item_id = oi.id))::int AS shipped,
            SUM((SELECT COALESCE(SUM(qty), 0) FROM return_items ri WHERE ri.order_item_id = oi.id))::int AS returned,
            SUM((SELECT COALESCE(SUM(ii.qty), 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'invoice'))::int AS invoiced,
            SUM((SELECT COALESCE(SUM(ii.qty), 0) FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.order_item_id = oi.id AND i.kind = 'credit_note'))::int AS credited,
            COALESCE((SELECT SUM(CASE WHEN i.kind = 'invoice' THEN 1 ELSE -1 END * ii.qty * ii.unit_price) FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.order_id = o.id), 0)::int AS billed,
            COALESCE((SELECT SUM(CASE WHEN p.kind = 'receipt' THEN 1 ELSE -1 END * p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.order_id = o.id), 0)::int AS received,
            bool_or(oi.backordered) AS backordered,
            (SELECT code FROM investigations WHERE business_id = o.business_id AND case_key = 'order:' || o.id ORDER BY detected_at DESC LIMIT 1) AS "caseCode",
            (SELECT status FROM investigations WHERE business_id = o.business_id AND case_key = 'order:' || o.id ORDER BY detected_at DESC LIMIT 1) AS "caseStatus"
       FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items oi ON oi.order_id = o.id
      WHERE o.business_id = $1 AND o.created_at > now() - interval '21 days' AND o.status <> 'cancelled'
      GROUP BY o.id, c.name ORDER BY o.created_at DESC`,
    s.businessId,
  );
  const verdict = (r: Row) => {
    const shippedNet = r.shipped - r.returned;
    const billedNet = r.invoiced - r.credited;
    if (r.caseCode && r.caseStatus && !["resolved", "closed"].includes(r.caseStatus)) return { tone: "bad" as const, text: "Under investigation" };
    if (billedNet !== shippedNet) return { tone: "bad" as const, text: shippedNet > billedNet ? `${shippedNet - billedNet} unbilled` : `${billedNet - shippedNet} overbilled` };
    if (r.received > r.billed) return { tone: "bad" as const, text: "Overpaid" };
    if (r.shipped < r.due && r.backordered) return { tone: "warn" as const, text: `Partial: ${r.due - r.shipped} on backorder` };
    if (r.shipped < r.due) return { tone: "accent" as const, text: "In progress" };
    if (r.received < r.billed) return { tone: "neutral" as const, text: "Awaiting payment" };
    return { tone: "ok" as const, text: "Reconciles" };
  };
  const shown = view === "all" ? rows : rows.filter((r) => ["bad", "warn"].includes(verdict(r).tone));
  const loose = await q<{ code: string; customer: string; amount: number; receivedAt: Date; reference: string }>(
    `SELECT p.code, c.name AS customer, p.amount, p.received_at AS "receivedAt", p.reference FROM payments p JOIN customers c ON c.id = p.customer_id
      WHERE p.business_id = $1 AND p.invoice_id IS NULL AND p.kind = 'receipt' ORDER BY p.received_at DESC`,
    s.businessId,
  );
  const cases = (await listCases(s, { status: "open" })).filter((c) => c.code.startsWith("OT"));
  return (
    <>
      <PageHeader
        title="OrderTrace"
        description="Connects each order with its stock allocation, invoices, payments and dispatches, and finds where those records stop agreeing. Backorders, split invoices, returns and credit notes are treated as the legitimate exceptions they are."
        actions={
          <Form action="/ordertrace" className="flex items-center gap-2">
            <input name="q" defaultValue={sp.q} placeholder="ORD-, INV-, SHP- or PAY- code" className={cn(inputClass, "w-56")} />
            <Button type="submit" size="sm"><SearchIcon size={14} /> Trace</Button>
          </Form>
        }
      />
      {sp.q && <Card className="mb-3 px-6 py-3 text-[13px] text-warn">No order, invoice, shipment or payment {sp.q.toUpperCase()} in this business.</Card>}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
            {[["mismatch", "Exceptions and mismatches"], ["all", "All recent orders"]].map(([k, l]) => <Link key={k} href={`/ordertrace?view=${k}`} className={tabClass(view === k)}>{l}</Link>)}
            <span className="ml-auto text-xs text-muted">Last 21 days</span>
          </div>
          {shown.length ? (
            <Table>
              <thead><tr><Th>Order</Th><Th align="right">Due</Th><Th align="right">Allocated</Th><Th align="right">Shipped</Th><Th align="right">Invoiced</Th><Th align="right">Billed</Th><Th align="right">Paid</Th><Th>Result</Th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const v = verdict(r);
                  return (
                    <tr key={r.id} className="hover:bg-panel-2">
                      <Td><RecordLink code={r.code} /><div className="text-xs text-muted">{r.customer} · {shortDay(r.createdAt)}</div></Td>
                      <Td align="right">{r.due}</Td>
                      <Td align="right">{r.allocated}</Td>
                      <Td align="right">{r.shipped}{r.returned ? <span className="text-xs text-muted"> −{r.returned}</span> : null}</Td>
                      <Td align="right" className={cn(r.invoiced - r.credited !== r.shipped - r.returned && "font-medium text-bad")}>{r.invoiced}{r.credited ? <span className="text-xs text-muted"> −{r.credited}</span> : null}</Td>
                      <Td align="right">{rupees(r.billed)}</Td>
                      <Td align="right" className={cn(r.received > r.billed && "font-medium text-bad")}>{rupees(r.received)}</Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5"><Badge tone={v.tone}>{v.text}</Badge>{r.caseCode && <Link href={`/investigations/${r.caseCode}`}><Badge tone="neutral">{r.caseCode}</Badge></Link>}</div>
                        <div className="mt-0.5"><OrderBadge status={r.status} /></div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          ) : <Empty>Every recent order reconciles.</Empty>}
        </Card>
        <div className="space-y-3">
          <Card>
            <CardHeader title="Open OrderTrace cases" />
            {cases.length ? <ul className="divide-y divide-line">{cases.map((c) => <li key={c.code} className="px-6 py-2.5"><div className="flex items-center justify-between gap-2"><RecordLink code={c.code} /><CaseBadge status={c.status} /></div><div className="text-xs text-muted">{c.title}</div></li>)}</ul> : <Empty>None open.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Unallocated payments" description="Money received that isn't linked to an invoice." />
            {loose.length ? <ul className="divide-y divide-line">{loose.map((p) => <li key={p.code} className="px-6 py-2.5 text-[13px]"><div className="flex justify-between"><span className="font-mono text-[12px]">{p.code}</span><span className="tabular">{rupees(p.amount)}</span></div><div className="text-xs text-muted">{p.customer} · {p.reference} · {shortDay(p.receivedAt)}</div></li>)}</ul> : <Empty>None.</Empty>}
          </Card>
          <Card>
            <CardHeader title="OrderTrace rules" />
            <ul className="space-y-2 px-6 py-4 text-xs">
              {Object.entries(RULES).filter(([, r]) => r.module === "ordertrace").map(([id, r]) => <li key={id}><span className="font-mono">{id}</span> <span className="font-medium">{r.name}</span><div className="text-muted">{r.detects}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
