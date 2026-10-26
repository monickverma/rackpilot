"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton, Message, useApi } from "@/components/client";
import { Button, Card, CardHeader, cn, inputClass } from "@/components/ui";

export function PlanForm({ defaultBudget }: { defaultBudget: number }) {
  const router = useRouter();
  const [budget, setBudget] = useState(String(defaultBudget));
  const api = useApi();
  return (
    <Card>
      <CardHeader title="“I've got ₹30,000. What should I order?”" description="Generates and saves a proposal you can review before anything is ordered." />
      <div className="space-y-3 px-6 py-4">
        <label className="block text-xs text-muted">Budget (₹)
          <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" className={cn(inputClass, "mt-1 w-full text-[15px]")} />
        </label>
        <div className="flex flex-wrap gap-1.5">{[15000, 30000, 75000, 150000].map((b) => <Button key={b} size="sm" variant="ghost" onClick={() => setBudget(String(b))}>₹{b.toLocaleString("en-IN")}</Button>)}</div>
        <Button variant="primary" disabled={api.pending || Number(budget) < 1000} onClick={() => api.run("/api/purchasing", { action: "plan", budget: Number(budget) }, { then: (d: { code: string }) => router.push(`/purchasing/${d.code}`) })}>
          {api.pending ? "Planning…" : "Make a purchase plan"}
        </Button>
        <Message message={api.message} />
      </div>
    </Card>
  );
}

export function ReceivePO({ id, allowed }: { id: number; allowed: boolean }) {
  return <ActionButton size="sm" url="/api/purchasing" body={{ action: "receive", purchaseOrderId: id }} disabled={!allowed} ok="Received into the home bins; backorders reserved.">Receive</ActionButton>;
}

export function PlanDecision({ code, allowed }: { code: string; allowed: boolean }) {
  const api = useApi();
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="primary" disabled={!allowed || api.pending} title={allowed ? undefined : "Only the owner can approve"} onClick={() => api.run("/api/purchasing", { action: "approve", code }, { ok: (d: string[]) => `Approved: placed ${d.join(", ")}.` })}>Approve and place POs</Button>
        <Button disabled={!allowed || api.pending} onClick={() => api.run("/api/purchasing", { action: "reject", code, reason: "Not now" }, { ok: "Rejected." })}>Reject</Button>
      </div>
      <Message message={api.message} />
    </div>
  );
}
