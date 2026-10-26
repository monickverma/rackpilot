import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { CaseBadge } from "@/components/status";
import { Badge, Button, Card, CardHeader, cn, Empty, inputClass, PageHeader, RecordLink, Table, Td, Th } from "@/components/ui";
import { one, q } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { DAY, dateTime, locationPath, when } from "@/lib/format";
import { listCases } from "@/lib/investigate/cases";
import { RULES } from "@/lib/investigate/types";
import { locationInfo, reconstruct } from "@/lib/stockrecords";

export const metadata: Metadata = { title: "StockSleuth" };

export default async function StockSleuth({ searchParams }: { searchParams: Promise<{ sku?: string; loc?: string; days?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const now = new Date();
  const sku = sp.sku?.trim().toUpperCase() || null;
  const loc = sp.loc?.trim().toUpperCase() || null;
  let target: { variantId: number; locationId: number } | null = null;
  if (sku) {
    target = (await one<{ variantId: number; locationId: number }>(
      `SELECT v.id AS "variantId", COALESCE(l.id, v.home_location_id) AS "locationId" FROM product_variants v LEFT JOIN locations l ON l.business_id = v.business_id AND l.code = $3
        WHERE v.business_id = $1 AND v.sku = $2`,
      s.businessId, sku, loc,
    )) ?? null;
  }
  const atLocation = !sku && loc
    ? await q<{ sku: string; onHand: number; reserved: number; flagged: boolean }>(
        `SELECT v.sku, b.on_hand AS "onHand", b.reserved, b.needs_verification AS flagged FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id
           JOIN locations l ON l.id = b.location_id WHERE b.business_id = $1 AND l.code = $2 ORDER BY v.sku`,
        s.businessId, loc,
      )
    : [];
  const days = Math.min(Math.max(Number(sp.days) || 3, 1), 200);
  const info = target ? await locationInfo(s.businessId, target.variantId, target.locationId) : null;
  const recon = target ? await reconstruct(s.businessId, target.variantId, target.locationId, now, { from: new Date(now.getTime() - days * DAY) }) : null;
  const ledger = target ? await one<{ sum: number }>(`SELECT COALESCE(SUM(qty), 0)::int AS sum FROM stock_movements WHERE variant_id = $1 AND location_id = $2`, target.variantId, target.locationId) : null;
  const [cases, flagged, inTransit] = await Promise.all([
    listCases(s, { status: "open" }),
    q<{ sku: string; location: string; note: string | null }>(
      `SELECT v.sku, l.code AS location, b.verification_note AS note FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id JOIN locations l ON l.id = b.location_id
        WHERE b.business_id = $1 AND b.needs_verification`,
      s.businessId,
    ),
    q<{ code: string; sku: string; from: string; to: string; qty: number; sentAt: Date }>(
      `SELECT t.code, v.sku, lf.code AS from, lt.code AS to, ti.qty_sent AS qty, t.sent_at AS "sentAt" FROM transfers t JOIN transfer_items ti ON ti.transfer_id = t.id
         JOIN product_variants v ON v.id = ti.variant_id JOIN locations lf ON lf.id = t.from_location_id JOIN locations lt ON lt.id = t.to_location_id
        WHERE t.business_id = $1 AND t.status = 'sent' ORDER BY t.sent_at`,
      s.businessId,
    ),
  ]);
  const ss = cases.filter((c) => c.code.startsWith("SS"));
  return (
    <>
      <PageHeader
        title="StockSleuth"
        description="Investigates why recorded stock and the shelf disagree. It replays a location's movements from the last trusted balance and lines them up with picks, transfers, reservations and counts, so you can see where the evidence stops reconciling."
        actions={
          <Form action="/stocksleuth" className="flex flex-wrap items-center gap-2">
            <input name="sku" defaultValue={sku ?? ""} placeholder="SKU, e.g. BLK-TSH-M" className={cn(inputClass, "w-40")} />
            <input name="loc" defaultValue={loc ?? ""} placeholder="Location (optional)" className={cn(inputClass, "w-40")} />
            <select name="days" defaultValue={String(days)} className={inputClass}>{[1, 3, 7, 30, 150].map((d) => <option key={d} value={d}>{d === 150 ? "All history" : `Last ${d} days`}</option>)}</select>
            <Button type="submit" size="sm"><SearchIcon size={14} /> Reconstruct</Button>
          </Form>
        }
      />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          {info && recon ? (
            <Card>
              <CardHeader
                title={<span><span className="font-mono">{info.sku}</span> at <span className="font-mono">{info.location}</span></span>}
                description={`${locationPath(info)} · ${info.productName}, ${info.colour} ${info.size}${info.locationId === info.homeLocationId ? " · home bin" : ""}`}
                action={<Link href={`/inventory/${info.sku}`} className="text-xs text-accent hover:underline">Stock card →</Link>}
              />
              <dl className="grid grid-cols-2 gap-3 border-b border-line px-6 py-4 text-[13px] sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Stored balance</dt><dd className="font-medium tabular">{info.onHand}</dd></div>
                <div><dt className="text-xs text-muted">Ledger says</dt><dd className={cn("font-medium tabular", ledger!.sum !== info.onHand && "text-bad")}>{ledger!.sum}</dd></div>
                <div><dt className="text-xs text-muted">Reserved here</dt><dd className="font-medium tabular">{info.reserved}</dd></div>
                <div><dt className="text-xs text-muted">Verification</dt><dd className="font-medium">{info.needsVerification ? <Badge tone="warn">needed</Badge> : "—"}</dd></div>
              </dl>
              <Table>
                <thead><tr><Th>When</Th><Th>Event</Th><Th>Detail</Th><Th align="right">Change</Th><Th align="right">Recorded after</Th></tr></thead>
                <tbody>
                  {recon.events.map((e, i) => (
                    <tr key={i} className={cn(e.delta === null && "bg-subtle/60")}>
                      <Td className="whitespace-nowrap text-xs text-muted">{when(e.at, now)}</Td>
                      <Td className="whitespace-nowrap"><span className="text-[13px] font-medium">{e.label}</span>{e.actor && <div className="text-xs text-faint">{e.actor}</div>}</Td>
                      <Td className="text-xs text-muted">{e.code && !e.code.startsWith("RES-") && !e.code.startsWith("MOV-") && e.type !== "balance" && <RecordLink code={e.code} className="mr-1" />}{e.detail}</Td>
                      <Td align="right" className={cn(e.delta !== null && (e.delta < 0 ? "text-bad" : "text-ok"))}>{e.delta === null ? "" : e.delta > 0 ? `+${e.delta}` : e.delta}</Td>
                      <Td align="right" className="font-medium">{e.balance ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="border-t border-line px-6 py-3 text-xs text-muted">Grey rows don&apos;t move stock in the ledger: picks, unreceived transfers and counts. They are where recorded and physical stock usually part ways.</p>
            </Card>
          ) : atLocation.length ? (
            <Card>
              <CardHeader title={`What is recorded at ${loc}`} description="Pick a SKU to reconstruct." />
              <Table>
                <thead><tr><Th>SKU</Th><Th align="right">On hand</Th><Th align="right">Reserved</Th><Th /></tr></thead>
                <tbody>{atLocation.map((a) => <tr key={a.sku}><Td><Link href={`/stocksleuth?sku=${a.sku}&loc=${loc}`} className="font-mono text-[12px] text-accent hover:underline">{a.sku}</Link></Td><Td align="right">{a.onHand}</Td><Td align="right">{a.reserved}</Td><Td>{a.flagged && <Badge tone="warn">verify</Badge>}</Td></tr>)}</tbody>
              </Table>
            </Card>
          ) : (
            <Card><Empty>Enter a SKU (and optionally a location) to replay its movements. Try <Link href="/stocksleuth?sku=BLK-TSH-M&loc=A-R12-S3-B12" className="text-accent hover:underline">BLK-TSH-M at A-R12-S3-B12</Link>.</Empty></Card>
          )}
          <Card>
            <CardHeader title="Open stock variances" description="StockSleuth cases waiting on a person." />
            {ss.length ? (
              <ul className="divide-y divide-line">
                {ss.map((c) => (
                  <li key={c.code}>
                    <Link href={`/investigations/${c.code}`} className="flex flex-wrap items-center gap-3 px-6 py-3 hover:bg-panel-2">
                      <span className="w-14 font-mono text-[12px] font-medium">{c.code}</span>
                      <span className="min-w-0 flex-1 text-[13px]">{c.title}</span>
                      <CaseBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <Empty>No open variances.</Empty>}
          </Card>
        </div>
        <div className="space-y-3">
          <Card>
            <CardHeader title="In transit" description="Sent, not yet scanned in at the destination." />
            {inTransit.length ? <ul className="divide-y divide-line">{inTransit.map((t) => <li key={t.code} className="px-6 py-2.5 text-xs"><span className="font-mono">{t.code}</span> · {t.qty} × <RecordLink code={t.sku} /><div className="text-muted">{t.from} → {t.to} · sent {dateTime(t.sentAt)}</div></li>)}</ul> : <Empty>Nothing in transit.</Empty>}
          </Card>
          <Card>
            <CardHeader title="Bins to verify" description="Flagged by short picks or awaiting a recount." />
            {flagged.length ? <ul className="divide-y divide-line">{flagged.map((f) => <li key={`${f.sku}${f.location}`} className="px-6 py-2.5 text-xs"><Link href={`/stocksleuth?sku=${f.sku}&loc=${f.location}`} className="font-mono hover:underline">{f.sku} @ {f.location}</Link><div className="text-muted">{f.note}</div></li>)}</ul> : <Empty>None.</Empty>}
          </Card>
          <Card>
            <CardHeader title="StockSleuth rules" />
            <ul className="space-y-2 px-6 py-4 text-xs">
              {Object.entries(RULES).filter(([, r]) => r.module === "stocksleuth").map(([id, r]) => <li key={id}><span className="font-mono">{id}</span> <span className="font-medium">{r.name}</span><div className="text-muted">{r.detects}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
