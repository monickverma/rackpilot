import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertIcon, CalendarIcon, ClockIcon, FileSearchIcon } from "@/components/icons";
import { CaseBadge, OrderBadge } from "@/components/status";
import { Badge, Card, CardHeader, cn, PageHeader, RecordLink, Table, Td, Th } from "@/components/ui";
import { one } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime, day, dueIn, rupees, sizeLabel, when } from "@/lib/format";
import { orderTimeline } from "@/lib/investigate/ordertrace";
import { holders } from "@/lib/ops/orders";
import { orderRecords } from "@/lib/records";
import { OrderActions, ShortageButtons } from "./actions";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string }> }) {
  const s = await requireSession();
  const { code } = await params;
  const { new: justCreated } = await searchParams;
  const o = await one<{ id: number }>(`SELECT id FROM orders WHERE business_id = $1 AND code = $2`, s.businessId, code.toUpperCase());
  if (!o) notFound();
  const rec = (await orderRecords(s.businessId, o.id))!;
  const now = new Date();
  const timeline = orderTimeline(rec);
  const openCase = await one<{ code: string; title: string; status: string }>(
    `SELECT code, title, status FROM investigations WHERE business_id = $1 AND case_key = $2 ORDER BY status IN ('resolved', 'closed'), detected_at DESC LIMIT 1`,
    s.businessId, `order:${o.id}`,
  );
  const shortItems = await Promise.all(rec.items.map(async (i) => {
    const short = i.qtyOrdered - i.qtyCancelled - i.shipped - i.active - i.picked;
    return { ...i, short, heldBy: short > 0 ? await holders(s, i.variantId, o.id) : [] };
  }));
  const st = rec.order.status;
  const closed = st === "completed" || st === "cancelled";
  const openPick = rec.picks.find((p) => p.status === "open");
  const billable = rec.items.map((i) => ({ orderItemId: i.id, sku: i.sku, qty: i.shipped - i.returned - (i.invoiced - i.credited), unitPrice: i.unitPrice })).filter((x) => x.qty > 0);
  const picked = rec.items.filter((i) => i.picked > 0).map((i) => ({ orderItemId: i.id, sku: i.sku, qty: i.picked }));
  const invoices = rec.invoices.filter((i) => i.kind === "invoice").map((i) => ({ id: i.id, code: i.code, total: i.total, paid: rec.payments.filter((p) => p.invoiceId === i.id).reduce((a, p) => a + (p.kind === "receipt" ? p.amount : -p.amount), 0) }));

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5">{rec.order.code} · {rec.order.customerName} <OrderBadge status={st} /></span>}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><ClockIcon size={13} /> {dateTime(rec.order.createdAt)}</span>
            {rec.order.dueAt && <span className="inline-flex items-center gap-1"><CalendarIcon size={13} /> Due {day(rec.order.dueAt)}{!closed && ` · ${dueIn(rec.order.dueAt, now)}`}</span>}
            <span>{rec.order.channel === "voice" ? "Voice note" : rec.order.channel === "document" ? "Document" : rec.order.channel === "message" ? "Message" : "Entered by hand"} · read by {rec.order.extractedBy}</span>
            <span>{rec.order.customerCity} · {rec.order.creditDays}-day credit</span>
          </span>
        }
      />
      {justCreated && (
        <Card className="mb-3 border-l-4 border-ok px-6 py-3 txt-small">
          Order confirmed. {shortItems.some((i) => i.short > 0) ? "Some lines are short: decide below whether to backorder them or ship what's reserved." : "Everything is reserved; create the pick list when you're ready."}
        </Card>
      )}
      {openCase && (
        <Link href={`/investigations/${openCase.code}`} className="mb-3 flex items-center gap-3 rounded-lg bg-bad-soft px-6 py-3 ring-1 ring-bad/30 transition-shadow hover:shadow-card-hover">
          <FileSearchIcon size={16} className="text-bad" />
          <span className="flex-1 text-[13px]"><span className="font-medium">{openCase.code}</span> · {openCase.title}</span>
          <CaseBadge status={openCase.status} />
        </Link>
      )}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card>
            <CardHeader title="Lines" description="Reserved stock comes from free stock only. Short lines wait for your decision; RackPilot doesn't decide for you." />
            <Table>
              <thead><tr><Th>Item</Th><Th align="right">Ordered</Th><Th align="right">Reserved</Th><Th align="right">Picked</Th><Th align="right">Shipped</Th><Th align="right">Short</Th></tr></thead>
              <tbody>
                {shortItems.map((i) => (
                  <tr key={i.id} className="align-top">
                    <Td>
                      <RecordLink code={i.sku} /> <span className="text-muted">· {i.productName}, {i.colour} {sizeLabel(i.size)}</span>
                      <div className="text-xs text-muted">{rupees(i.unitPrice)} each · home bin <Link href={`/stocksleuth?loc=${i.homeLocation}&sku=${i.sku}`} className="font-mono hover:underline">{i.homeLocation}</Link>{i.sourceText ? ` · from “${i.sourceText}”` : ""}</div>
                      {i.qtyCancelled > 0 && <div className="text-xs text-muted">{i.qtyCancelled} not supplied (customer accepted a part shipment)</div>}
                      {i.short > 0 && !closed && (
                        <div className="mt-1.5 space-y-1.5">
                          <div className="flex items-start gap-1.5 text-xs text-bad"><AlertIcon size={13} className="mt-px shrink-0" />
                            <span>Short by {i.short}{i.heldBy.length ? `; the rest is held for ${i.heldBy.map((h) => `${h.code} (${h.customer}, ${h.qty})`).join(", ")}` : "; nothing free on the racks"}.{i.backordered ? " On backorder: it will be reserved when stock arrives." : ""}</span>
                          </div>
                          {can(s, "orders.write") && <ShortageButtons code={rec.order.code} orderItemId={i.id} backordered={i.backordered} />}
                        </div>
                      )}
                    </Td>
                    <Td align="right">{i.qtyOrdered}</Td>
                    <Td align="right">{i.active}</Td>
                    <Td align="right">{i.picked}</Td>
                    <Td align="right">{i.shipped}</Td>
                    <Td align="right">{i.short > 0 ? <span className="font-medium text-bad">{i.short}</span> : <span className="text-faint">0</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader icon={<FileSearchIcon />} title="Reconciliation" description="OrderTrace's view: what each record says for every line. Differences that no backorder, return or credit note explains become findings." />
            <Table>
              <thead><tr><Th>SKU</Th><Th align="right">Ordered</Th><Th align="right">Allocated</Th><Th align="right">Shipped</Th><Th align="right">Returned</Th><Th align="right">Invoiced</Th><Th align="right">Credited</Th><Th>Agrees?</Th></tr></thead>
              <tbody>
                {rec.items.map((i) => {
                  const allocated = i.active + i.picked + i.consumed;
                  const billedNet = i.invoiced - i.credited;
                  const shippedNet = i.shipped - i.returned;
                  const ok = billedNet === shippedNet;
                  return (
                    <tr key={i.id}>
                      <Td><span className="font-mono text-[12px]">{i.sku}</span></Td>
                      <Td align="right">{i.qtyOrdered - i.qtyCancelled}</Td>
                      <Td align="right">{allocated}</Td>
                      <Td align="right">{i.shipped}</Td>
                      <Td align="right">{i.returned}</Td>
                      <Td align="right" className={cn(!ok && "font-medium text-bad")}>{i.invoiced}</Td>
                      <Td align="right">{i.credited}</Td>
                      <Td>{ok ? <Badge tone="ok">Billed = shipped</Badge> : <Badge tone="bad">{shippedNet - billedNet > 0 ? `${shippedNet - billedNet} unbilled` : `${billedNet - shippedNet} overbilled`}</Badge>}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <dl className="grid grid-cols-2 gap-3 border-t border-line px-6 py-4 text-[13px] sm:grid-cols-5">
              <div><dt className="text-xs text-muted">Billed</dt><dd className="font-medium tabular">{rupees(rec.totals.billed)}</dd></div>
              <div><dt className="text-xs text-muted">Credited</dt><dd className="font-medium tabular">{rupees(rec.totals.credited)}</dd></div>
              <div><dt className="text-xs text-muted">Received</dt><dd className="font-medium tabular">{rupees(rec.totals.received)}</dd></div>
              <div><dt className="text-xs text-muted">Refunded</dt><dd className="font-medium tabular">{rupees(rec.totals.refunded)}</dd></div>
              <div><dt className="text-xs text-muted">Outstanding</dt><dd className={cn("font-medium tabular", rec.totals.outstanding < 0 && "text-bad")}>{rupees(rec.totals.outstanding)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Linked records" description="Every reservation, pick list, shipment, invoice, payment and return for this order." />
            <div className="grid gap-px bg-line md:grid-cols-2">
              <Records title="Reservations" rows={rec.reservations.map((r) => [`RES-${r.id}`, `${r.qty} × ${r.sku} at ${r.location}`, r.status + (r.note ? ` · ${r.note}` : "")])} plain />
              <Records title="Pick lists" rows={rec.picks.map((p) => [p.code, `${p.lines.reduce((a, l) => a + (l.qtyPicked ?? 0), 0)} of ${p.lines.reduce((a, l) => a + l.qtyToPick, 0)} picked`, p.status])} />
              <Records title="Shipments" rows={rec.shipments.map((x) => [x.code, `${x.lines.reduce((a, l) => a + l.qty, 0)} units to ${x.customerName}`, when(x.dispatchedAt, now)])} />
              <Records title="Invoices and credit notes" rows={rec.invoices.map((x) => [x.code, `${x.lines.reduce((a, l) => a + l.qty, 0)} units, ${rupees(x.total)}`, `${x.kind === "invoice" ? "invoice" : "credit note"} · ${when(x.issuedAt, now)}`])} />
              <Records title="Payments" rows={rec.payments.map((p) => [p.code, `${p.kind === "refund" ? "−" : ""}${rupees(p.amount)} ${p.method.toUpperCase()} · ${p.reference}`, `${p.invoiceCode ?? "unallocated"} · ${when(p.receivedAt, now)}`])} />
              <Records title="Returns" rows={rec.returns.map((r) => [r.code, r.lines.map((l) => `${l.qty} × ${l.sku} (${l.condition})`).join(", "), `${r.lines.every((l) => l.restocked >= l.qty) ? "restocked" : "not restocked"}`])} />
            </div>
          </Card>
        </div>

        <div className="space-y-3">
          <OrderActions
            code={rec.order.code} status={st} openPick={openPick ? { id: openPick.id, code: openPick.code } : null}
            canPick={rec.items.some((i) => i.active > 0)} picked={picked} billable={billable} invoices={invoices} outstanding={rec.totals.outstanding}
            perms={{ orders: can(s, "orders.write"), warehouse: can(s, "warehouse.write"), billing: can(s, "billing.write") }}
          />
          <Card>
            <CardHeader title="Customer's message" />
            <div className="px-6 py-4">
              <div className="rounded-2xl rounded-tl-sm bg-ok-soft px-4 py-3 text-[14px] leading-6">{rec.order.sourceText || <span className="text-muted">Entered by hand.</span>}</div>
            </div>
          </Card>
          <Card>
            <CardHeader title="Timeline" description="The records in time order." />
            <ol className="space-y-3 px-6 py-4">
              {timeline.map((e, i) => (
                <li key={i} className="grid grid-cols-[52px_1fr] gap-2 text-xs">
                  <span className="text-faint tabular">{when(e.at, now).replace("yesterday ", "yest. ")}</span>
                  <span><span className="font-medium text-fg">{e.label}</span> · <span className="text-muted">{e.detail}</span></span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

function Records({ title, rows, plain }: { title: string; rows: string[][]; plain?: boolean }) {
  return (
    <div className="bg-panel px-6 py-4">
      <h3 className="h3-core">{title}</h3>
      {rows.length ? (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r, i) => (
            <li key={i} className="text-xs">
              {plain ? <span className="font-mono text-[12px]">{r[0]}</span> : <RecordLink code={r[0]} />} <span className="text-fg">{r[1]}</span>
              <div className="text-faint">{r[2]}</div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-xs text-faint">None.</p>}
    </div>
  );
}
