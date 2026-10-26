import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, cn, Empty, PageHeader, RecordLink, Stat, Table, Td, Th } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime, pct, round1, rupees, units } from "@/lib/format";
import { getPlan } from "@/lib/intel/plan";
import { PlanDecision } from "../forms";

export const metadata: Metadata = { title: "Purchase plan" };

export default async function PlanPage({ params }: { params: Promise<{ code: string }> }) {
  const s = await requireSession();
  const plan = await getPlan(s, (await params).code);
  if (!plan) notFound();
  const p = plan.output;
  const unitsPlanned = p.lines.reduce((a, l) => a + l.qty, 0);
  const waiting = p.atRisk.reduce((a, r) => a + r.short, 0);
  const covered = p.atRisk.reduce((a, r) => a + r.covered, 0);
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2.5">Plan {plan.code} <Badge tone={plan.status === "approved" ? "ok" : plan.status === "rejected" ? "neutral" : "accent"}>{plan.status}</Badge></span>}
        description={`Made ${dateTime(plan.createdAt)} by ${plan.createdBy}${plan.decidedBy ? `; ${plan.status} by ${plan.decidedBy}` : ""}. A proposal from the records, not a guaranteed forecast.`}
        actions={plan.status === "proposed" ? <PlanDecision code={plan.code} allowed={can(s, "purchasing.approve")} /> : undefined}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budget" value={rupees(p.budget)} sub="Hard limit" />
        <Stat label="Used" value={rupees(p.used)} sub={`${units(unitsPlanned)} on ${p.lines.length} lines`} tone="accent" />
        <Stat label="Remaining" value={rupees(p.remaining)} sub="Not enough for another pack that is needed" />
        <Stat label="Orders that could run short" value={new Set(p.atRisk.map((r) => r.orderCode)).size} sub={`${units(covered)} of ${units(waiting)} covered by this plan`} tone={waiting > covered ? "warn" : "ok"} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-3">
          <Card>
            <CardHeader title="Recommended purchases" description="Funded in priority order: customers already waiting, then stock that runs out before a delivery could arrive, then stock below target. Best margin per rupee first within each." />
            {p.lines.length ? (
              <ul className="divide-y divide-line">
                {p.lines.map((l) => (
                  <li key={l.variantId} className="px-6 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <RecordLink code={l.sku} /> <span className="text-muted">{l.productName}</span>
                        <Badge tone={l.tier === 1 ? "bad" : l.tier === 2 ? "warn" : "neutral"}>{l.tierLabel}</Badge>
                        {l.partial && <Badge tone="neutral">partly funded</Badge>}
                        {l.toppedUp && <Badge tone="neutral">topped up for minimum order</Badge>}
                        {l.uncertain > 0 && <Badge tone="warn">{l.uncertain} under investigation</Badge>}
                      </div>
                      <div className="text-[13px] tabular"><span className="font-medium">{l.qty} units</span> <span className="text-muted">· {l.packs} × {l.packSize} · {rupees(l.cost)}</span></div>
                    </div>
                    <p className="mt-1 text-xs text-muted">{l.evidence}</p>
                    <p className="mt-0.5 text-xs text-faint">{l.supplier} · cover now {l.coverDays === null ? "—" : `${round1(l.coverDays)} days`} · margin {rupees(l.marginPerUnit)}/unit ({pct(l.marginPerUnit / l.unitCost)} on cost)</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing needs buying within this budget.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Not ordered, and why" description="Products held back on purpose, and needs this budget doesn't reach." />
            {p.notOrdered.length ? (
              <Table>
                <thead><tr><Th>SKU</Th><Th>Reason</Th></tr></thead>
                <tbody>{p.notOrdered.slice(0, 30).map((x, i) => <tr key={i}><Td className="align-top"><RecordLink code={x.sku} /><div className="text-xs text-muted">{x.productName}</div></Td><Td className="text-xs text-muted"><Badge tone={x.kind === "budget" ? "warn" : x.kind === "moq" ? "accent" : "neutral"} className="mr-1.5">{x.kind}</Badge>{x.reason}</Td></tr>)}</tbody>
              </Table>
            ) : <Empty>Nothing held back.</Empty>}
          </Card>
        </div>
        <div className="space-y-3">
          <Card>
            <CardHeader title="By supplier" description="Minimum order quantities are enforced; a supplier that can't reach its minimum is dropped." />
            <ul className="divide-y divide-line">{p.suppliers.map((x) => <li key={x.id} className="px-6 py-2.5 text-[13px]"><div className="flex justify-between gap-2"><span className="font-medium">{x.name}</span><span className="tabular">{rupees(x.cost)}</span></div><div className="text-xs text-muted">{units(x.units)} · minimum {x.moq} · {x.leadTime}-day lead · <span className={cn(x.status === "dropped" && "text-warn")}>{x.status === "ok" ? "minimum met" : x.status === "topped-up" ? "topped up to the minimum" : "below minimum, dropped"}</span></div></li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Orders that could run short" />
            {p.atRisk.length ? <ul className="divide-y divide-line">{p.atRisk.slice(0, 12).map((r, i) => <li key={i} className="px-6 py-2.5 text-xs"><div className="flex justify-between gap-2"><span><RecordLink code={r.orderCode} /> {r.customer}</span><span className={cn(r.covered < r.short ? "text-warn" : "text-ok")}>{r.covered}/{r.short}</span></div><div className="text-muted">{r.sku}{r.arrivesInDays !== null ? ` · stock in ~${r.arrivesInDays} days` : " · nothing on order"}</div></li>)}</ul> : <Empty>No open order is short.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Assumptions" />
            <ul className="list-disc space-y-1.5 px-6 py-4 pl-10 text-xs text-muted">{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </Card>
          <Card>
            <CardHeader title="Risks and uncertainty" />
            <ul className="list-disc space-y-1.5 px-6 py-4 pl-10 text-xs text-muted">{p.risks.map((a) => <li key={a}>{a}</li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
