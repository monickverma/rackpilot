import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { q } from "@/db/client";
import { claudeConfigured } from "@/lib/ai/claude";
import { requireSession } from "@/lib/auth";
import { TEMPLATES } from "@/lib/intel/assistant";
import { AskBox } from "./ask";

export const metadata: Metadata = { title: "Ask your business" };

const EXAMPLES = [
  "Which sizes are selling fastest this month?",
  "Show me orders we cannot fulfil with current stock.",
  "Which products have been sitting unsold for 45 days?",
  "Why are we running out of black oversized tees?",
  "What would happen if I spent ₹30,000 on replenishment?",
  "Which products should I consider ordering less of?",
  "Why is order ORD-1042 flagged?",
  "What is Tiruppur Knit Mills' minimum order?",
  "Where is BLK-TSH-M?",
];

export default async function Assistant() {
  const s = await requireSession();
  const docs = await q<{ title: string; kind: string; sections: number }>(
    `SELECT d.title, d.kind, COUNT(c.id)::int AS sections FROM documents d JOIN document_chunks c ON c.document_id = d.id WHERE d.business_id = $1 GROUP BY d.id ORDER BY d.kind DESC, d.title`,
    s.businessId,
  );
  return (
    <>
      <PageHeader
        title="Ask your business"
        description="Ask in ordinary words. The question goes to one of a fixed set of query templates; the database does every calculation, and the answer cites how it was computed. A language model never writes SQL and never supplies a number."
      />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AskBox examples={EXAMPLES} claude={claudeConfigured()} />
        <div className="space-y-3">
          <Card>
            <CardHeader title="What it can answer" description="Each is a template over the database." />
            <ul className="space-y-1.5 px-6 py-4 text-xs">{Object.entries(TEMPLATES).map(([k, v]) => <li key={k}><span className="font-mono text-faint">{k}</span><div className="text-muted">{v}</div></li>)}</ul>
          </Card>
          <Card id="policies">
            <CardHeader title="Documents it searches" description="Supplier terms and house policies, indexed with Postgres full-text search." />
            <ul className="divide-y divide-line">{docs.map((d) => <li key={d.title} className="px-6 py-2 text-xs"><span className="font-medium">{d.title}</span><div className="text-faint">{d.kind === "supplier_terms" ? "Supplier terms" : "Policy"} · {d.sections} sections</div></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
