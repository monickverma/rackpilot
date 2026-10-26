"use client";

import { useState } from "react";
import { Message, useApi } from "@/components/client";
import { SparklesIcon } from "@/components/icons";
import { Badge, Button, Card, CardHeader, cn, inputClass } from "@/components/ui";
import type { Correction } from "@/lib/investigate/cases";

const OUTCOMES: [string, string][] = [
  ["record_corrected", "Record corrected"], ["goods_located", "Goods located"], ["adjustment_approved", "Adjustment approved"], ["counting_error", "Counting error"],
  ["legitimate_partial_fulfilment", "Legitimate partial fulfilment"], ["false_positive", "False positive"], ["awaiting_external_confirmation", "Awaiting external confirmation"],
];

export function CaseControls({ code, status, assigneeId, people, canWork, canClose }: { code: string; status: string; assigneeId: number | null; people: { id: number; name: string; title: string }[]; canWork: boolean; canClose: boolean }) {
  const api = useApi();
  const url = `/api/investigations/${code}`;
  const closed = status === "resolved" || status === "closed";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select value={assigneeId ?? ""} disabled={!canWork || status === "closed" || api.pending} onChange={(e) => api.run(url, { action: "assign", userId: e.target.value ? Number(e.target.value) : null }, { ok: "Assigned." })} className={cn(inputClass, "w-48")} aria-label="Owner">
          <option value="">Unassigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.title}</option>)}
        </select>
        {!closed && status !== "action_required" && <Button size="sm" disabled={!canWork || api.pending} onClick={() => api.run(url, { action: "status", status: "action_required" }, { ok: "Marked action required." })}>Action required</Button>}
        {!closed && status !== "investigating" && <Button size="sm" disabled={!canWork || api.pending} onClick={() => api.run(url, { action: "status", status: "investigating" })}>Investigating</Button>}
        {status === "resolved" && <Button size="sm" disabled={!canClose || api.pending} title={canClose ? undefined : "Only the owner can reopen"} onClick={() => api.run(url, { action: "status", status: "investigating", note: "Reopened" })}>Reopen</Button>}
        {status === "resolved" && <Button size="sm" variant="primary" disabled={!canClose || api.pending} title={canClose ? undefined : "Only the owner can close a case"} onClick={() => api.run(url, { action: "close" }, { ok: "Closed." })}>Close case</Button>}
      </div>
      <Message message={api.message} />
    </div>
  );
}

export function Explain({ code, ask, claude, last }: { code: string; ask: string; claude: boolean; last: { text: string; by: string; note: string | null; at: string } | null }) {
  const api = useApi();
  const [shown, setShown] = useState(last);
  return (
    <Card>
      <CardHeader icon={<SparklesIcon />} tone="info" title={`Why is ${ask} flagged?`} description={claude ? "Claude words it from this case's records only; any number or code not in them is rejected." : "Assembled from the findings. Add ANTHROPIC_API_KEY for a Claude-written version, checked against the records."} />
      <div className="space-y-2 px-6 py-4">
        <Button size="sm" variant="primary" disabled={api.pending} onClick={() => api.run(`/api/investigations/${code}`, { action: "explain", useClaude: true }, { then: (d: { text: string; by: string; note?: string }) => setShown({ text: d.text, by: d.by, note: d.note ?? null, at: new Date().toISOString() }) })}>
          {api.pending ? "Explaining…" : shown ? "Explain again" : "Explain"}
        </Button>
        {shown && (
          <div className="rounded-lg bg-subtle p-3 text-[13px] leading-6">
            <p className="whitespace-pre-line">{shown.text}</p>
            <p className="mt-2 text-xs text-faint">Explained by {shown.by === "claude" ? "Claude, checked against the records" : "rules"}.</p>
            {shown.note && <p className="mt-1 text-xs text-warn">{shown.note}</p>}
          </div>
        )}
        <Message message={api.message?.ok ? null : api.message} />
      </div>
    </Card>
  );
}

export function Checks({ code, checks, disabled }: { code: string; checks: { id: number; text: string; doneBy: string | null; done: boolean }[]; disabled: boolean }) {
  const api = useApi();
  const next = checks.find((c) => !c.done);
  return (
    <Card>
      <CardHeader title="Recommended next steps" description={next ? `Next: ${next.text}.` : "All suggested checks are done."} />
      <ul className="space-y-2 px-6 py-4">
        {checks.map((c) => (
          <li key={c.id}>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" checked={c.done} disabled={disabled || api.pending} onChange={(e) => api.run(`/api/investigations/${code}`, { action: "check", checkId: c.id, done: e.target.checked })} className="mt-1" />
              <span className={cn(c.done && "text-muted line-through")}>{c.text}{c.doneBy && <span className="ml-1 text-xs text-faint no-underline">· {c.doneBy}</span>}</span>
            </label>
          </li>
        ))}
      </ul>
      <Message message={api.message} className="px-6 pb-3" />
    </Card>
  );
}

export function Fixes({ code, fixes }: { code: string; fixes: Correction[] }) {
  const api = useApi();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  if (!fixes.length) return null;
  return (
    <Card>
      <CardHeader title="Authorised corrections" description="Each writes a new, audited record; nothing is overwritten. The checks re-run afterwards to show whether the records now agree." />
      <ul className="divide-y divide-line">
        {fixes.map((f) => (
          <li key={f.id} className="space-y-1.5 px-6 py-3">
            <div className="text-[13px] font-medium">{f.label}</div>
            <p className="text-xs text-muted">{f.detail}</p>
            {f.input && (f.input.kind === "select" ? (
              <select value={inputs[f.id] ?? ""} onChange={(e) => setInputs({ ...inputs, [f.id]: e.target.value })} className={cn(inputClass, "w-full")}>
                <option value="">{f.input.label}…</option>
                {f.input.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input value={inputs[f.id] ?? ""} onChange={(e) => setInputs({ ...inputs, [f.id]: e.target.value })} placeholder={f.input.label} inputMode="numeric" className={cn(inputClass, "w-32")} />
            ))}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!f.allowed || api.pending || (f.input ? !inputs[f.id] : false)} onClick={() => api.run(`/api/investigations/${code}`, { action: "correction", correctionId: f.id, input: f.input ? { [f.input.name]: inputs[f.id] } : {} }, { ok: (d: { summary: string }) => d.summary })}>Apply</Button>
              {!f.allowed && <Badge tone="neutral">Needs {f.permission.replace("stock.adjust", "the owner").replace("billing.write", "owner or accounts").replace("warehouse.write", "owner or warehouse").replace("orders.write", "owner or accounts")}</Badge>}
            </div>
          </li>
        ))}
      </ul>
      <Message message={api.message} className="px-6 pb-3" />
    </Card>
  );
}

export function Resolve({ code, allowed, suggested, example }: { code: string; allowed: boolean; suggested?: string; example: string }) {
  const api = useApi();
  const [outcome, setOutcome] = useState(suggested ?? "record_corrected");
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader title="Resolve" description="Record what was verified and the outcome. Findings still open are marked confirmed and won't reopen the case." />
      <div className="space-y-2 px-6 py-4">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={cn(inputClass, "w-full")} aria-label="Outcome">
          {OUTCOMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={`What did you verify? e.g. ${example}`} className={cn(inputClass, "h-auto w-full py-2")} />
        <Button size="sm" variant="primary" disabled={!allowed || api.pending || !note.trim()} onClick={() => api.run(`/api/investigations/${code}`, { action: "resolve", outcome, note }, { ok: "Resolved." })}>Resolve case</Button>
        {!allowed && <p className="text-xs text-warn">Your role can&apos;t resolve this kind of case.</p>}
        <Message message={api.message} />
      </div>
    </Card>
  );
}

export function NoteBox({ code, disabled }: { code: string; disabled: boolean }) {
  const api = useApi();
  const [note, setNote] = useState("");
  return (
    <Card>
      <CardHeader title="Add a note" />
      <div className="space-y-2 px-6 py-4">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={cn(inputClass, "h-auto w-full py-2")} placeholder="What you checked, who you spoke to…" />
        <Button size="sm" disabled={disabled || api.pending || !note.trim()} onClick={() => api.run(`/api/investigations/${code}`, { action: "note", body: note }, { ok: "Noted.", then: () => setNote("") })}>Add note</Button>
        <Message message={api.message} />
      </div>
    </Card>
  );
}
