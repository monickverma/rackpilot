"use client";

import { useState } from "react";
import { ActionButton, callApi, Message, useApi } from "@/components/client";
import { Button, Card, CardHeader, cn, inputClass } from "@/components/ui";

export function ReceiveTransfer({ id, allowed }: { id: number; allowed: boolean }) {
  return <ActionButton size="sm" url="/api/stock" body={{ action: "receive_transfer", transferId: id }} disabled={!allowed} ok="Received.">Scan in</ActionButton>;
}

/**
 * A count sheet: one line per "SKU location qty" (or "SKU qty" for the home bin),
 * as typed from a paper sheet or a handheld export.
 */
export function CountSheet({ allowed }: { allowed: boolean }) {
  const [text, setText] = useState("BLK-TSH-S A-R12-S3-B11 12\nBLK-TSH-L 18");
  const [problems, setProblems] = useState<string[]>([]);
  const api = useApi();
  async function submit() {
    const lines: { variantId: number; locationId: number; counted: number }[] = [];
    const bad: string[] = [];
    for (const raw of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const parts = raw.split(/[\s,;]+/);
      const sku = parts[0];
      const counted = Number(parts.at(-1));
      const loc = parts.length >= 3 ? parts[1] : null;
      const found = await callApi<{ sku: string; locations: { locationId: number; code: string }[] }[]>(`/api/inventory?q=${encodeURIComponent(sku)}`, undefined, "GET");
      const hit = found.ok ? found.data?.find((x) => x.sku === sku.toUpperCase()) : undefined;
      if (!hit || !Number.isInteger(counted)) {
        bad.push(`${raw}: ${!hit ? "unknown SKU" : "no count"}`);
        continue;
      }
      const where = loc ? hit.locations.find((l) => l.code === loc.toUpperCase()) : hit.locations[0];
      if (!where) {
        bad.push(`${raw}: no recorded stock at ${loc}; count it from the SKU's stock card to record stock found there`);
        continue;
      }
      lines.push({ variantId: (await skuId(sku)) ?? 0, locationId: where.locationId, counted });
    }
    setProblems(bad);
    if (lines.length) api.run("/api/stock", { action: "count", scope: "Count sheet", source: "sheet", lines }, { ok: (d: { code: string; lines: { sku: string; recorded: number; counted: number }[] }) => `${d.code}: ${d.lines.filter((l) => l.recorded !== l.counted).length} of ${d.lines.length} lines differ from the record.` });
  }
  return (
    <Card>
      <CardHeader title="Enter a count sheet" description='One line each: "SKU location counted", or "SKU counted" for its main location.' />
      <div className="space-y-2 px-6 py-4">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={cn(inputClass, "h-auto w-full py-2 font-mono text-[12px]")} />
        <Button size="sm" variant="primary" disabled={!allowed || api.pending} onClick={submit}>{api.pending ? "Saving…" : "Record count"}</Button>
        {problems.map((p) => <p key={p} className="text-xs text-warn">{p}</p>)}
        <Message message={api.message} />
      </div>
    </Card>
  );
}

const ids = new Map<string, number>();
async function skuId(sku: string) {
  if (ids.has(sku)) return ids.get(sku);
  const r = await callApi<{ variantId: number }>(`/api/inventory/id?sku=${encodeURIComponent(sku)}`, undefined, "GET");
  if (r.ok && r.data) ids.set(sku, r.data.variantId);
  return r.data?.variantId;
}
