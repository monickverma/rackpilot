import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ShieldCheckIcon } from "@/components/icons";
import { MovementTable } from "@/components/movement-table";
import { Delta, MOVEMENT, MovementBadge } from "@/components/status";
import { Button, Card, CardHeader, CardSkeleton, cn, IconBadge, inputClass, Mono, PageHeader, Table, Td, Th } from "@/components/ui";
import type { MovementType } from "@/db/schema";
import { orderCode } from "@/lib/format";
import { movements, movementTotals, reconcile, type LedgerFilter } from "@/lib/inventory";

export const metadata: Metadata = { title: "Ledger" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TYPES = Object.keys(MOVEMENT) as MovementType[];

export default function LedgerPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The append-only record behind every number in RackPilot. Receive, reserve, release, sale, adjust and exchange rows; on-hand and reserved are their running sums."
      />
      <Suspense fallback={<CardSkeleton rows={10} />}>
        <Ledger searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Ledger({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const type = TYPES.find((t) => t === one(sp.type));
  const sku = one(sp.sku).trim().toUpperCase().slice(0, 30);
  const order = Number(one(sp.order)) || undefined;
  const days = Number(one(sp.days)) || undefined;
  const filter: LedgerFilter = { type, sku: sku || undefined, orderId: order, since: days ? new Date().getTime() - days * 86_400_000 : undefined, limit: 300 };
  const rows = movements(filter);
  const totals = movementTotals(filter);
  const check = reconcile();
  const filtered = Boolean(type || sku || order || days);
  const ok = check.ledgerMismatches.length === 0 && check.reservationMismatches.length === 0;
  const totalRows = totals.reduce((a, t) => a + (type ? (t.type === type ? t.rows : 0) : t.rows), 0);

  return (
    <div className="space-y-3">
      <Card className={ok ? undefined : "ring-1 ring-bad/40"}>
        <div className="flex items-start gap-3 px-6 py-4">
          <IconBadge tone={ok ? "ok" : "bad"}>
            <ShieldCheckIcon />
          </IconBadge>
          <div className="min-w-0 flex-1">
            <div className="font-medium">{ok ? "Reconciled" : "Mismatch found"}</div>
            <p className="mt-0.5 text-muted">
              Summing all {check.movements.toLocaleString("en-IN")} rows per SKU gives exactly the stored on-hand and reserved for{" "}
              {check.variants - check.ledgerMismatches.length} of {check.variants} variants, and reserved stock equals what open order lines hold for{" "}
              {check.variants - check.reservationMismatches.length} of {check.variants}. Checked on every page load.
            </p>
            {!ok && (
              <ul className="mt-2 font-mono text-xs text-bad">
                {check.ledgerMismatches.map((m) => <li key={m.sku}>{m.sku}: stored {m.onHand}/{m.reserved}, ledger {m.ledgerOnHand}/{m.ledgerReserved}</li>)}
                {check.reservationMismatches.map((m) => <li key={`r${m.sku}`}>{m.sku}: reserved {m.reserved}, open orders hold {m.heldByOrders}</li>)}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <Form action="/ledger" className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-3">
          <select name="type" defaultValue={type ?? ""} className={inputClass}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{MOVEMENT[t][1]}</option>)}
          </select>
          <input name="sku" defaultValue={sku} placeholder="SKU or prefix, e.g. K101-BLK" className={cn(inputClass, "w-56")} />
          <select name="days" defaultValue={days ? String(days) : ""} className={inputClass}>
            <option value="">All time</option>
            <option value="1">Today and yesterday</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          {order && <input type="hidden" name="order" value={order} />}
          <Button type="submit">Filter</Button>
          {filtered && <Link href="/ledger" className="text-[13px] text-muted hover:text-fg">Clear</Link>}
          {order && <span className="text-xs text-muted">Order <Mono>{orderCode(order)}</Mono></span>}
        </Form>

        <div className="border-b border-line">
          <Table>
            <thead>
              <tr>
                <Th>Type</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Units</Th>
                <Th align="right">Δ on hand</Th>
                <Th align="right">Δ reserved</Th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.type} className={type && type !== t.type ? "opacity-40" : ""}>
                  <Td><MovementBadge type={t.type} /></Td>
                  <Td align="right">{t.rows.toLocaleString("en-IN")}</Td>
                  <Td align="right">{t.units.toLocaleString("en-IN")}</Td>
                  <Td align="right"><Delta n={t.onHandDelta} /></Td>
                  <Td align="right"><Delta n={t.reservedDelta} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <CardHeader title={`Rows${filtered ? " matching the filter" : ""}`} description={`Newest first. Showing ${Math.min(rows.length, 300)} of ${totalRows.toLocaleString("en-IN")}.`} />
        <MovementTable rows={rows} />
      </Card>
    </div>
  );
}
