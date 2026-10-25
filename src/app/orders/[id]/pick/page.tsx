import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Fragment, Suspense } from "react";
import { PrintButton } from "@/components/action-form";
import { Card, CardSkeleton, Mono, Swatch } from "@/components/ui";
import { colourDot, dateTime, dueDay } from "@/lib/format";
import { pickList } from "@/lib/orders";

export const metadata: Metadata = { title: "Pick list" };

export default function PickPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<CardSkeleton rows={6} />}>
      <Pick params={params} />
    </Suspense>
  );
}

async function Pick({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection();
  const data = /^\d+$/.test(id) ? pickList(Number(id)) : null;
  if (!data) notFound();
  const { order, items, missing } = data;
  const racks = [...new Set(items.map((i) => i.location.split("-")[0]))];
  const total = items.reduce((a, i) => a + i.qty, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href={`/orders/${order.id}`} className="text-[13px] text-muted hover:text-fg">← Back to {order.code}</Link>
        <PrintButton />
      </div>
      <Card className="print-plain p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Pick list · Rang Mahal Garments</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{order.code} · {order.customerName}</h1>
            <p className="mt-1 text-[13px] text-muted">
              Ordered {dateTime(order.createdAt)}
              {order.dueAt && ` · due ${dueDay(order.dueLabel, order.dueAt)}`}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold">{total}</div>
            <div className="text-xs text-muted">pcs from {racks.length} rack{racks.length === 1 ? "" : "s"}</div>
          </div>
        </header>

        {items.length ? (
          <table className="mt-5 w-full text-left text-[14px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="w-8 py-2" />
                <th className="py-2 font-medium">Bin</th>
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Size</th>
                <th className="py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {racks.map((rack) => (
                <Fragment key={rack}>
                  <tr>
                    <td colSpan={5} className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-accent">Rack {rack.slice(1)}</td>
                  </tr>
                  {items.filter((i) => i.location.startsWith(`${rack}-`)).map((i) => (
                    <tr key={i.lineId} className="border-t border-line">
                      <td className="py-3">
                        <span className="block size-4 rounded border-2 border-line-strong" />
                      </td>
                      <td className="py-3 font-mono text-[13px] font-semibold">{i.location}</td>
                      <td className="py-3">
                        <div className="font-medium">{i.productName}</div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          <Mono>{i.sku}</Mono>
                          <Swatch colour={i.colour} hex={colourDot(i.colour)} />
                        </div>
                      </td>
                      <td className="py-3 font-semibold">{i.size === "FREE" ? "Free" : i.size}</td>
                      <td className="py-3 text-right text-lg font-semibold">{i.qty}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-8 text-center text-sm text-muted">Nothing is reserved for this order, so there is nothing to pick.</p>
        )}

        {(missing.length > 0 || items.some((i) => i.shortBy > 0)) && (
          <div className="mt-6 rounded-lg border border-bad/30 bg-bad-soft p-4 text-[13px]">
            <div className="font-semibold text-bad">Not available. Tell the customer.</div>
            <ul className="mt-1.5 space-y-1">
              {items.filter((i) => i.shortBy > 0).map((i) => (
                <li key={i.lineId}>{i.sku}: {i.shortBy} more asked than reserved</li>
              ))}
              {missing.map((l) => (
                <li key={l.id}>
                  {l.sku ? `${l.sku} (${l.colour} ${l.size === "FREE" ? "free size" : l.size})` : `“${l.sourceText}”`} × {l.qtyRequested} · {l.note ?? "not matched"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="mt-8 grid grid-cols-2 gap-6 border-t border-line pt-5 text-xs text-muted">
          <div>Picked by ____________________</div>
          <div>Checked by ____________________</div>
        </footer>
      </Card>
    </div>
  );
}
