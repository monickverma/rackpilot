"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Message, useApi } from "@/components/client";
import { Button, cn, inputClass, Table, Td, Th } from "@/components/ui";

interface Line { id: number; sku: string; what: string; location: string; path: string; qtyToPick: number; qtyPicked: number | null }

export function ConfirmPick({ code, pickListId, lines, open, allowed }: { code: string; pickListId: number; lines: Line[]; open: boolean; allowed: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState(() => Object.fromEntries(lines.map((l) => [l.id, l.qtyPicked ?? l.qtyToPick])));
  const api = useApi();
  const pending = lines.filter((l) => l.qtyPicked === null);
  return (
    <>
      <Table>
        <thead><tr><Th>#</Th><Th>Location</Th><Th>Item</Th><Th align="right">To pick</Th><Th align="right">Picked</Th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id}>
              <Td className="text-faint tabular">{i + 1}</Td>
              <Td><span className="font-mono text-[13px] font-medium">{l.location}</span><div className="text-xs text-muted">{l.path}</div></Td>
              <Td><span className="font-mono text-[12px]">{l.sku}</span><div className="text-xs text-muted">{l.what}</div></Td>
              <Td align="right" className="text-[15px] font-medium">{l.qtyToPick}</Td>
              <Td align="right">
                {l.qtyPicked !== null ? <span className={cn(l.qtyPicked < l.qtyToPick && "text-bad")}>{l.qtyPicked}</span> : (
                  <input type="number" min={0} max={l.qtyToPick} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} className={cn(inputClass, "no-print w-20 text-right")} aria-label={`Picked ${l.sku}`} />
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {open && pending.length > 0 && (
        <div className="no-print flex flex-wrap items-center gap-3 border-t border-line px-6 py-4">
          <Button variant="primary" disabled={!allowed || api.pending} onClick={() => api.run(`/api/orders/${code}`, { action: "confirm_pick", pickListId, lines: pending.map((l) => ({ lineId: l.id, qtyPicked: qty[l.id] ?? 0 })) }, { then: () => router.push(`/orders/${code}`) })}>
            {api.pending ? "Saving…" : "Confirm picked quantities"}
          </Button>
          <span className="text-xs text-muted">If a bin has fewer than listed, enter what you found: the rest is released and the bin is flagged for a recount.</span>
          <Message message={api.message} />
        </div>
      )}
    </>
  );
}
