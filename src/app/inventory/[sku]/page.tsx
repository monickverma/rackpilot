import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { counterSaleAction, countAction, receiveAction } from "@/app/actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AlertIcon, HourglassIcon, ScrollIcon } from "@/components/icons";
import { MovementTable } from "@/components/movement-table";
import { SeverityBadge } from "@/components/status";
import { Card, CardHeader, CardSkeleton, cn, inputClass, Location, Mono, PageHeader, Stat, Swatch } from "@/components/ui";
import { colourDot, dueDay, rupees } from "@/lib/format";
import { holdsOn, insights, siblings, stockCard, variantBySku } from "@/lib/inventory";

export const metadata: Metadata = { title: "Stock card" };

export default function VariantPage({ params }: { params: Promise<{ sku: string }> }) {
  return (
    <Suspense fallback={<CardSkeleton rows={8} />}>
      <Variant params={params} />
    </Suspense>
  );
}

async function Variant({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  await connection();
  const v = variantBySku(decodeURIComponent(sku));
  if (!v) notFound();
  const now = new Date();
  const ins = insights(now);
  const stats = ins.stats.get(v.id);
  const low = ins.low.find((f) => f.row.variantId === v.id);
  const dead = ins.dead.find((f) => f.row.variantId === v.id);
  const holds = holdsOn(v.id);
  const card = stockCard(v.id);
  const family = siblings(v.productId);
  const colours = [...new Set(family.map((f) => f.colour))];
  const sizes = [...new Set(family.map((f) => f.size))];
  const free = v.onHand - v.reserved;
  const rate = (stats?.sold30 ?? 0) / 30;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link href="/inventory" className="hover:text-fg">Inventory</Link> / <Mono>{v.sku}</Mono>
          </span>
        }
        title={v.productName}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <Swatch colour={v.colour} hex={colourDot(v.colour)} />
            <span>{v.size === "FREE" ? "Free size" : `Size ${v.size}`}</span>
            <Location code={v.location} />
            <span>{v.supplierName} · {v.leadTimeDays}-day lead · packs {v.packRatio}</span>
            <span>{rupees(v.costPrice)} cost / {rupees(v.sellPrice)} price</span>
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On hand" value={v.onHand} sub="on the rack" />
        <Stat label="Reserved" value={v.reserved} sub={`${holds.length} open order${holds.length === 1 ? "" : "s"}`} />
        <Stat label="Free to sell" value={free} sub={rate ? `${(free / rate).toFixed(1)} days of cover` : "no recent sales"} tone={low ? "bad" : "ok"} />
        <Stat label="Sold, 30 days" value={stats?.sold30 ?? 0} sub={`${rate.toFixed(2)} a day`} href={`/ledger?sku=${v.sku}&type=sale&days=30`} />
      </div>

      {(low || dead) && (
        <Card className={cn("mt-6", low ? "border-bad/30" : "border-warn/30")}>
          <div className="flex gap-3 p-5 text-[13px]">
            {low ? <AlertIcon size={18} className="shrink-0 text-bad" /> : <HourglassIcon size={18} className="shrink-0 text-warn" />}
            <div>
              <div className="mb-1 flex items-center gap-2 font-medium">
                {low ? <>Low stock <SeverityBadge severity={low.severity} /></> : "Dead stock"}
              </div>
              <p className="text-muted">{low?.evidence ?? dead?.evidence}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Held for open orders" />
          {holds.length ? (
            <ul className="divide-y divide-line">
              {holds.map((h) => (
                <li key={h.lineId} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                  <Link href={`/orders/${h.orderId}`} className="hover:underline">
                    <Mono>{h.orderCode}</Mono> · {h.customerName}
                  </Link>
                  <span className="text-muted">
                    {h.qty} pc{h.qty === 1 ? "" : "s"}{h.dueAt ? ` · due ${dueDay(h.dueLabel, h.dueAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-4 text-[13px] text-muted">Nothing reserved.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Record a change" description="Each one adds a ledger row." />
          <div className="space-y-5 p-5">
            <ActionForm action={receiveAction} hidden={{ variantId: v.id }}>
              <div className="mb-1.5 text-[13px] font-medium">Receive delivery</div>
              <div className="flex gap-2">
                <input name="qty" type="number" min={1} max={500} required placeholder="Qty" className={cn(inputClass, "w-20")} />
                <input name="ref" placeholder="PO or bill no." maxLength={40} className={inputClass} />
                <SubmitButton size="md" pendingText="…">Add</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={countAction} hidden={{ variantId: v.id }}>
              <div className="mb-1.5 text-[13px] font-medium">Stock count</div>
              <div className="flex gap-2">
                <input name="counted" type="number" min={0} max={5000} required placeholder={`${v.onHand}`} className={cn(inputClass, "w-20")} />
                <input name="note" placeholder="Note (optional)" maxLength={120} className={inputClass} />
                <SubmitButton size="md" pendingText="…">Set</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={counterSaleAction} hidden={{ variantId: v.id }}>
              <div className="mb-1.5 text-[13px] font-medium">Counter sale</div>
              <div className="flex gap-2">
                <input name="qty" type="number" min={1} max={500} required placeholder="Qty" className={cn(inputClass, "w-20")} />
                <SubmitButton size="md" pendingText="…">Sell</SubmitButton>
              </div>
              <p className="mt-1 text-xs text-muted">Only free stock can be sold; reserved pieces are held.</p>
            </ActionForm>
          </div>
        </Card>

        <Card>
          <CardHeader title={`${v.productCode} sizes and colours`} description="Free stock per variant." />
          <div className="overflow-x-auto p-4">
            <table className="w-full text-center text-[12px]">
              <thead>
                <tr className="text-muted">
                  <th />
                  {sizes.map((s) => (
                    <th key={s} className="px-1 pb-1.5 font-medium">{s === "FREE" ? "FS" : s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {colours.map((c) => (
                  <tr key={c}>
                    <td className="pr-2 text-left"><Swatch colour={c} hex={colourDot(c)} /></td>
                    {sizes.map((s) => {
                      const f = family.find((x) => x.colour === c && x.size === s);
                      if (!f) return <td key={s} />;
                      const n = f.onHand - f.reserved;
                      return (
                        <td key={s} className="p-0.5">
                          <Link
                            href={`/inventory/${f.sku}`}
                            className={cn(
                              "block rounded-md border py-1 tabular",
                              f.id === v.id ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line hover:border-line-strong",
                              n <= 0 && f.id !== v.id && "text-bad",
                            )}
                          >
                            {n}
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          icon={<ScrollIcon />}
          title="Stock card"
          description={`Every movement for this SKU, newest first. "After" is on hand / reserved once the row applied; the top row equals the totals above.`}
        />
        <MovementTable rows={card.rows.slice(0, 150)} showSku={false} balances={card.balances} />
        {card.rows.length > 150 && <p className="px-5 py-3 text-xs text-muted">Showing the latest 150 of {card.rows.length} rows.</p>}
      </Card>
    </>
  );
}
