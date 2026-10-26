import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, ArrowRightIcon, BellIcon, BoxSearchIcon, CartIcon, ClipboardIcon, FileSearchIcon, MessagePlusIcon, PlayIcon, TruckIcon } from "@/components/icons";
import { CaseBadge, ModuleBadge, PriorityBadge, SeverityBadge } from "@/components/status";
import { ButtonLink, Card, CardHeader, Empty, PageHeader, RecordLink, Stat } from "@/components/ui";
import { q, one } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { ago, dueIn, num, plural, rupees, units } from "@/lib/format";
import { alerts } from "@/lib/intel/alerts";
import { commitments, sales } from "@/lib/intel/analytics";
import { listCases } from "@/lib/investigate/cases";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const s = await requireSession();
  const now = new Date();
  const [cases, al, commit, sold, stock, flow, due, activity] = await Promise.all([
    listCases(s, { status: "open" }),
    alerts(s, now),
    commitments(s),
    sales(s, 30),
    one<{ variants: number; units: number; locations: number; value: number }>(
      `SELECT (SELECT COUNT(*)::int FROM product_variants WHERE business_id = $1) AS variants,
              (SELECT COALESCE(SUM(on_hand), 0)::int FROM inventory_balances WHERE business_id = $1) AS units,
              (SELECT COUNT(*)::int FROM locations WHERE business_id = $1) AS locations,
              (SELECT COALESCE(SUM(b.on_hand * p.unit_cost), 0)::int FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id JOIN products p ON p.id = v.product_id WHERE b.business_id = $1) AS value`,
      s.businessId,
    ),
    one<{ orders7: number; extracted7: number; shipments7: number; packed: number; picking: number; poOpen: number; plan: string | null }>(
      `SELECT (SELECT COUNT(*)::int FROM orders WHERE business_id = $1 AND created_at > now() - interval '7 days') AS orders7,
              (SELECT COUNT(*)::int FROM orders WHERE business_id = $1 AND created_at > now() - interval '7 days' AND extracted_by <> 'manual') AS extracted7,
              (SELECT COUNT(*)::int FROM shipments WHERE business_id = $1 AND dispatched_at > now() - interval '7 days') AS shipments7,
              (SELECT COUNT(*)::int FROM orders WHERE business_id = $1 AND status = 'packed') AS packed,
              (SELECT COUNT(*)::int FROM orders WHERE business_id = $1 AND status = 'picking') AS picking,
              (SELECT COUNT(*)::int FROM purchase_orders WHERE business_id = $1 AND status IN ('placed', 'partially_received')) AS "poOpen",
              (SELECT code FROM recommendations WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1) AS plan`,
      s.businessId,
    ),
    q<{ code: string; customer: string; dueAt: Date; status: string }>(
      `SELECT o.code, c.name AS customer, o.due_at AS "dueAt", o.status FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.business_id = $1 AND o.status IN ('confirmed', 'picking', 'packed') AND o.due_at IS NOT NULL ORDER BY o.due_at LIMIT 6`,
      s.businessId,
    ),
    q<{ action: string; actor: string | null; code: string | null; reason: string | null; at: Date }>(
      `SELECT a.action, COALESCE(u.name, a.actor_process) AS actor, a.entity_code AS code, a.reason, a.created_at AS at FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.business_id = $1 ORDER BY a.created_at DESC, a.id DESC LIMIT 8`,
      s.businessId,
    ),
  ]);
  const revenue = sold.reduce((a, r) => a + r.revenue, 0);
  const cost = sold.reduce((a, r) => a + r.cost, 0);
  const low = al.filter((a) => a.kind === "low_stock");
  const short = al.filter((a) => a.kind === "cannot_fulfil");
  const high = cases.filter((c) => c.priority === "high").length;
  const steps = [
    { n: 1, title: "Stock is added", body: `${num(stock!.variants)} variants, ${units(stock!.units)} on hand in ${num(stock!.locations)} locations`, href: "/inventory" },
    { n: 2, title: "An order arrives", body: `${plural(flow!.orders7, "order")} in 7 days, ${flow!.extracted7} read from messages`, href: "/orders/new" },
    { n: 3, title: "Inventory is checked", body: `${plural(short.length, "order line")} short right now`, href: "/alerts" },
    { n: 4, title: "Stock is reserved", body: `${units(commit.reservedUnits)} reserved for ${plural(commit.openOrders, "open order")}`, href: "/orders?status=open" },
    { n: 5, title: "Picked and dispatched", body: `${flow!.picking} picking, ${flow!.packed} packed; ${plural(flow!.shipments7, "shipment")} in 7 days`, href: "/orders" },
    { n: 6, title: "Performance updates", body: `${rupees(revenue)} dispatched in 30 days, ${revenue ? Math.round(((revenue - cost) / revenue) * 100) : 0}% gross margin`, href: "/analytics" },
    { n: 7, title: "Purchasing is recommended", body: `${plural(flow!.poOpen, "purchase order")} on the way${flow!.plan ? `; last plan ${flow!.plan}` : ""}`, href: "/purchasing" },
  ];
  const demo = [
    ["Look at the catalogue: sizes, colours and rack locations", "/inventory"],
    ["Receive stock into its home bin", "/purchasing#orders"],
    ["Create an order for 20 blue oxford shirts", "/orders/new?sample=shirts"],
    ["Invoice only 18 of them", "/orders?status=open"],
    ["Send 2 tees to the showroom rail and don't scan them in", "/inventory/BLK-TSH-M"],
    ["Open the Investigation Centre", "/investigations"],
    ["Ask why the order is flagged", "/investigations/OT-001"],
    ["Verify, correct and resolve", "/investigations/SS-004"],
  ];
  return (
    <>
      <PageHeader
        title="Operations dashboard"
        description="Orders, stock, dispatches and stock alerts, with the investigations that need a person. Every figure comes from the same records the investigation modules reconcile."
        actions={<ButtonLink href="/orders/new" variant="primary"><MessagePlusIcon size={15} /> New order</ButtonLink>}
      />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open orders" value={commit.openOrders} sub={`${units(commit.reservedUnits)} reserved · ${units(commit.backorderUnits)} short`} href="/orders?status=open" icon={<ClipboardIcon />} tone="accent" />
          <Stat label="Waiting to dispatch" value={flow!.packed + flow!.picking} sub={`${flow!.picking} picking, ${flow!.packed} packed`} href="/orders?status=packed" icon={<TruckIcon />} tone="info" />
          <Stat label="Running low" value={low.length} sub={`${al.filter((a) => a.kind === "verify_location").length} bins need verifying`} href="/alerts" icon={<AlertIcon />} tone={low.length ? "warn" : "ok"} />
          <Stat label="Open investigations" value={cases.length} sub={`${high} high priority`} href="/investigations" icon={<FileSearchIcon />} tone={high ? "bad" : "ok"} />
        </div>

        <Card>
          <CardHeader title="The workflow, live" description="One loop on one set of records: what is sold, what is owned, what is promised, and what to buy next." />
          <ol className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-7">
            {steps.map((st) => (
              <li key={st.n} className="bg-panel">
                <Link href={st.href} className="block h-full px-4 py-3 transition-colors hover:bg-panel-2">
                  <div className="text-[11px] font-medium text-faint tabular">Step {st.n}</div>
                  <div className="mt-0.5 text-[13px] font-medium">{st.title}</div>
                  <div className="mt-1 text-xs text-muted">{st.body}</div>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader icon={<FileSearchIcon />} tone="bad" title="Investigation queue" description="Discrepancies OrderTrace and StockSleuth found. A mismatch is evidence of a problem, not proof of its cause." action={<ButtonLink href="/investigations" size="sm" variant="ghost">All <ArrowRightIcon size={13} /></ButtonLink>} />
            {cases.length ? (
              <ul className="divide-y divide-line">
                {cases.slice(0, 6).map((c) => (
                  <li key={c.code}>
                    <Link href={`/investigations/${c.code}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3 transition-colors hover:bg-panel-2">
                      <span className="w-14 font-mono text-[12px] font-medium">{c.code}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                      <ModuleBadge module={c.module} />
                      <PriorityBadge priority={c.priority} />
                      <CaseBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty>No open investigations: every record reconciles.</Empty>}
          </Card>
          <Card>
            <CardHeader icon={<PlayIcon />} title="Demo scenario" description="The spec's end-to-end investigation, step by step. OT-001 and SS-004 are already prepared from yesterday's trading." />
            <ol className="space-y-1 px-6 py-4 text-[13px]">
              {demo.map(([label, href], i) => (
                <li key={label} className="flex gap-2">
                  <span className="w-4 shrink-0 text-faint tabular">{i + 1}</span>
                  <Link href={href} className="hover:underline">{label}</Link>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader icon={<BellIcon />} tone="warn" title="Needs attention" description="Explicit rules over the data; each alert says what triggered it." action={<ButtonLink href="/alerts" size="sm" variant="ghost">All alerts <ArrowRightIcon size={13} /></ButtonLink>} />
            {al.length ? (
              <ul className="divide-y divide-line">
                {al.filter((a) => a.kind !== "transaction" && a.kind !== "count_discrepancy").slice(0, 7).map((a, i) => (
                  <li key={i} className="px-6 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={a.href} className="text-[13px] font-medium hover:underline">{a.title}</Link>
                      <SeverityBadge severity={a.severity} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing needs attention.</Empty>}
          </Card>
          <div className="space-y-3">
            <Card>
              <CardHeader title="Due next" description="Open orders by due date." />
              {due.length ? (
                <ul className="divide-y divide-line">
                  {due.map((d) => (
                    <li key={d.code} className="flex items-center justify-between gap-2 px-6 py-2.5 text-[13px]">
                      <span className="min-w-0"><RecordLink code={d.code} /> <span className="text-muted">{d.customer}</span></span>
                      <span className={d.dueAt < now ? "text-xs text-bad" : "text-xs text-muted"}>{dueIn(d.dueAt, now)}</span>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No due dates on open orders.</Empty>}
            </Card>
            <Card>
              <CardHeader icon={<BoxSearchIcon />} title="Recent activity" description="From the audit trail." />
              <ul className="divide-y divide-line">
                {activity.map((a, i) => (
                  <li key={i} className="px-6 py-2 text-xs">
                    <span className="font-medium">{a.actor ?? "System"}</span> <span className="text-muted">{a.action.replace(/[._]/g, " ")}</span> {a.code && <RecordLink code={a.code} />}
                    <div className="text-faint">{ago(a.at, now)}</div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader icon={<CartIcon />} title="Committed and on the racks" />
              <dl className="grid grid-cols-2 gap-3 px-6 py-4 text-[13px]">
                <div><dt className="text-xs text-muted">Stock at cost</dt><dd className="font-medium">{rupees(stock!.value)}</dd></div>
                <div><dt className="text-xs text-muted">Reserved value</dt><dd className="font-medium">{rupees(commit.reservedValue)}</dd></div>
                <div><dt className="text-xs text-muted">Short on orders</dt><dd className="font-medium">{units(commit.backorderUnits)}</dd></div>
                <div><dt className="text-xs text-muted">Short value</dt><dd className="font-medium">{rupees(commit.backorderValue)}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
