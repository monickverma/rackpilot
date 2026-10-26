import type { Metadata } from "next";
import Link from "next/link";
import { BarList, WeeklyBars } from "@/components/charts";
import { HealthBadge } from "@/components/status";
import { Card, CardHeader, cn, Empty, PageHeader, RecordLink, Stat, Table, Td, Th, tabClass } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { num, pct, round1, rupees, shortDay, units } from "@/lib/format";
import { commitments, dataGaps, rollup, sales, stockoutDays, uncertainty, variantHealth, weeklyTrend } from "@/lib/intel/analytics";
import { backtest } from "@/lib/intel/demand";

export const metadata: Metadata = { title: "Analytics" };

export default async function Analytics({ searchParams }: { searchParams: Promise<{ days?: string; exclude?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const exclude = sp.exclude === "1";
  const [rows, rowsAll, weeks, health, gaps, outs, commit, bt, unsure] = await Promise.all([
    sales(s, days, { excludeOpenCases: exclude }), sales(s, days), weeklyTrend(s, 20), variantHealth(s), dataGaps(s), stockoutDays(s, 90), commitments(s), backtest(s), uncertainty(s),
  ]);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  const cost = rows.reduce((a, r) => a + r.cost, 0);
  const unitsSold = rows.reduce((a, r) => a + r.units, 0);
  const products = rollup(rows, (r) => `${r.productName}`);
  const sizes = rollup(rows, (r) => r.size);
  const colours = rollup(rows, (r) => r.colour);
  const excluded = rowsAll.reduce((a, r) => a + r.revenue, 0) - revenue;
  const stockValue = health.reduce((a, h) => a + h.stockValue, 0);
  const ageing = health.filter((h) => ["dead", "slow", "out-of-season"].includes(h.health)).sort((a, b) => b.stockValue - a.stockValue);
  const outRows = health.filter((h) => (outs.get(h.variantId) ?? 0) > 0 && (h.demand?.ordered90 ?? 0) > 0).map((h) => ({ h, days: outs.get(h.variantId)! })).sort((a, b) => b.days - a.days);
  const link = (patch: Record<string, string>) => `/analytics?${new URLSearchParams({ days: String(days), ...(exclude && { exclude: "1" }), ...patch })}`;
  return (
    <>
      <PageHeader
        title="Sales and inventory analytics"
        description="By variant, not just totals. Units and revenue come from dispatch records at the order's price; margin uses catalogue unit cost (GST excluded). Demand for stock planning uses what customers ordered, so a stockout doesn't hide it."
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {[7, 30, 90].map((d) => <Link key={d} href={link({ days: String(d) })} className={tabClass(days === d)}>{d} days</Link>)}
            <Link href={exclude ? `/analytics?days=${days}` : link({ exclude: "1" })} className={tabClass(exclude)}>{exclude ? "✓ " : ""}Leave out orders under investigation</Link>
          </div>
        }
      />
      {gaps.length > 0 && (
        <Card className="mb-3 border-l-4 border-warn px-6 py-3 text-[13px]">
          <span className="font-medium">Possible missing records:</span> no orders were recorded on {gaps.map((g) => `${shortDay(g.from)}–${shortDay(g.to)} (${g.days} trading days)`).join(", ")}, though the business normally trades then. Sales figures spanning those days may understate demand, and nothing is called dead stock because of them.
        </Card>
      )}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={`Revenue, ${days} days`} value={rupees(revenue)} sub={exclude && excluded ? `${rupees(excluded)} under investigation left out` : `${num(unitsSold)} units dispatched`} />
        <Stat label="Gross margin" value={pct(revenue ? (revenue - cost) / revenue : 0)} sub={rupees(revenue - cost)} tone="ok" />
        <Stat label="Stock at cost" value={rupees(stockValue)} sub={`${units(health.reduce((a, h) => a + h.onHand, 0))} on hand`} />
        <Stat label="Committed" value={units(commit.reservedUnits)} sub={`${rupees(commit.reservedValue)} reserved for ${commit.openOrders} open orders`} tone="accent" />
        <Stat label="Uncertain stock" value={units(unsure.stock.reduce((a, x) => a + x.units, 0))} sub={`${unsure.stock.length} locations under investigation`} tone="warn" href="/stocksleuth" />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Units dispatched per week" description="Last 20 weeks. Hover a bar for the week's numbers." />
          <div className="px-6 pb-4 pt-4">
            <WeeklyBars weeks={weeks} value="units" label={(w) => `Week of ${shortDay(w.start)}: ${num(w.units)} units, ${rupees(w.revenue)}`} />
          </div>
          <details className="border-t border-line px-6 py-3 text-xs"><summary className="cursor-pointer text-muted">Table view</summary>
            <table className="mt-2 w-full tabular"><tbody>{weeks.map((w) => <tr key={w.start.toISOString()}><td className="py-0.5 text-muted">{shortDay(w.start)}</td><td className="text-right">{num(w.units)}</td><td className="text-right">{rupees(w.revenue)}</td></tr>)}</tbody></table>
          </details>
        </Card>
        <Card>
          <CardHeader title="Fastest sizes" description={`Units dispatched, ${days} days.`} />
          <div className="px-6 py-4"><BarList rows={sizes.map((x) => ({ label: x.key, value: x.units, note: pct(unitsSold ? x.units / unitsSold : 0) }))} format={num} /></div>
          <CardHeader title="Fastest colours" />
          <div className="px-6 py-4"><BarList rows={colours.slice(0, 8).map((x) => ({ label: x.key, value: x.units }))} format={num} /></div>
        </Card>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="Best-selling products and designs" description={`${days} days, by units.`} />
          <Table>
            <thead><tr><Th>Product</Th><Th align="right">Units</Th><Th align="right">Revenue</Th><Th align="right">Margin</Th></tr></thead>
            <tbody>{products.slice(0, 10).map((p) => <tr key={p.key}><Td>{p.key}</Td><Td align="right">{num(p.units)}</Td><Td align="right">{rupees(p.revenue)}</Td><Td align="right">{pct(p.marginPct)}</Td></tr>)}</tbody>
          </Table>
          <CardHeader title="Top variants" />
          <Table>
            <thead><tr><Th>SKU</Th><Th align="right">Units</Th><Th align="right">Available</Th><Th align="right">Cover</Th></tr></thead>
            <tbody>{rows.slice(0, 8).map((r) => { const h = health.find((x) => x.variantId === r.variantId); return <tr key={r.variantId}><Td><RecordLink code={r.sku} /></Td><Td align="right">{r.units}</Td><Td align="right">{h?.available ?? 0}</Td><Td align="right">{h?.coverDays === null || !h ? "—" : `${round1(h.coverDays)}d`}</Td></tr>; })}</tbody>
          </Table>
        </Card>
        <div className="space-y-3">
          <Card>
            <CardHeader title="Forecast accuracy (backtest)" description={`${bt.method}, tested on the last ${bt.weeks} weeks of actual orders. Lower is better.`} />
            <dl className="grid grid-cols-2 gap-3 px-6 py-4 text-[13px] sm:grid-cols-4">
              <div><dt className="text-xs text-muted">Per variant and week</dt><dd className="font-medium">{pct(bt.wape)}</dd><dd className="text-xs text-faint">naive: {pct(bt.naiveWape)}</dd></div>
              <div><dt className="text-xs text-muted">Per product and week</dt><dd className="font-medium">{pct(bt.productWape)}</dd><dd className="text-xs text-faint">naive: {pct(bt.productNaiveWape)}</dd></div>
              <div><dt className="text-xs text-muted">Whole business, weekly</dt><dd className="font-medium">{pct(bt.totalWape)}</dd></div>
              <div><dt className="text-xs text-muted">Bias</dt><dd className="font-medium">{bt.bias >= 0 ? "+" : "−"}{pct(Math.abs(bt.bias))}</dd><dd className="text-xs text-faint">{bt.bias < 0 ? "runs low" : "runs high"}</dd></div>
            </dl>
            <p className="border-t border-line px-6 py-3 text-xs text-muted">Weighted absolute percentage error (WAPE). &quot;Naive&quot; repeats last week. Wholesale orders arrive in lumps, so single variants are hard to forecast; purchasing rounds to packs and reviews weekly. Seasonality isn&apos;t modelled: there isn&apos;t a year of history yet.</p>
          </Card>
          <Card>
            <CardHeader title="Stockout frequency" description="Days in the last 90 with no sellable stock, for variants customers ordered." />
            {outRows.length ? (
              <Table>
                <thead><tr><Th>SKU</Th><Th align="right">Days out</Th><Th align="right">Ordered 90d</Th></tr></thead>
                <tbody>{outRows.slice(0, 8).map(({ h, days: d }) => <tr key={h.variantId}><Td><RecordLink code={h.sku} /></Td><Td align="right" className={cn(d > 10 && "text-bad")}>{d}</Td><Td align="right">{h.demand?.ordered90 ?? 0}</Td></tr>)}</tbody>
              </Table>
            ) : <Empty>No stockouts in 90 days.</Empty>}
          </Card>
        </div>
      </div>
      <Card className="mt-3">
        <CardHeader title="Slow-moving and ageing stock" description="Valued at cost. Out-of-season stock is held back, not called dead; new products are 'too new to judge'." />
        {ageing.length ? (
          <Table>
            <thead><tr><Th>SKU</Th><Th>Status</Th><Th align="right">On hand</Th><Th align="right">Value at cost</Th><Th align="right">Days since ordered</Th><Th align="right">Ordered 28d</Th><Th align="right">Product age</Th></tr></thead>
            <tbody>{ageing.slice(0, 20).map((h) => <tr key={h.variantId}><Td><RecordLink code={h.sku} /> <span className="text-xs text-muted">{h.productName}</span></Td><Td><HealthBadge health={h.health} /></Td><Td align="right">{h.onHand}</Td><Td align="right">{rupees(h.stockValue)}</Td><Td align="right">{h.daysSinceOrder ?? "never"}</Td><Td align="right">{h.demand?.ordered28 ?? 0}</Td><Td align="right">{Math.floor(h.ageDays)}d</Td></tr>)}</tbody>
          </Table>
        ) : <Empty>Nothing is ageing.</Empty>}
        <p className="border-t border-line px-6 py-3 text-xs text-muted">{health.filter((h) => h.health === "too-new").length} variants are too new to judge (launched under 28 days ago). Total ageing value: {rupees(ageing.reduce((a, h) => a + h.stockValue, 0))}.</p>
      </Card>
    </>
  );
}
