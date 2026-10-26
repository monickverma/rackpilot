import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseBadge, certaintyLabel, KindBadge, ModuleBadge, PriorityBadge } from "@/components/status";
import { Badge, Card, CardHeader, cn, PageHeader, RecordLink } from "@/components/ui";
import { requireSession, teammates } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime, rupees, titleCase, when } from "@/lib/format";
import { corrections, getCase, type CaseFinding } from "@/lib/investigate/cases";
import { lastExplanation } from "@/lib/investigate/explain";
import { RULES } from "@/lib/investigate/types";
import { claudeConfigured } from "@/lib/ai/claude";
import { CaseControls, Checks, Explain, Fixes, NoteBox, Resolve } from "./controls";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  return { title: `Investigation ${(await params).code.toUpperCase()}` };
}

const value = (f: CaseFinding, n: number | null) => (n === null ? "—" : f.unit === "₹" ? rupees(n) : `${n}`);

export default async function CasePage({ params }: { params: Promise<{ code: string }> }) {
  const s = await requireSession();
  const code = (await params).code.toUpperCase();
  const c = await getCase(s, code);
  if (!c) notFound();
  const now = new Date();
  const [fixes, people, explained] = await Promise.all([corrections(s, c), teammates(s), lastExplanation(c.id)]);
  const lead = c.findings.find((f) => f.kind === "fact" && f.status === "open" && f.expected !== null) ?? c.findings.find((f) => f.kind === "fact" && f.expected !== null) ?? c.findings[0];
  const diff = lead && lead.expected !== null && lead.actual !== null ? lead.actual - lead.expected : null;
  const groups = [
    ["fact", "Facts", "What the records establish."],
    ["inference", "Inferences", "What the facts suggest. Not yet verified."],
    ["hypothesis", "Unverified hypotheses", "Possible causes. Each lists the evidence that would settle it."],
  ] as const;
  const closed = c.status === "resolved" || c.status === "closed";
  const resolverOk = can(s, c.code.startsWith("SS") ? "investigations.resolve.stocksleuth" : "investigations.resolve.ordertrace");
  const ask = c.subjectType === "order" || c.subjectType === "payment" ? c.subjectCode : c.code;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2.5">Investigation {c.code} <CaseBadge status={c.status} /> <PriorityBadge priority={c.priority} /></span>}
        description={<span className="flex flex-wrap items-center gap-2"><ModuleBadge module={c.module} /> <span>{c.subjectType === "stock" ? "SKU" : titleCase(c.subjectType)} <RecordLink code={c.subjectCode.split(" @ ")[0]} />{c.subjectCode.includes(" @ ") && <> at <RecordLink code={c.subjectCode.split(" @ ")[1]} /></>}</span> <span>· detected {when(c.detectedAt, now)}</span></span>}
        actions={<CaseControls code={c.code} status={c.status} assigneeId={c.assigneeId} people={people} canWork={can(s, "investigations.work")} canClose={can(s, "investigations.close")} />}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-3">
          {lead && (
            <Card>
              <div className="grid gap-px bg-line md:grid-cols-[minmax(0,1fr)_240px]">
                <div className="bg-panel px-6 py-5">
                  <div className="text-xs text-muted">Finding · {RULES[lead.rule]?.name ?? lead.rule}</div>
                  <h2 className="mt-1 text-[17px] font-medium leading-6">{c.title}</h2>
                  <p className="mt-2 txt-small text-muted">{lead.detail}</p>
                  {lead.calculation && <p className="mt-2 font-mono text-[12px]">{lead.calculation}</p>}
                </div>
                <div className="bg-panel px-6 py-5">
                  {diff !== null ? (
                    <>
                      <div className={cn("text-3xl font-medium tracking-tight tabular", diff !== 0 && "text-bad")}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{lead.unit === "₹" ? rupees(Math.abs(diff)) : Math.abs(diff)} {lead.unit !== "₹" ? lead.unit : ""}</div>
                      <div className="mt-1 text-xs text-muted">{lead.rule === "SS-COUNT" ? `Recorded: ${value(lead, lead.expected)} · Counted: ${value(lead, lead.actual)}` : `Expected ${value(lead, lead.expected)} · recorded ${value(lead, lead.actual)}`}</div>
                    </>
                  ) : <div className="text-sm text-muted">See the findings.</div>}
                  <p className="mt-3 text-xs text-faint">{lead.rule === "SS-COUNT" ? "A variance is a discrepancy, not proof of loss." : "A mismatch, not proof of its cause."}</p>
                </div>
              </div>
              {closed && <div className="border-t border-line bg-ok-soft/40 px-6 py-3 text-[13px]"><span className="font-medium">Resolved as {titleCase(c.outcome ?? "")}</span> by {c.resolvedBy} · {c.resolvedAt && dateTime(c.resolvedAt)}: {c.resolutionNote}</div>}
            </Card>
          )}

          {groups.map(([kind, title, desc]) => {
            const list = c.findings.filter((f) => f.kind === kind);
            if (!list.length) return null;
            return (
              <Card key={kind}>
                <CardHeader title={title} description={desc} />
                <ul className="divide-y divide-line">
                  {list.map((f) => (
                    <li key={f.id} className={cn("px-6 py-3.5", f.status === "no_longer_reproduces" && "opacity-60")}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <KindBadge kind={f.kind} />
                        <ModuleBadge module={f.module} />
                        <span className="font-mono text-[11px] text-faint">{f.rule} v{f.version}</span>
                        <span className="text-xs text-muted">· {certaintyLabel(f.certainty)}</span>
                        {f.status === "no_longer_reproduces" && <Badge tone="ok">Records now agree</Badge>}
                        {f.status === "confirmed" && <Badge tone="neutral">Confirmed at resolution</Badge>}
                      </div>
                      <div className="mt-1.5 text-[13px] font-medium">{f.title}</div>
                      <p className="mt-0.5 text-xs text-muted">{f.detail}</p>
                      {f.calculation && f !== lead && <p className="mt-1 font-mono text-[11px] text-fg">{f.calculation}</p>}
                      {f.exceptions.length > 0 && (
                        <details className="mt-1.5 text-xs">
                          <summary className="cursor-pointer text-muted">Valid exceptions checked ({f.exceptions.length})</summary>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{f.exceptions.map((e) => <li key={e}>{e}</li>)}</ul>
                        </details>
                      )}
                      {f.missing.length > 0 && <p className="mt-1 text-xs text-warn">Evidence still missing: {f.missing.join("; ")}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}

          <Card>
            <CardHeader title="Evidence trail" description="The source records in time order. Each links to the record itself." />
            <ol className="relative space-y-4 px-6 py-5">
              {c.timeline.map((e) => (
                <li key={e.id} className="grid grid-cols-[96px_1fr] gap-3">
                  <span className="text-xs text-muted tabular">{when(e.at, now)}</span>
                  <div className="border-l-2 border-line pl-3">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">{e.label} {e.code && !e.code.startsWith("RES-") && !e.code.startsWith("MOV-") && <RecordLink code={e.code.split(" @ ")[0]} />}</div>
                    <p className="text-xs text-muted">{e.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="Resolution history and audit trail" description="Who did what, when. Nothing here can be edited." />
            <ol className="divide-y divide-line">
              {c.events.map((e) => (
                <li key={e.id} className="grid grid-cols-[110px_1fr] gap-3 px-6 py-2.5 text-xs">
                  <span className="text-muted tabular">{when(e.at, now)}</span>
                  <span><span className="font-medium">{e.actor ?? "System"}</span> <Badge tone="neutral" className="mx-1">{e.type}</Badge> <span className="text-muted">{e.body}</span></span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-3">
          <Explain code={c.code} ask={ask} claude={claudeConfigured()} last={explained ? { text: explained.body, by: (explained.data.by as string) ?? "rules", note: (explained.data.note as string | null) ?? null, at: explained.at.toISOString() } : null} />
          <Checks code={c.code} checks={c.checks.map((x) => ({ id: x.id, text: x.text, doneBy: x.doneBy, done: Boolean(x.doneAt) }))} disabled={closed || !can(s, "investigations.work")} />
          {!closed && <Fixes code={c.code} fixes={fixes} />}
          {!closed && <Resolve code={c.code} allowed={resolverOk} suggested={fixes[0]?.outcome} example={c.code.startsWith("SS") ? "4 tees found in the packing area and 2 on the showroom rail; put back and transfer received." : "Packing slip shows 20 shirts; supplementary invoice issued."} />}
          <NoteBox code={c.code} disabled={!can(s, "investigations.work")} />
          {c.orderId && <Card className="px-6 py-3 text-xs"><Link href={`/orders/${c.subjectCode}`} className="text-accent hover:underline">Open {c.subjectCode} with all its linked records →</Link></Card>}
          {c.caseKey.startsWith("stock:") && <Card className="px-6 py-3 text-xs"><Link href={`/stocksleuth?sku=${c.subjectCode.split(" @ ")[0]}&loc=${c.subjectCode.split(" @ ")[1]}`} className="text-accent hover:underline">Reconstruct this location&apos;s movements in StockSleuth →</Link></Card>}
        </div>
      </div>
    </>
  );
}
