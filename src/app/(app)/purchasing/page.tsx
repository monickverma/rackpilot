import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { dateTime, rupees, shortDay } from "@/lib/format";
import { listPlans } from "@/lib/intel/plan";
import { purchaseOrders } from "@/lib/ops/purchasing";
import { PlanForm, ReceivePO } from "./forms";

export const metadata: Metadata = { title: "Purchasing" };

export default async function Purchasing({ searchParams }: { searchParams: Promise<{ budget?: string }> }) {
  const s = await requireSession();
  const { budget } = await searchParams;
  const [plans, pos] = await Promise.all([listPlans(s), purchaseOrders(s)]);
  return (
    <>
      <PageHeader title="Budget-aware purchasing" description="Tell RackPilot what you can spend. It proposes what to reorder, in what quantity and why, using sales, stock, reservations, backorders, supplier lead times, packs and minimums, and treats stock under investigation as uncertain. Nothing is ordered until the owner approves." />
      <div className="grid gap-3 xl:grid-cols-[420px_minmax(0,1fr)]">
        <PlanForm defaultBudget={Number(budget) || 30000} />
        <Card>
          <CardHeader title="Plans" description="Every proposal is saved with its inputs and evidence." />
          {plans.length ? (
            <Table>
              <thead><tr><Th>Plan</Th><Th align="right">Budget</Th><Th align="right">Used</Th><Th align="right">Lines</Th><Th>Status</Th><Th>Created</Th></tr></thead>
              <tbody>{plans.map((p) => <tr key={p.code}><Td><Link href={`/purchasing/${p.code}`} className="font-mono text-[12px] text-accent hover:underline">{p.code}</Link></Td><Td align="right">{rupees(p.budget)}</Td><Td align="right">{rupees(p.used)}</Td><Td align="right">{p.lines}</Td><Td><Badge tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "neutral" : "accent"}>{p.status}</Badge></Td><Td className="text-xs text-muted">{dateTime(p.createdAt)} · {p.createdBy}</Td></tr>)}</tbody>
            </Table>
          ) : <Empty>No plans yet. Enter a budget to make one.</Empty>}
        </Card>
      </div>
      <Card className="mt-3" id="orders">
        <CardHeader title="Purchase orders" description="Placed POs arrive into each variant's home bin when received; backorders are then reserved oldest first. Open orders first, then the most recent." />
        <Table>
          <thead><tr><Th>PO</Th><Th>Supplier</Th><Th align="right">Units</Th><Th align="right">Value</Th><Th>Placed</Th><Th>Expected</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-[12px]">{p.code}{p.recommendation && <div className="text-xs text-muted">from {p.recommendation}</div>}</Td>
                <Td>{p.supplier}</Td>
                <Td align="right">{p.units}</Td>
                <Td align="right">{rupees(p.value)}</Td>
                <Td className="text-xs text-muted">{shortDay(p.placedAt)}</Td>
                <Td className="text-xs text-muted">{shortDay(p.expectedAt)}</Td>
                <Td><Badge tone={p.status === "received" ? "ok" : p.status === "placed" ? "accent" : "neutral"}>{p.status.replace("_", " ")}</Badge></Td>
                <Td>{p.status === "placed" && <ReceivePO id={p.id} allowed={can(s, "warehouse.write")} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
