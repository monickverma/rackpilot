"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { callApi } from "@/components/client";
import { SparklesIcon } from "@/components/icons";
import { Badge, Button, Card, CardHeader, cn, inputClass, Table, Td, Th } from "@/components/ui";
import type { Answer } from "@/lib/intel/assistant";

export function AskBox({ examples, claude }: { examples: string[]; claude: boolean }) {
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function ask(qn = question) {
    if (!qn.trim()) return;
    setError(null);
    start(async () => {
      const r = await callApi<Answer>("/api/assistant", { question: qn, useClaude: true });
      if (!r.ok || !r.data) return setError(r.error ?? "Couldn't answer that.");
      setAnswers((a) => [r.data!, ...a]);
      setQuestion("");
    });
  }
  return (
    <div className="space-y-3">
      <Card>
        <div className="space-y-3 px-6 py-4">
          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
            <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Which sizes are selling fastest this month?" className={cn(inputClass, "h-9 flex-1 text-[14px]")} />
            <Button type="submit" variant="primary" disabled={pending}>{pending ? "Working…" : "Ask"}</Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {examples.map((x) => <button key={x} type="button" onClick={() => ask(x)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-panel-2 hover:text-fg">{x}</button>)}
          </div>
          <p className="text-xs text-faint">{claude ? "Claude picks the template and words the answer; any number it writes that isn't in the results is rejected." : "Routing and wording by rules. Add ANTHROPIC_API_KEY to let Claude route questions and word answers (still checked against the results)."}</p>
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
      </Card>
      {answers.map((a, i) => (
        <Card key={i}>
          <CardHeader icon={<SparklesIcon />} tone="info" title={a.question} description={<span className="flex flex-wrap gap-1.5"><Badge tone="neutral">{a.template ?? "no template"}</Badge><Badge tone="neutral">routed by {a.routedBy}</Badge><Badge tone="neutral">worded by {a.explainedBy}</Badge></span>} />
          <div className="space-y-3 px-6 py-4">
            <p className="whitespace-pre-line text-[14px] leading-6">{a.text}</p>
            {a.note && <p className="text-xs text-warn">{a.note}</p>}
            {a.links.length > 0 && <div className="flex flex-wrap gap-2 text-xs">{a.links.map((l) => <Link key={l.href + l.label} href={l.href} className="text-accent hover:underline">{l.label} →</Link>)}</div>}
          </div>
          {a.table && a.table.rows.length > 0 && (
            <Table className="border-t border-line">
              <thead><tr>{a.table.columns.map((c) => <Th key={c}>{c}</Th>)}</tr></thead>
              <tbody>{a.table.rows.slice(0, 15).map((r, j) => <tr key={j}>{r.map((v, k) => <Td key={k} className={typeof v === "string" && v.length > 60 ? "text-xs text-muted" : undefined}>{v}</Td>)}</tr>)}</tbody>
            </Table>
          )}
          <p className="border-t border-line px-6 py-2.5 text-xs text-faint">How it was computed: {a.method}</p>
        </Card>
      ))}
    </div>
  );
}
