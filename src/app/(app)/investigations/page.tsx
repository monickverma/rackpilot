import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { CaseBadge, ModuleBadge, PriorityBadge } from "@/components/status";
import { Card, CardHeader, Empty, PageHeader, Stat, Table, Td, Th, tabClass } from "@/components/ui";
import { q } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { ago, titleCase } from "@/lib/format";
import { listCases } from "@/lib/investigate/cases";
import { RULES } from "@/lib/investigate/types";

export const metadata: Metadata = { title: "Investigation Centre" };

export default async function Investigations({ searchParams }: { searchParams: Promise<{ status?: string; module?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const status = (sp.status as "open" | "closed" | "all") ?? "open";
  const [rows, all, byRule] = await Promise.all([
    listCases(s, { status, module: sp.module }),
    listCases(s, { status: "all" }),
    q<{ rule: string; open: number; total: number }>(
      `SELECT f.rule_id AS rule, COUNT(*) FILTER (WHERE f.status = 'open')::int AS open, COUNT(*)::int AS total FROM investigation_findings f
         JOIN investigations i ON i.id = f.investigation_id WHERE i.business_id = $1 AND f.kind = 'fact' GROUP BY 1`,
      s.businessId,
    ),
  ]);
  const now = new Date();
  const open = all.filter((c) => !["resolved", "closed"].includes(c.status));
  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.status && { status: sp.status }), ...(sp.module && { module: sp.module }), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/investigations${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      <PageHeader
        title="Investigation Centre"
        description="One queue for OrderTrace and StockSleuth. Each case keeps verified facts, inferences and unverified hypotheses apart, cites its source records, and stays open until an authorised person records what was verified."
        actions={<ActionButton url="/api/investigations" body={{ action: "run_checks" }} ok="Checks ran: the queue is up to date." variant="primary">Run checks now</ActionButton>}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open cases" value={open.length} sub={`${open.filter((c) => c.priority === "high").length} high priority`} tone={open.length ? "bad" : "ok"} />
        <Stat label="OrderTrace" value={open.filter((c) => c.code.startsWith("OT")).length} sub="Orders, invoices, payments, dispatch" tone="accent" />
        <Stat label="StockSleuth" value={open.filter((c) => c.code.startsWith("SS")).length} sub="Counts, movements, locations" tone="info" />
        <Stat label="Resolved or closed" value={all.length - open.length} sub="With documented outcomes" tone="ok" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2.5">
          {[["open", "Open"], ["closed", "Resolved and closed"], ["all", "All"]].map(([k, l]) => <Link key={k} href={link({ status: k })} className={tabClass(status === k)}>{l}</Link>)}
          <span className="mx-2 h-4 border-l border-line" />
          {[["", "Both modules"], ["ordertrace", "OrderTrace"], ["stocksleuth", "StockSleuth"]].map(([k, l]) => <Link key={k} href={link({ module: k })} className={tabClass((sp.module ?? "") === k)}>{l}</Link>)}
        </div>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Case</Th><Th>Finding</Th><Th>Modules</Th><Th>Priority</Th><Th>Status</Th><Th>Owner</Th><Th>Detected</Th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code} className="hover:bg-panel-2">
                  <Td><Link href={`/investigations/${c.code}`} className="font-mono text-[12px] font-medium text-accent hover:underline">{c.code}</Link></Td>
                  <Td><Link href={`/investigations/${c.code}`} className="hover:underline">{c.title}</Link><div className="text-xs text-muted">{c.subjectCode} · {c.open} of {c.facts} facts open{c.outcome ? ` · ${titleCase(c.outcome)}` : ""}</div></Td>
                  <Td><ModuleBadge module={c.module} /></Td>
                  <Td><PriorityBadge priority={c.priority} /></Td>
                  <Td><CaseBadge status={c.status} /></Td>
                  <Td className="text-muted">{c.assignee ?? "Unassigned"}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{ago(c.detectedAt, now)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty>No cases here.</Empty>}
      </Card>
      <Card className="mt-3">
        <CardHeader title="The rules" description="Explicit, deterministic reconciliation rules. An LLM never decides whether records agree." />
        <Table>
          <thead><tr><Th>Rule</Th><Th>Module</Th><Th>What it detects</Th><Th align="right">Open facts</Th><Th align="right">All time</Th></tr></thead>
          <tbody>
            {Object.entries(RULES).map(([id, r]) => {
              const n = byRule.find((x) => x.rule === id);
              return (
                <tr key={id}>
                  <Td><span className="font-mono text-[12px]">{id}</span> <span className="font-medium">{r.name}</span></Td>
                  <Td><ModuleBadge module={r.module} /></Td>
                  <Td className="text-muted">{r.detects}</Td>
                  <Td align="right">{n?.open ?? 0}</Td>
                  <Td align="right">{n?.total ?? 0}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
