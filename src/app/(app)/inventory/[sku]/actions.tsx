"use client";

import { useState } from "react";
import { Message, useApi } from "@/components/client";
import { Button, Card, CardHeader, cn, inputClass, tabClass } from "@/components/ui";

interface Props {
  variantId: number; sku: string; home: number;
  balances: { id: number; code: string; onHand: number; reserved: number }[];
  locations: { id: number; code: string; kind: string }[];
  pending: { id: number; label: string }[];
  perms: { warehouse: boolean; adjust: boolean };
}

function LocSelect({ locations, value, onChange, only }: { locations: Props["locations"]; value: number; onChange: (v: number) => void; only?: number[] }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={cn(inputClass, "w-full")}>
      {locations.filter((l) => !only || only.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.code}{l.kind !== "bin" ? ` (${l.kind})` : ""}</option>)}
    </select>
  );
}

type Tab = "transfer" | "receive" | "count" | "damage" | "adjust";

export function StockActions(p: Props) {
  const [tab, setTab] = useState<Tab>("transfer");
  const from0 = p.balances.find((b) => b.id === p.home)?.id ?? p.balances[0]?.id ?? p.home;
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(p.locations.find((l) => l.code.startsWith("A-SR"))?.id ?? p.locations.find((l) => l.id !== from0)?.id ?? 0);
  const [qty, setQty] = useState("2");
  const [loc, setLoc] = useState(from0);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const api = useApi();
  const url = "/api/stock";
  const tabs: [Tab, string, boolean][] = [["transfer", "Send transfer", p.perms.warehouse], ["receive", "Receive", p.perms.warehouse], ["count", "Count", p.perms.warehouse], ["damage", "Write off", p.perms.warehouse], ["adjust", "Adjust", p.perms.adjust]];
  return (
    <Card>
      <CardHeader title="Stock actions" description="Each one writes a ledger movement or a record StockSleuth checks." />
      <div className="flex flex-wrap gap-1 border-b border-line px-4 py-2">
        {tabs.map(([k, label, ok]) => <button key={k} type="button" onClick={() => setTab(k)} className={cn(tabClass(tab === k), !ok && "opacity-50")}>{label}</button>)}
      </div>
      <div className="space-y-2 px-6 py-4 text-xs">
        {tab === "transfer" && (
          <>
            <p className="text-muted">Records goods leaving a bin. The ledger moves them when the destination scans them in, so an unreceived transfer leaves them booked at the source.</p>
            <label className="block">From<LocSelect locations={p.locations} value={from} onChange={setFrom} only={p.balances.map((b) => b.id)} /></label>
            <label className="block">To<LocSelect locations={p.locations} value={to} onChange={setTo} /></label>
            <label className="block">Quantity<input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={cn(inputClass, "w-full")} /></label>
            <Button size="sm" variant="primary" disabled={!p.perms.warehouse || api.pending} onClick={() => api.run(url, { action: "send_transfer", variantId: p.variantId, fromLocationId: from, toLocationId: to, qty: Number(qty), note: reason || undefined }, { ok: (d: { code: string }) => `Sent ${d.code}. Receive it at the destination to move the stock.` })}>Send</Button>
          </>
        )}
        {tab === "receive" && (
          p.pending.length ? p.pending.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2">
              <span>{t.label}</span>
              <Button size="sm" disabled={!p.perms.warehouse || api.pending} onClick={() => api.run(url, { action: "receive_transfer", transferId: t.id }, { ok: "Received; the ledger moved the stock." })}>Scan in</Button>
            </div>
          )) : <p className="text-muted">No transfers of {p.sku} waiting to be received.</p>
        )}
        {tab === "count" && (
          <>
            <p className="text-muted">Records what is physically there. The ledger doesn&apos;t change; a difference opens a StockSleuth case.</p>
            <label className="block">Location<LocSelect locations={p.locations} value={loc} onChange={setLoc} /></label>
            <label className="block">Counted<input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="numeric" className={cn(inputClass, "w-full")} /></label>
            <Button size="sm" variant="primary" disabled={!p.perms.warehouse || api.pending || counted === ""} onClick={() => api.run(url, { action: "count", scope: `Spot count of ${p.sku}`, lines: [{ variantId: p.variantId, locationId: loc, counted: Number(counted) }] }, { ok: (d: { code: string; lines: { recorded: number; counted: number }[] }) => `${d.code}: counted ${d.lines[0].counted}, recorded ${d.lines[0].recorded}${d.lines[0].counted !== d.lines[0].recorded ? " — StockSleuth will open a case." : "."}` })}>Record count</Button>
          </>
        )}
        {tab === "damage" && (
          <>
            <label className="block">Location<LocSelect locations={p.locations} value={loc} onChange={setLoc} only={p.balances.map((b) => b.id)} /></label>
            <label className="block">Quantity<input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={cn(inputClass, "w-full")} /></label>
            <label className="block">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Torn seam, stain…" className={cn(inputClass, "w-full")} /></label>
            <Button size="sm" disabled={!p.perms.warehouse || api.pending} onClick={() => api.run(url, { action: "damage", variantId: p.variantId, locationId: loc, qty: Number(qty), reason: reason || "Damaged" }, { ok: "Written off." })}>Write off</Button>
          </>
        )}
        {tab === "adjust" && (
          <>
            <p className="text-muted">Owner only. Adjust through an investigation where you can; a reason is required either way.</p>
            <label className="block">Location<LocSelect locations={p.locations} value={loc} onChange={setLoc} /></label>
            <label className="block">Change (e.g. −2)<input value={qty} onChange={(e) => setQty(e.target.value)} className={cn(inputClass, "w-full")} /></label>
            <label className="block">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} className={cn(inputClass, "w-full")} /></label>
            <Button size="sm" variant="danger" disabled={!p.perms.adjust || api.pending || !reason} onClick={() => api.run(url, { action: "adjust", variantId: p.variantId, locationId: loc, qty: Number(qty.replace("−", "-")), reason }, { ok: "Adjusted." })}>Adjust stock</Button>
            {!p.perms.adjust && <p className="text-warn">Only the owner can adjust stock.</p>}
          </>
        )}
        <Message message={api.message} />
      </div>
    </Card>
  );
}
