import type { Metadata } from "next";
import report from "../../../../data/test-report.json" with { type: "json" };
import { Badge, Card, CardHeader, cn, PageHeader, Table, Td, Th } from "@/components/ui";
import { one } from "@/db/client";
import { requireSession } from "@/lib/auth";
import { evalIntake, evalRetrieval } from "@/lib/eval";
import { dateTime, pct } from "@/lib/format";
import { backtest } from "@/lib/intel/demand";

export const metadata: Metadata = { title: "Measurements" };

export default async function Metrics() {
  const s = await requireSession();
  const [intake, retrieval, bt, inv, res, pick, cases] = await Promise.all([
    s.businessId === 1 ? evalIntake(s) : null,
    s.businessId === 1 ? evalRetrieval(s) : null,
    backtest(s),
    one<{ lines: number; exact: number; absVar: number; recorded: number }>(
      `SELECT COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE l.counted_qty = l.recorded_qty)::int AS exact,
              COALESCE(SUM(ABS(l.counted_qty - l.recorded_qty)), 0)::int AS "absVar", COALESCE(SUM(l.recorded_qty), 0)::int AS recorded
         FROM stock_count_lines l JOIN physical_stock_counts c ON c.id = l.count_id WHERE c.business_id = $1`,
      s.businessId,
    ),
    one<{ oversold: number; overheld: number; balances: number; ledgerOk: number }>(
      `SELECT (SELECT COUNT(*)::int FROM inventory_balances WHERE business_id = $1 AND reserved > on_hand) AS oversold,
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.business_id = $1 AND (SELECT COALESCE(SUM(qty), 0) FROM reservations r WHERE r.order_item_id = oi.id AND r.status <> 'released') > oi.qty_ordered) AS overheld,
              (SELECT COUNT(*)::int FROM inventory_balances WHERE business_id = $1) AS balances,
              (SELECT COUNT(*)::int FROM inventory_balances b WHERE b.business_id = $1 AND b.on_hand = COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.variant_id = b.variant_id AND m.location_id = b.location_id), 0)) AS "ledgerOk"`,
      s.businessId,
    ),
    one<{ lists: number; lines: number; racks: number }>(
      `SELECT COUNT(DISTINCT pl.id)::int AS lists, COUNT(pli.id)::int AS lines, COUNT(DISTINCT (pl.id, l.rack))::int AS racks
         FROM pick_lists pl JOIN pick_list_items pli ON pli.pick_list_id = pl.id JOIN locations l ON l.id = pli.location_id WHERE pl.business_id = $1`,
      s.businessId,
    ),
    one<{ shipped: number; ledger: number; billedLines: number; billedTotals: number }>(
      `SELECT (SELECT COALESCE(SUM(si.qty), 0)::int FROM shipment_items si JOIN shipments sh ON sh.id = si.shipment_id WHERE sh.business_id = $1) AS shipped,
              (SELECT COALESCE(-SUM(qty), 0)::int FROM stock_movements WHERE business_id = $1 AND type = 'dispatch') AS ledger,
              (SELECT COALESCE(SUM(ii.qty * ii.unit_price), 0)::int FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.business_id = $1) AS "billedLines",
              (SELECT COALESCE(SUM(t), 0)::int FROM (SELECT (SELECT SUM(qty * unit_price) FROM invoice_items WHERE invoice_id = i.id) AS t FROM invoices i WHERE i.business_id = $1) x) AS "billedTotals"`,
      s.businessId,
    ),
  ]);
  const passed = report.results.filter((r) => r.passed).length;
  const rows: [string, string, React.ReactNode, string][] = [
    ["Order intake", "Accuracy of extracted variants and quantities", intake ? <>{intake.exact}/{intake.cases} messages fully right ({pct(intake.exact / intake.cases)}); dev {intake.bySet.dev?.exact}/{intake.bySet.dev?.cases}, holdout {intake.bySet.holdout?.exact}/{intake.bySet.holdout?.cases}; {intake.lines.correct}/{intake.lines.expected} lines; ambiguous lines asked {intake.asked.correct}/{intake.asked.expected}; unknown variants refused {intake.refused.correct}/{intake.refused.expected}; wrong SKUs chosen: {intake.wrongSku}</> : "Test set is for the main demo business", "Rule reader on 44 hand-written messages (data/intake-testset.json), live. The Claude reader isn't scored here: it needs an API key and a paid run."],
    ["Inventory", "Recorded vs verified physical stock", <>{inv!.exact}/{inv!.lines} counted lines matched the record; total absolute variance {inv!.absVar} units on {inv!.recorded} recorded ({pct(inv!.recorded ? inv!.absVar / inv!.recorded : 0)})</>, "All physical count lines in this business."],
    ["Reservations", "Duplicate allocations or oversold orders", <>{res!.oversold} balances reserved beyond on-hand; {res!.overheld} order lines holding more than ordered; concurrency test: {report.results.find((r) => r.name.startsWith("Simultaneous"))?.passed ? "passed" : "failed"}</>, "Live invariants plus the simultaneous-orders test. A CHECK constraint makes overselling impossible to store."],
    ["Fulfilment", "Time to locate and pick", <>Not measured: needs timed trials with staff. Proxy: {pick!.lists} pick lists, {(pick!.lines / Math.max(pick!.lists, 1)).toFixed(1)} lines and {(pick!.racks / Math.max(pick!.lists, 1)).toFixed(1)} racks each, sorted in walking order</>, "Pick lists sorted by rack, shelf and bin."],
    ["Retrieval", "Right policy information retrieved", retrieval ? <>Right section first for {retrieval.top1}/{retrieval.cases} questions, in the top 3 for {retrieval.top3}/{retrieval.cases}</> : "—", "12 questions about supplier terms and policies (data/retrieval-testset.json), live. The set was used while tuning; it is not a holdout."],
    ["Analytics", "Accuracy of stock, sales and margin figures", <>{res!.ledgerOk}/{res!.balances} balances equal their ledger; units shipped {cases!.shipped} = dispatch movements {cases!.ledger}: {cases!.shipped === cases!.ledger ? "agree" : "differ"}; invoice lines {cases!.billedLines} = invoice totals {cases!.billedTotals}: {cases!.billedLines === cases!.billedTotals ? "agree" : "differ"}</>, "Each figure computed two independent ways. The one planted balance edit is the expected exception."],
    ["Recommendations", "Historical forecast error", <>WAPE {pct(bt.productWape)} per product-week (repeat-last-week: {pct(bt.productNaiveWape)}), {pct(bt.wape)} per variant-week (naive {pct(bt.naiveWape)}), {pct(bt.totalWape)} for total weekly demand; bias {bt.bias >= 0 ? "+" : "−"}{pct(Math.abs(bt.bias))}</>, `Backtest over ${bt.weeks} weeks of this business's orders, live. Usefulness of the proposed quantities isn't measured: that needs owners' feedback.`],
    ["Reliability", "Successful end-to-end workflows", <>{passed}/{report.results.length} tests passed, including the full demo scenario</>, `npm test, last run ${dateTime(report.ranAt)} on Node ${report.node}.`],
  ];
  return (
    <>
      <PageHeader title="Measurements" description="How well the prototype actually works, measured rather than claimed (spec section 9). Live where the data allows; the rest comes from the test run in the repository." />
      <Card>
        <Table>
          <thead><tr><Th>Area</Th><Th>Metric</Th><Th>Result</Th><Th>How it was measured</Th></tr></thead>
          <tbody>{rows.map(([a, m, r, h]) => <tr key={a} className="align-top"><Td className="font-medium">{a}</Td><Td className="text-muted">{m}</Td><Td className="max-w-md">{r}</Td><Td className="max-w-sm text-xs text-muted">{h}</Td></tr>)}</tbody>
        </Table>
      </Card>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="Test run" description="Edge cases from section 9 and the demo scenario." />
          <ul className="divide-y divide-line">
            {report.results.map((r) => (
              <li key={r.name} className="px-6 py-2.5">
                <div className="flex items-start justify-between gap-2 text-[13px]"><span><span className="text-xs text-faint">{r.area} · </span>{r.name}</span><Badge tone={r.passed ? "ok" : "bad"}>{r.passed ? "pass" : "fail"}</Badge></div>
                <p className="mt-0.5 text-xs text-muted">{r.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
        {intake && (
          <Card>
            <CardHeader title="Order intake test set" description="Every message and what the rule reader made of it." />
            <ul className="max-h-[900px] divide-y divide-line overflow-y-auto">
              {intake.results.map((r) => (
                <li key={r.id} className="px-6 py-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2"><span><span className="font-mono text-faint">{r.id}</span> <span className="text-fg">{r.text}</span></span><Badge tone={r.ok ? "ok" : "bad"}>{r.ok ? "right" : "wrong"}</Badge></div>
                  {!r.ok && <ul className="mt-1 space-y-0.5">{r.lines.map((l, i) => <li key={i} className={cn(l.ok ? "text-muted" : "text-bad")}>{l.expected} → {l.got}</li>)}{!r.dueOk && <li className="text-bad">due date wrong</li>}</ul>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
