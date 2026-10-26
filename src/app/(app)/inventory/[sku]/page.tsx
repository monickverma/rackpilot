import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseBadge, HealthBadge, MovementBadge } from "@/components/status";
import { Badge, Card, CardHeader, Empty, KeyValue, PageHeader, RecordLink, Table, Td, Th } from "@/components/ui";
import { q } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime, locationPath, round1, rupees, sizeLabel } from "@/lib/format";
import { variantHealth } from "@/lib/intel/analytics";
import { holders } from "@/lib/ops/orders";
import { balancesOf, locations } from "@/lib/ops/stock";
import { StockActions } from "./actions";

export const metadata: Metadata = { title: "Stock card" };

export default async function StockCard({ params }: { params: Promise<{ sku: string }> }) {
  const s = await requireSession();
  const sku = decodeURIComponent((await params).sku).toUpperCase();
  const h = (await variantHealth(s)).find((x) => x.sku === sku);
  if (!h) notFound();
  const [bals, locs, held, moves, cases, transfers] = await Promise.all([
    balancesOf(s, h.variantId),
    locations(s),
    holders(s, h.variantId),
    q<{ id: number; type: string; qty: number; location: string; refCode: string | null; reason: string | null; actor: string | null; at: Date; reverses: number | null }>(
      `SELECT m.id, m.type, m.qty, l.code AS location, m.ref_code AS "refCode", m.reason, COALESCE(u.name, m.actor_process) AS actor, m.created_at AS at, m.reverses_id AS reverses
         FROM stock_movements m JOIN locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.actor_user_id
        WHERE m.business_id = $1 AND m.variant_id = $2 ORDER BY m.created_at, m.id`,
      s.businessId, h.variantId,
    ),
    q<{ code: string; title: string; status: string }>(`SELECT code, title, status FROM investigations WHERE business_id = $1 AND case_key LIKE $2 ORDER BY detected_at DESC`, s.businessId, `stock:${h.variantId}:%`),
    q<{ id: number; code: string; from: string; to: string; qty: number; sentAt: Date }>(
      `SELECT t.id, t.code, lf.code AS from, lt.code AS to, ti.qty_sent AS qty, t.sent_at AS "sentAt" FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id
         JOIN locations lf ON lf.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id
        WHERE t.business_id = $1 AND ti.variant_id = $2 AND t.status = 'sent'`,
      s.businessId, h.variantId,
    ),
  ]);
  const running = new Map<string, number>();
  const card = moves.map((m) => {
    running.set(m.location, (running.get(m.location) ?? 0) + m.qty);
    return { ...m, balance: running.get(m.location)! };
  }).reverse();
  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5"><span className="font-mono">{h.sku}</span> <HealthBadge health={h.health} /></span>}
        description={`${h.productName} · ${h.colour} · ${sizeLabel(h.size)} · ${h.brand} · barcode ${h.barcode}`}
      />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Card>
            <dl className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-4">
              <KeyValue label="On hand">{h.onHand}</KeyValue>
              <KeyValue label="Reserved">{h.reserved}</KeyValue>
              <KeyValue label="Available to sell">{h.available}</KeyValue>
              <KeyValue label="Not sellable (damaged, packing)">{h.unavailable}</KeyValue>
              <KeyValue label="Ordered in 28 days">{h.demand?.ordered28 ?? 0}{h.demand?.rising ? " · rising" : ""}</KeyValue>
              <KeyValue label="Cover">{h.coverDays === null ? "—" : `${round1(h.coverDays)} days`}</KeyValue>
              <KeyValue label="On order">{h.onOrder}{h.nextDelivery ? ` · due ${dateTime(h.nextDelivery)}` : ""}</KeyValue>
              <KeyValue label="Supplier">{h.supplierName} · {h.leadTimeDays}d · packs of {h.packSize}</KeyValue>
              <KeyValue label="Cost / price">{rupees(h.unitCost)} / {rupees(h.unitPrice)}</KeyValue>
              <KeyValue label="Stock value at cost">{rupees(h.stockValue)}</KeyValue>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Where it is" description="Recorded quantity per location. The home bin is where receipts go and picks start." />
            {bals.length ? (
              <Table>
                <thead><tr><Th>Location</Th><Th align="right">On hand</Th><Th align="right">Reserved</Th><Th>Note</Th></tr></thead>
                <tbody>
                  {bals.map((b) => (
                    <tr key={b.locationId}>
                      <Td><Link href={`/stocksleuth?loc=${b.code}&sku=${h.sku}`} className="font-mono text-[12px] font-medium hover:underline">{b.code}</Link>{b.locationId === h.homeLocationId && <Badge tone="neutral" className="ml-1.5">home</Badge>}<div className="text-xs text-muted">{locationPath(b)}</div></Td>
                      <Td align="right">{b.onHand}</Td>
                      <Td align="right">{b.reserved}</Td>
                      <Td>{b.needsVerification ? <Badge tone="warn">{b.verificationNote ?? "verify"}</Badge> : !b.sellable ? <Badge tone="neutral">not sellable</Badge> : null}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>Nothing on hand anywhere.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Stock card" description="Every movement, newest first, with the location's running balance. The ledger is append-only: corrections are new rows." action={<Link href={`/stock?sku=${h.sku}`} className="text-xs text-accent hover:underline">Ledger view →</Link>} />
            <Table>
              <thead><tr><Th>When</Th><Th>Movement</Th><Th>Location</Th><Th align="right">Qty</Th><Th align="right">Balance</Th><Th>Reference</Th></tr></thead>
              <tbody>
                {card.slice(0, 80).map((m) => (
                  <tr key={m.id}>
                    <Td className="whitespace-nowrap text-xs text-muted">{dateTime(m.at)}</Td>
                    <Td><MovementBadge type={m.type} />{m.reverses && <span className="ml-1 text-xs text-muted">reverses #{m.reverses}</span>}</Td>
                    <Td><span className="font-mono text-[12px]">{m.location}</span></Td>
                    <Td align="right" className={m.qty < 0 ? "text-bad" : "text-ok"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Td>
                    <Td align="right">{m.balance}</Td>
                    <Td className="text-xs">{m.refCode ? <RecordLink code={m.refCode} /> : null} <span className="text-muted">{m.reason ?? ""}{m.actor ? ` · ${m.actor}` : ""}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {card.length > 80 && <p className="border-t border-line px-6 py-3 text-xs text-muted">Showing the latest 80 of {card.length} movements.</p>}
          </Card>
        </div>
        <div className="space-y-3">
          <StockActions
            variantId={h.variantId} sku={h.sku} home={h.homeLocationId}
            balances={bals.map((b) => ({ id: b.locationId, code: b.code, onHand: b.onHand, reserved: b.reserved }))}
            locations={locs.map((l) => ({ id: l.id, code: l.code, kind: l.kind }))}
            pending={transfers.map((t) => ({ id: t.id, label: `${t.code}: ${t.qty} from ${t.from} to ${t.to}` }))}
            perms={{ warehouse: can(s, "warehouse.write"), adjust: can(s, "stock.adjust") }}
          />
          <Card>
            <CardHeader title="Promised to" description="Open orders holding this variant." />
            {held.length ? <ul className="divide-y divide-line">{held.map((x) => <li key={x.code} className="flex justify-between px-6 py-2 text-[13px]"><span><RecordLink code={x.code} /> {x.customer}</span><span className="tabular">{x.qty}</span></li>)}</ul> : <Empty>Not reserved by any order.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Investigations" />
            {cases.length ? <ul className="divide-y divide-line">{cases.map((c) => <li key={c.code} className="px-6 py-2.5 text-[13px]"><div className="flex items-center justify-between gap-2"><RecordLink code={c.code} /><CaseBadge status={c.status} /></div><div className="text-xs text-muted">{c.title}</div></li>)}</ul> : <Empty>None.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
