import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertIcon, ArrowRightIcon, CalendarIcon, ClipboardIcon, HourglassIcon, LeafIcon, MessagePlusIcon, ShieldCheckIcon, TrendingIcon, TruckIcon } from "@/components/icons";
import { SeverityBadge } from "@/components/status";
import { Badge, ButtonLink, Card, CardHeader, CardSkeleton, Empty, Location, Mono, PageHeader, Skeleton, Stat, Swatch, Table, Td, Th } from "@/components/ui";
import { WeeklyChart } from "@/components/weekly-chart";
import { colourDot, dueDay, dueIn, plural, rupees, shortDay } from "@/lib/format";
import { SEASONS } from "@/lib/insights";
import { insights, reconcile, weeklySales } from "@/lib/inventory";
import { listOrders } from "@/lib/orders";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Rang Mahal Garments · Indore"
        title="Today at the shop"
        description="Open WhatsApp orders, stock that will run out before a delivery can arrive, and money sitting on the racks. Every number links to the ledger rows behind it."
        actions={
          <ButtonLink href="/orders/new" variant="primary">
            <MessagePlusIcon size={15} /> New WhatsApp order
          </ButtonLink>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px]" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CardSkeleton rows={5} />
        </div>
        <CardSkeleton rows={4} />
      </div>
    </div>
  );
}

const istDate = (iso: string, end = false) => new Date(`${iso}T${end ? "23:59:59" : "00:00:00"}+05:30`).getTime();

async function Dashboard() {
  await connection();
  const now = new Date();
  const ins = insights(now);
  const open = listOrders("confirmed");
  const check = reconcile();
  const weeks = weeklySales(now, 26);
  const bands = Object.values(SEASONS).flatMap((s) => s.windows.map(([a, b]) => ({ label: s.label, start: istDate(a), end: istDate(b, true) })));

  let units30 = 0;
  let revenue30 = 0;
  for (const r of ins.rows) {
    const sold = ins.stats.get(r.variantId)?.sold30 ?? 0;
    units30 += sold;
    revenue30 += sold * r.sellPrice;
  }
  const out = ins.low.filter((f) => f.severity === "out").length;
  const deadValue = ins.deadGroups.reduce((a, g) => a + g.valueAtCost, 0);
  const deadUnits = ins.deadGroups.reduce((a, g) => a + g.units, 0);
  const reservedUnits = open.reduce((a, o) => a + o.reservedUnits, 0);
  const shortLines = open.reduce((a, o) => a + o.shortLines, 0);
  const healthy = check.ledgerMismatches.length === 0 && check.reservationMismatches.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open orders" value={open.length} sub={`${plural(reservedUnits, "unit")} reserved${shortLines ? ` · ${plural(shortLines, "line")} short` : ""}`} href="/orders" icon={<ClipboardIcon />} tone="accent" />
        <Stat label="Low stock" value={ins.low.length} sub={`${out} out of stock`} href="#low-stock" icon={<AlertIcon />} tone={ins.low.length ? "bad" : "ok"} />
        <Stat label="Dead stock at cost" value={rupees(deadValue)} sub={`${plural(deadUnits, "unit")}, no sale in 60+ days`} href="#dead-stock" icon={<HourglassIcon />} tone="warn" />
        <Stat label="Sold, last 30 days" value={units30.toLocaleString("en-IN")} sub={`${rupees(revenue30)} at list price`} href="/ledger?type=sale&days=30" icon={<TrendingIcon />} tone="ok" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card id="low-stock" className="xl:col-span-2">
          <CardHeader
            icon={<AlertIcon />}
            title="Will run out before a delivery"
            description="Free stock (on hand minus reserved) divided by the last 30 days' sales, against the supplier's lead time."
          />
          {ins.low.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th>Rack</Th>
                  <Th align="right">Free</Th>
                  <Th align="right">Sold 30d</Th>
                  <Th align="right">Cover</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {ins.low.slice(0, 8).map((f) => (
                  <tr key={f.row.variantId} className="hover:bg-panel-2/50">
                    <Td>
                      <Link href={`/inventory/${f.row.sku}`} className="font-medium hover:underline">
                        {f.row.productName}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                        <Mono>{f.row.sku}</Mono>
                        <Swatch colour={f.row.colour} hex={colourDot(f.row.colour)} />
                        <span>{f.row.size === "FREE" ? "Free size" : f.row.size}</span>
                      </div>
                    </Td>
                    <Td><Location code={f.row.location} /></Td>
                    <Td align="right">
                      {Math.max(f.available, 0)}
                      {f.row.reserved > 0 && <div className="text-[11px] text-muted">{f.row.reserved} held</div>}
                    </Td>
                    <Td align="right">
                      <Link href={`/ledger?sku=${f.row.sku}&type=sale&days=30`} className="underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                        {f.sold30}
                      </Link>
                    </Td>
                    <Td align="right">
                      <span className="font-medium">{f.daysOfCover.toFixed(1)}d</span>
                      <div className="text-[11px] text-muted">lead {f.row.leadTimeDays}d</div>
                    </Td>
                    <Td><SeverityBadge severity={f.severity} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>Nothing will run out before the next delivery could arrive.</Empty>
          )}
          {ins.low.length > 8 && (
            <div className="px-5 py-3 text-xs">
              <Link href="/inventory?flag=low" className="text-accent hover:underline">See all {ins.low.length} →</Link>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<ClipboardIcon />}
            title="Open orders"
            description="Reserved stock waiting to be picked."
            action={<ButtonLink href="/orders" size="sm" variant="ghost">All <ArrowRightIcon size={13} /></ButtonLink>}
          />
          {open.length ? (
            <ul className="divide-y divide-line">
              {open.slice(0, 6).map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="block px-5 py-3 transition-colors hover:bg-panel-2/50">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{o.customerName}</span>
                      <Mono className="text-muted">{o.code}</Mono>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span>{plural(o.units, "piece")}</span>
                      {o.dueAt && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarIcon size={12} /> {dueDay(o.dueLabel, o.dueAt)} · {dueIn(o.dueAt, now.getTime())}
                        </span>
                      )}
                      {o.shortLines > 0 && <Badge tone="bad">{o.shortLines} short</Badge>}
                      {o.unmatchedLines > 0 && <Badge tone="warn">{o.unmatchedLines} unmatched</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No open orders.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={<TruckIcon />}
            title="Reorder suggestions"
            description="Enough to cover lead time plus 14 days at the last 30 days' rate, in the supplier's size-set packs."
          />
          {ins.reorder.length ? (
            <ul className="divide-y divide-line">
              {ins.reorder.slice(0, 5).map((r) => (
                <li key={`${r.productId}-${r.colour}`} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-medium">{r.productName}</span>
                      <Swatch colour={r.colour} hex={colourDot(r.colour)} />
                    </div>
                    <div className="text-[13px] tabular">
                      <span className="font-semibold">{plural(r.units, "pc", "pcs")}</span>
                      <span className="text-muted"> · {rupees(r.costEstimate)} at cost</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.lines.map((l) => (
                      <Link
                        key={l.row.variantId}
                        href={`/inventory/${l.row.sku}`}
                        title={`${l.available} free, sold ${l.sold30} in 30 days`}
                        className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] tabular hover:border-line-strong"
                      >
                        <span className="text-muted">{l.row.size === "FREE" ? "FS" : l.row.size}</span>
                        <span className="font-medium">+{l.qty}</span>
                      </Link>
                    ))}
                    <span className="text-[11px] text-muted">
                      {r.supplierName} · {r.leadTimeDays}-day lead{r.packs ? ` · ${plural(r.packs, "pack")} of ${r.packRatio}` : ""}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{r.evidence}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No reorders needed today.</Empty>
          )}
        </Card>

        <Card id="dead-stock">
          <CardHeader icon={<HourglassIcon />} title="Dead stock" description="On the rack 60+ days with no sale. Money tied up, at cost." />
          {ins.deadGroups.length ? (
            <ul className="divide-y divide-line">
              {ins.deadGroups.slice(0, 6).map((g) => (
                <li key={g.productId} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/inventory?q=${g.productCode}`} className="font-medium hover:underline">{g.productName}</Link>
                    <span className="font-semibold tabular">{rupees(g.valueAtCost)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Location code={g.location} />
                    <span>{plural(g.units, "pc", "pcs")}</span>
                    <span>· idle {g.daysIdle}+ days</span>
                    {g.neverSold && <Badge tone="warn">never sold</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing has sat for 60 days.</Empty>
          )}
          {ins.holds.map((h) => (
            <div key={h.productId} className="m-4 mt-0 flex gap-2.5 rounded-lg border border-line bg-panel-2 p-3 text-xs">
              <LeafIcon size={14} className="mt-0.5 shrink-0 text-ok" />
              <p>
                <span className="font-medium">{h.seasonLabel} is over</span> (ended {shortDay(h.seasonEnded.getTime())}).{" "}
                <Link href={`/inventory?q=${h.productCode}`} className="underline underline-offset-2">{h.productName}</Link> has {plural(h.units, "pc", "pcs")} left ({rupees(h.valueAtCost)} at cost). Hold it; RackPilot won&apos;t suggest a reorder.
              </p>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={<TrendingIcon />} title="Units sold per week" description="Counter and WhatsApp sales from the ledger, last 26 weeks." />
          <div className="px-5 pb-4 pt-5">
            <WeeklyChart weeks={weeks} bands={bands} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Best sellers" description="Last 30 days, by units." />
          <ol className="divide-y divide-line">
            {ins.best.slice(0, 6).map((b, i) => (
              <li key={b.productId} className="flex items-start gap-3 px-5 py-2.5">
                <span className="mt-0.5 w-4 text-xs text-faint tabular">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/inventory?q=${b.productCode}`} className="truncate font-medium hover:underline">{b.productName}</Link>
                    <span className="tabular">{b.units}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {b.topVariants.map((t) => `${t.colour} ${t.size === "FREE" ? "FS" : t.size}`).join(" · ")}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Link
        href="/ledger"
        className={`flex items-center gap-3 rounded-xl border px-5 py-3.5 text-[13px] transition-colors ${healthy ? "border-line bg-panel hover:border-line-strong" : "border-bad/40 bg-bad-soft"}`}
      >
        <ShieldCheckIcon size={18} className={healthy ? "text-ok" : "text-bad"} />
        <span className="flex-1">
          {healthy ? (
            <>
              <span className="font-medium">Ledger reconciles.</span> All {check.variants} variants rebuild exactly from {check.movements.toLocaleString("en-IN")} stock movements, and reserved stock equals what open orders hold.
            </>
          ) : (
            <>
              <span className="font-medium">Ledger mismatch:</span> {check.ledgerMismatches.length + check.reservationMismatches.length} variants differ from their ledger. Open the ledger to see which.
            </>
          )}
        </span>
        <ArrowRightIcon size={14} className="text-muted" />
      </Link>
    </div>
  );
}
