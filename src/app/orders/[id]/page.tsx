import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { cancelOrderAction, fulfilOrderAction, recheckOrderAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AlertIcon, CalendarIcon, ClockIcon, PrinterIcon, ScrollIcon } from "@/components/icons";
import { MovementTable } from "@/components/movement-table";
import { LineBadge, OrderBadge, SeverityBadge } from "@/components/status";
import { Badge, ButtonLink, Card, CardHeader, CardSkeleton, Location, Mono, PageHeader, Swatch, Table, Td, Th } from "@/components/ui";
import { colourDot, dateTime, dueDay, dueIn, plural } from "@/lib/format";
import { insights } from "@/lib/inventory";
import { getOrder } from "@/lib/orders";

export const metadata: Metadata = { title: "Order" };

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<CardSkeleton rows={6} />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const order = /^\d+$/.test(id) ? getOrder(Number(id)) : null;
  if (!order) notFound();
  const now = new Date();
  const open = order.status === "confirmed";
  const variantIds = new Set(order.detail.map((l) => l.variantId));
  const alerts = open ? insights(now).low.filter((f) => variantIds.has(f.row.variantId)) : [];
  const toPick = order.detail.reduce((a, l) => a + (l.status === "reserved" || l.status === "short" ? l.qtyReserved : 0), 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link href="/orders" className="hover:text-fg">Orders</Link> / <Mono>{order.code}</Mono>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {order.customerName} <OrderBadge status={order.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><ClockIcon size={13} /> {dateTime(order.createdAt)}</span>
            {order.dueAt && (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon size={13} /> Due {dueDay(order.dueLabel, order.dueAt)}{open && ` · ${dueIn(order.dueAt, now.getTime())}`}
              </span>
            )}
            <span>Read by {order.parser === "claude" ? "Claude (fallback)" : "rules"}</span>
          </span>
        }
        actions={
          open && (
            <>
              <ButtonLink href={`/orders/${order.id}/pick`} variant="secondary">
                <PrinterIcon size={15} /> Pick list
              </ButtonLink>
              {order.shortLines > 0 && (
                <ActionForm action={recheckOrderAction} hidden={{ orderId: order.id }}>
                  <SubmitButton pendingText="Checking…">Re-check stock</SubmitButton>
                </ActionForm>
              )}
              <ActionForm action={fulfilOrderAction} hidden={{ orderId: order.id }} confirm={`Hand over ${toPick} pcs and record the sale?`}>
                <SubmitButton variant="primary" pendingText="Recording…">Mark fulfilled</SubmitButton>
              </ActionForm>
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Lines" description="Each line was reserved from free stock (on hand minus what other orders hold) when the order was confirmed." />
            <Table>
              <thead>
                <tr>
                  <Th>Item</Th>
                  <Th>Rack</Th>
                  <Th align="right">Asked</Th>
                  <Th align="right">{open ? "Reserved" : "Supplied"}</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {order.detail.map((l) => (
                  <tr key={l.id} className="align-top">
                    <Td>
                      {l.sku ? (
                        <>
                          <Link href={`/inventory/${l.sku}`} className="font-medium hover:underline">{l.productName}</Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <Mono>{l.sku}</Mono>
                            <Swatch colour={l.colour!} hex={colourDot(l.colour!)} />
                            <span>{l.size === "FREE" ? "Free size" : l.size}</span>
                          </div>
                        </>
                      ) : (
                        <span className="font-medium">Not matched</span>
                      )}
                      <div className="mt-1 text-xs text-muted">
                        From “<span className="text-fg">{l.sourceText}</span>”{l.matchNote ? ` · ${l.matchNote}` : ""}
                      </div>
                      {l.note && (
                        <div className="mt-1.5 flex items-start gap-1.5 text-xs text-bad">
                          <AlertIcon size={13} className="mt-px shrink-0" />
                          <span>
                            {l.note}
                            {l.holders.length > 0 && (
                              <span className="ml-1 text-muted">
                                {l.holders.map((h, i) => (
                                  <span key={h.lineId}>
                                    {i > 0 && ", "}
                                    <Link href={`/orders/${h.orderId}`} className="underline underline-offset-2 hover:text-fg">Open {h.orderCode}</Link>
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </Td>
                    <Td>{l.location ? <Location code={l.location} /> : "—"}</Td>
                    <Td align="right">{l.qtyRequested}</Td>
                    <Td align="right" className="font-medium">{open ? l.qtyReserved : l.qtyFulfilled}</Td>
                    <Td><LineBadge status={l.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer's message" />
            <div className="p-5">
              <div className="relative rounded-2xl rounded-tl-sm bg-ok-soft px-4 py-3 text-[14px] leading-6 text-fg">
                {order.rawMessage}
                <div className="mt-1 text-right text-[11px] text-muted">{dateTime(order.createdAt)}</div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <dt className="text-xs text-muted">Pieces asked</dt>
                  <dd className="font-medium">{order.units}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{open ? "Reserved now" : "Closed"}</dt>
                  <dd className="font-medium">{open ? order.reservedUnits : order.closedAt ? dateTime(order.closedAt) : "—"}</dd>
                </div>
              </dl>
            </div>
          </Card>

          {alerts.length > 0 && (
            <Card className="border-bad/30">
              <CardHeader icon={<AlertIcon />} title="Stock alerts from this order" description="Free stock left after reserving, against supplier lead time." />
              <ul className="divide-y divide-line">
                {alerts.map((f) => (
                  <li key={f.row.variantId} className="px-5 py-3 text-xs">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Link href={`/inventory/${f.row.sku}`} className="text-[13px] font-medium hover:underline"><Mono>{f.row.sku}</Mono></Link>
                      <SeverityBadge severity={f.severity} />
                    </div>
                    <p className="text-muted">{f.evidence}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {open && (
            <Card>
              <CardHeader title="Cancel" description={`Puts ${plural(order.reservedUnits, "reserved piece")} back on sale with release rows in the ledger.`} />
              <div className="p-5">
                <ActionForm action={cancelOrderAction} hidden={{ orderId: order.id }} confirm="Cancel this order and release its stock?">
                  <SubmitButton variant="danger" size="sm" pendingText="Cancelling…">Cancel order</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          )}
          {!open && <Badge tone="neutral">This order is closed; its rows stay in the ledger.</Badge>}
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader
          icon={<ScrollIcon />}
          title="Ledger rows for this order"
          description="The stock movements this order wrote. On-hand and reserved change only through these."
          action={<ButtonLink href={`/ledger?order=${order.id}`} size="sm" variant="ghost">Open in ledger</ButtonLink>}
        />
        <MovementTable rows={order.movements} showOrder={false} />
      </Card>
    </>
  );
}
