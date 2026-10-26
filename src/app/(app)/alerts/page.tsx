import type { Metadata } from "next";
import Link from "next/link";
import { SeverityBadge } from "@/components/status";
import { Card, CardHeader, Empty, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { ALERT_RULES, alerts, type AlertKind } from "@/lib/intel/alerts";

export const metadata: Metadata = { title: "Alerts" };

const ORDER: AlertKind[] = ["cannot_fulfil", "competing", "deadline", "low_stock", "verify_location", "count_discrepancy", "transaction", "unsold"];

export default async function Alerts() {
  const s = await requireSession();
  const list = await alerts(s);
  return (
    <>
      <PageHeader title="Stock alerts and exceptions" description="Problems found by explicit rules over the data, so nobody has to inspect every record. Each group shows the rule; each alert shows the numbers that triggered it." />
      <div className="grid gap-3 lg:grid-cols-2">
        {ORDER.map((k) => {
          const items = list.filter((a) => a.kind === k);
          return (
            <Card key={k}>
              <CardHeader title={`${ALERT_RULES[k].name} (${items.length})`} description={ALERT_RULES[k].rule} />
              {items.length ? (
                <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                  {items.map((a, i) => (
                    <li key={i} className="px-6 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={a.href} className="text-[13px] font-medium hover:underline">{a.title}</Link>
                        <SeverityBadge severity={a.severity} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : <Empty>Nothing triggered this rule.</Empty>}
            </Card>
          );
        })}
      </div>
    </>
  );
}
