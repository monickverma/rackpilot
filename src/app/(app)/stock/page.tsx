import type { Metadata } from "next";
import Link from "next/link";
import { MovementBadge } from "@/components/status";
import { Badge, Card, CardHeader, Empty, PageHeader, RecordLink, Table, Td, Th, tabClass } from "@/components/ui";
import { one, q } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime } from "@/lib/format";
import { CountSheet, ReceiveTransfer } from "./forms";

export const metadata: Metadata = { title: "Stock moves" };

export default async function Stock({ searchParams }: { searchParams: Promise<{ tab?: string; sku?: string; type?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const tab = sp.tab ?? "ledger";
  const tabs = [["ledger", "Ledger"], ["transfers", "Transfers"], ["counts", "Counts"], ["receipts", "Goods received"]];
  const check = await one<{ rows: number; mismatches: number; reservedOff: number }>(
    `SELECT (SELECT COUNT(*)::int FROM stock_movements WHERE business_id = $1) AS rows,
            (SELECT COUNT(*)::int FROM inventory_balances b WHERE b.business_id = $1 AND b.on_hand <> COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.variant_id = b.variant_id AND m.location_id = b.location_id), 0)) AS mismatches,
            (SELECT COUNT(*)::int FROM inventory_balances b WHERE b.business_id = $1 AND b.reserved <> COALESCE((SELECT SUM(qty) FROM reservations r WHERE r.variant_id = b.variant_id AND r.location_id = b.location_id AND r.status IN ('active', 'picked')), 0)) AS "reservedOff"`,
    s.businessId,
  );
  return (
    <>
      <PageHeader title="Stock moves" description="The append-only ledger and the records around it. A trigger rejects edits and deletes on stock movements; corrections are new, compensating rows." />
      <Card className="mb-3 px-6 py-3 text-[13px]">
        {check!.mismatches || check!.reservedOff ? (
          <span className="text-bad">{check!.mismatches} stored balances differ from their movement history and {check!.reservedOff} from their reservations. StockSleuth has opened cases for them.</span>
        ) : <span>All balances rebuild exactly from {check!.rows.toLocaleString("en-IN")} movements, and reserved equals what active reservations hold.</span>}
        {check!.mismatches > 0 && <span className="text-muted"> Every other balance rebuilds exactly from {check!.rows.toLocaleString("en-IN")} movements.</span>}
      </Card>
      <div className="mb-3 flex flex-wrap gap-1">{tabs.map(([k, l]) => <Link key={k} href={`/stock?tab=${k}`} className={tabClass(tab === k)}>{l}</Link>)}</div>
      {tab === "ledger" && <Ledger businessId={s.businessId} sku={sp.sku} type={sp.type} />}
      {tab === "transfers" && <Transfers businessId={s.businessId} allowed={can(s, "warehouse.write")} />}
      {tab === "counts" && <Counts businessId={s.businessId} allowed={can(s, "warehouse.write")} />}
      {tab === "receipts" && <Receipts businessId={s.businessId} />}
    </>
  );
}

async function Ledger({ businessId, sku, type }: { businessId: number; sku?: string; type?: string }) {
  const rows = await q<{ id: number; sku: string; type: string; qty: number; location: string; refCode: string | null; reason: string | null; actor: string | null; at: Date; reverses: number | null }>(
    `SELECT m.id, v.sku, m.type, m.qty, l.code AS location, m.ref_code AS "refCode", m.reason, COALESCE(u.name, m.actor_process) AS actor, m.created_at AS at, m.reverses_id AS reverses
       FROM stock_movements m JOIN product_variants v ON v.id = m.variant_id JOIN locations l ON l.id = m.location_id LEFT JOIN users u ON u.id = m.actor_user_id
      WHERE m.business_id = $1 AND ($2::text IS NULL OR v.sku = $2) AND ($3::text IS NULL OR m.type = $3) ORDER BY m.created_at DESC, m.id DESC LIMIT 200`,
    businessId, sku?.toUpperCase() ?? null, type ?? null,
  );
  const types = ["receipt", "dispatch", "transfer_out", "transfer_in", "customer_return", "damage", "adjustment", "opening"];
  return (
    <Card>
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2.5">
        <Link href={`/stock?tab=ledger${sku ? `&sku=${sku}` : ""}`} className={tabClass(!type)}>All</Link>
        {types.map((t) => <Link key={t} href={`/stock?tab=ledger&type=${t}${sku ? `&sku=${sku}` : ""}`} className={tabClass(type === t)}>{t.replace("_", " ")}</Link>)}
      </div>
      <Table>
        <thead><tr><Th>#</Th><Th>When</Th><Th>SKU</Th><Th>Movement</Th><Th>Location</Th><Th align="right">Qty</Th><Th>Reference</Th><Th>By</Th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <Td className="text-xs text-faint tabular">{m.id}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{dateTime(m.at)}</Td>
              <Td><RecordLink code={m.sku} /></Td>
              <Td><MovementBadge type={m.type} />{m.reverses && <span className="ml-1 text-xs text-muted">reverses #{m.reverses}</span>}</Td>
              <Td><span className="font-mono text-[12px]">{m.location}</span></Td>
              <Td align="right" className={m.qty < 0 ? "text-bad" : "text-ok"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</Td>
              <Td className="text-xs">{m.refCode ? <RecordLink code={m.refCode} /> : null} <span className="text-muted">{m.reason}</span></Td>
              <Td className="text-xs text-muted">{m.actor}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function Transfers({ businessId, allowed }: { businessId: number; allowed: boolean }) {
  const rows = await q<{ id: number; code: string; sku: string; qty: number; qtyReceived: number | null; from: string; to: string; status: string; sentAt: Date; receivedAt: Date | null; by: string | null; note: string | null }>(
    `SELECT t.id, t.code, v.sku, ti.qty_sent AS qty, ti.qty_received AS "qtyReceived", lf.code AS from, lt.code AS to, t.status, t.sent_at AS "sentAt", t.received_at AS "receivedAt", u.name AS by, t.note
       FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id JOIN product_variants v ON v.id = ti.variant_id
       JOIN locations lf ON lf.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id LEFT JOIN users u ON u.id = t.sent_by
      WHERE t.business_id = $1 ORDER BY t.sent_at DESC LIMIT 100`,
    businessId,
  );
  return (
    <Card>
      <CardHeader title="Transfers" description="Sent goods are booked out of the source and into the destination only when the destination scans them in." />
      {rows.length ? (
        <Table>
          <thead><tr><Th>Transfer</Th><Th>SKU</Th><Th>From → to</Th><Th align="right">Qty</Th><Th>Status</Th><Th>Sent</Th><Th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <Td><span className="font-mono text-[12px] font-medium">{t.code}</span><div className="text-xs text-muted">{t.note}</div></Td>
                <Td><RecordLink code={t.sku} /></Td>
                <Td className="font-mono text-[12px]">{t.from} → {t.to}</Td>
                <Td align="right">{t.qty}</Td>
                <Td>{t.status === "sent" ? <Badge tone="warn">Sent, not received</Badge> : t.status === "received" ? <Badge tone="ok">Received</Badge> : <Badge tone="neutral">Cancelled</Badge>}</Td>
                <Td className="text-xs text-muted">{dateTime(t.sentAt)}{t.by ? ` · ${t.by}` : ""}</Td>
                <Td>{t.status === "sent" && <ReceiveTransfer id={t.id} allowed={allowed} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <Empty>No transfers.</Empty>}
    </Card>
  );
}

async function Counts({ businessId, allowed }: { businessId: number; allowed: boolean }) {
  const rows = await q<{ code: string; scope: string; source: string; by: string | null; at: Date; lines: number; off: number }>(
    `SELECT c.code, c.scope, c.source, u.name AS by, c.counted_at AS at, COUNT(l.id)::int AS lines, COUNT(l.id) FILTER (WHERE l.counted_qty <> l.recorded_qty)::int AS off
       FROM physical_stock_counts c LEFT JOIN users u ON u.id = c.counted_by LEFT JOIN stock_count_lines l ON l.count_id = c.id
      WHERE c.business_id = $1 GROUP BY c.id, u.name ORDER BY c.counted_at DESC LIMIT 50`,
    businessId,
  );
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader title="Physical counts" description="What was on the shelf compared with the record at that moment. A difference opens a StockSleuth case." />
        <Table>
          <thead><tr><Th>Count</Th><Th>Scope</Th><Th align="right">Lines</Th><Th align="right">Off</Th><Th>When</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.code}>
                <Td><span className="font-mono text-[12px] font-medium">{c.code}</span><div className="text-xs text-muted">{c.source}</div></Td>
                <Td>{c.scope}</Td>
                <Td align="right">{c.lines}</Td>
                <Td align="right">{c.off ? <span className="text-bad">{c.off}</span> : 0}</Td>
                <Td className="text-xs text-muted">{dateTime(c.at)}{c.by ? ` · ${c.by}` : ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <CountSheet allowed={allowed} />
    </div>
  );
}

async function Receipts({ businessId }: { businessId: number }) {
  const rows = await q<{ code: string; po: string | null; supplier: string; at: Date; units: number; lines: number }>(
    `SELECT r.code, po.code AS po, s.name AS supplier, r.received_at AS at, SUM(ri.qty)::int AS units, COUNT(ri.id)::int AS lines
       FROM receipts r JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN purchase_orders po ON po.id = r.purchase_order_id JOIN receipt_items ri ON ri.receipt_id = r.id
      WHERE r.business_id = $1 GROUP BY r.id, po.code, s.name ORDER BY r.received_at DESC LIMIT 60`,
    businessId,
  );
  return (
    <Card>
      <CardHeader title="Goods received" description="Supplier deliveries, booked into each variant's home bin." />
      <Table>
        <thead><tr><Th>Receipt</Th><Th>Purchase order</Th><Th>Supplier</Th><Th align="right">Lines</Th><Th align="right">Units</Th><Th>When</Th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.code}><Td className="font-mono text-[12px]">{r.code}</Td><Td className="font-mono text-[12px]">{r.po}</Td><Td>{r.supplier}</Td><Td align="right">{r.lines}</Td><Td align="right">{r.units}</Td><Td className="text-xs text-muted">{dateTime(r.at)}</Td></tr>)}</tbody>
      </Table>
    </Card>
  );
}
