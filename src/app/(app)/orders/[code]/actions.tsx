"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton, Message, useApi } from "@/components/client";
import { Button, ButtonLink, Card, CardHeader, cn, inputClass } from "@/components/ui";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function ShortageButtons({ code, orderItemId, backordered }: { code: string; orderItemId: number; backordered: boolean }) {
  const url = `/api/orders/${code}`;
  return (
    <div className="flex flex-wrap gap-1.5">
      <ActionButton size="sm" url={url} body={{ action: "shortage", orderItemId, decision: "retry" }} ok="Checked stock again.">Try reserving again</ActionButton>
      {!backordered && <ActionButton size="sm" url={url} body={{ action: "shortage", orderItemId, decision: "backorder" }} ok="On backorder.">Backorder the rest</ActionButton>}
      <ActionButton size="sm" variant="ghost" url={url} body={{ action: "shortage", orderItemId, decision: "ship_partial" }} confirm="Ship only what's reserved and drop the rest of this line?" ok="Line reduced to what can ship.">Ship what&apos;s reserved</ActionButton>
    </div>
  );
}

interface Props {
  code: string; status: string; openPick: { id: number; code: string } | null; canPick: boolean;
  picked: { orderItemId: number; sku: string; qty: number }[]; billable: { orderItemId: number; sku: string; qty: number; unitPrice: number }[];
  invoices: { id: number; code: string; total: number; paid: number }[]; outstanding: number;
  perms: { orders: boolean; warehouse: boolean; billing: boolean };
}

export function OrderActions(p: Props) {
  const url = `/api/orders/${p.code}`;
  const closed = p.status === "completed" || p.status === "cancelled";
  const [ship, setShip] = useState(() => Object.fromEntries(p.picked.map((x) => [x.orderItemId, x.qty])));
  const [bill, setBill] = useState(() => Object.fromEntries(p.billable.map((x) => [x.orderItemId, x.qty])));
  const firstUnpaid = p.invoices.find((i) => i.paid < i.total);
  const [invoiceId, setInvoiceId] = useState<number | "">(firstUnpaid?.id ?? "");
  const [amount, setAmount] = useState(String(Math.max(p.outstanding, 0) || ""));
  const [method, setMethod] = useState("upi");
  const [reference, setReference] = useState("");
  const dispatch = useApi();
  const invoice = useApi();
  const payment = useApi();
  const no = (allowed: boolean, who: string) => (allowed ? undefined : `Only ${who} can do this.`);
  return (
    <Card>
      <CardHeader title="Workflow" description="Each step writes its records; OrderTrace checks they agree." />
      <div className="divide-y divide-line">
        <section className="space-y-2 px-6 py-4">
          <h3 className="h3-core">1 · Pick</h3>
          {p.openPick ? (
            <ButtonLink href={`/orders/${p.code}/pick/${p.openPick.id}`} variant="primary" size="sm">Open pick list {p.openPick.code}</ButtonLink>
          ) : p.canPick ? (
            <ActionButton size="sm" variant="primary" url={url} body={{ action: "pick_list" }} ok="Pick list created." disabled={!p.perms.warehouse} title={no(p.perms.warehouse, "the owner or warehouse")}>Create pick list</ActionButton>
          ) : <p className="text-xs text-faint">Nothing reserved is waiting to be picked.</p>}
        </section>
        <section className="space-y-2 px-6 py-4">
          <h3 className="h3-core">2 · Dispatch</h3>
          {p.picked.length ? (
            <>
              {p.picked.map((x) => (
                <label key={x.orderItemId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{x.sku}</span>
                  <span className="flex items-center gap-1.5 text-muted">ship <input type="number" min={0} max={x.qty} value={ship[x.orderItemId]} onChange={(e) => setShip({ ...ship, [x.orderItemId]: Number(e.target.value) })} className={cn(inputClass, "h-7 w-16 text-right")} /> of {x.qty} picked</span>
                </label>
              ))}
              <Button size="sm" variant="primary" disabled={dispatch.pending || !p.perms.warehouse} title={no(p.perms.warehouse, "the owner or warehouse")}
                onClick={() => dispatch.run(url, { action: "dispatch", lines: p.picked.map((x) => ({ orderItemId: x.orderItemId, qty: ship[x.orderItemId] ?? 0 })) }, { ok: (d: { code: string; units: number }) => `Dispatched ${d.units} units on ${d.code}.` })}>
                {dispatch.pending ? "Dispatching…" : "Dispatch"}
              </Button>
              <Message message={dispatch.message} />
            </>
          ) : <p className="text-xs text-faint">Nothing picked is waiting to ship.</p>}
        </section>
        <section className="space-y-2 px-6 py-4">
          <h3 className="h3-core">3 · Invoice</h3>
          {p.billable.length ? (
            <>
              <p className="text-xs text-muted">Defaults to what was dispatched and not yet billed. You can change it; OrderTrace will check.</p>
              {p.billable.map((x) => (
                <label key={x.orderItemId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{x.sku}</span>
                  <span className="flex items-center gap-1.5 text-muted">bill <input type="number" min={0} value={bill[x.orderItemId]} onChange={(e) => setBill({ ...bill, [x.orderItemId]: Number(e.target.value) })} className={cn(inputClass, "h-7 w-16 text-right")} /> × {rupees(x.unitPrice)}</span>
                </label>
              ))}
              <Button size="sm" variant="primary" disabled={invoice.pending || !p.perms.billing} title={no(p.perms.billing, "the owner or accounts")}
                onClick={() => invoice.run(url, { action: "invoice", lines: p.billable.map((x) => ({ orderItemId: x.orderItemId, qty: bill[x.orderItemId] ?? 0 })) }, { ok: (d: { code: string; total: number }) => `Issued ${d.code} for ${rupees(d.total)}.` })}>
                {invoice.pending ? "Issuing…" : "Issue invoice"}
              </Button>
              <Message message={invoice.message} />
            </>
          ) : <p className="text-xs text-faint">Everything dispatched is billed.</p>}
        </section>
        <section className="space-y-2 px-6 py-4">
          <h3 className="h3-core">4 · Payment</h3>
          {p.invoices.length ? (
            <>
              <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value ? Number(e.target.value) : "")} className={cn(inputClass, "w-full")}>
                <option value="">Not linked to an invoice</option>
                {p.invoices.map((i) => <option key={i.id} value={i.id}>{i.code} · {rupees(i.total)} · {rupees(i.paid)} paid</option>)}
              </select>
              <div className="grid grid-cols-[1fr_88px] gap-2">
                <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (₹)" inputMode="numeric" className={inputClass} />
                <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>{["upi", "bank", "cash", "cheque"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select>
              </div>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (UPI or bank ref)" className={cn(inputClass, "w-full")} />
              <Button size="sm" disabled={payment.pending || !p.perms.billing || !Number(amount)} title={no(p.perms.billing, "the owner or accounts")}
                onClick={() => payment.run(url, { action: "payment", invoiceId: invoiceId || null, amount: Number(amount), method, reference }, { ok: (d: { code: string }) => `Recorded ${d.code}.` })}>
                {payment.pending ? "Recording…" : "Record payment"}
              </Button>
              <Message message={payment.message} />
            </>
          ) : <p className="text-xs text-faint">No invoice yet.</p>}
        </section>
        {!closed && (
          <section className="flex flex-wrap gap-2 px-6 py-4">
            <ActionButton size="sm" variant="ghost" url={url} body={{ action: "complete", reason: "Marked complete by hand" }} confirm="Mark this order completed by hand? OrderTrace will check that its records agree." disabled={!p.perms.orders}>Mark completed</ActionButton>
            <ActionButton size="sm" variant="danger" url={url} body={{ action: "cancel", reason: "Cancelled by customer" }} confirm="Cancel the order and release every reservation, picked ones included?" disabled={!p.perms.orders}>Cancel order</ActionButton>
          </section>
        )}
        <section className="px-6 py-3 text-xs"><Link href={`/ordertrace?q=${p.code}`} className="text-accent hover:underline">Trace this order in OrderTrace →</Link></section>
      </div>
    </Card>
  );
}
