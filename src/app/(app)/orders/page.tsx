import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { MessagePlusIcon, SearchIcon } from "@/components/icons";
import { OrderBadge } from "@/components/status";
import { Badge, Button, ButtonLink, Card, cn, Empty, inputClass, PageHeader, RecordLink, Table, Td, Th, tabClass } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { dueIn, rupees, shortDay } from "@/lib/format";
import { listOrders } from "@/lib/ops/orders";

export const metadata: Metadata = { title: "Orders" };

const TABS = [["", "All"], ["open", "Open"], ["packed", "Packed"], ["dispatched", "Awaiting payment"], ["completed", "Completed"], ["cancelled", "Cancelled"]] as const;

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const rows = await listOrders(s, { status: sp.status || undefined, search: sp.q || undefined, limit: 150 });
  const now = new Date();
  return (
    <>
      <PageHeader title="Orders" description="Every order with what is reserved, shipped and still short. An order with an open investigation shows its case." actions={<ButtonLink href="/orders/new" variant="primary"><MessagePlusIcon size={15} /> New order</ButtonLink>} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap gap-1">
            {TABS.map(([k, label]) => <Link key={k} href={k ? `/orders?status=${k}` : "/orders"} className={tabClass((sp.status ?? "") === k)}>{label}</Link>)}
          </div>
          <Form action="/orders" className="flex items-center gap-2">
            {sp.status && <input type="hidden" name="status" value={sp.status} />}
            <input name="q" defaultValue={sp.q} placeholder="Order code or customer" className={cn(inputClass, "w-56")} />
            <Button type="submit" size="sm"><SearchIcon size={14} /> Search</Button>
          </Form>
        </div>
        {rows.length ? (
          <Table>
            <thead><tr><Th>Order</Th><Th>Customer</Th><Th>Status</Th><Th align="right">Units</Th><Th align="right">Shipped</Th><Th align="right">Short</Th><Th align="right">Value</Th><Th>Due</Th><Th>Case</Th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="hover:bg-panel-2">
                  <Td><RecordLink code={o.code} /><div className="text-xs text-faint">{shortDay(o.createdAt)} · {o.channel}</div></Td>
                  <Td>{o.customer}</Td>
                  <Td><OrderBadge status={o.status} /></Td>
                  <Td align="right">{o.units}</Td>
                  <Td align="right">{o.shipped}</Td>
                  <Td align="right">{o.short ? <span className="text-bad">{o.short}</span> : <span className="text-faint">0</span>}</Td>
                  <Td align="right">{rupees(o.value)}</Td>
                  <Td>{o.dueAt && !["completed", "cancelled", "dispatched"].includes(o.status) ? <span className={o.dueAt < now ? "text-bad" : "text-muted"}>{dueIn(o.dueAt, now)}</span> : <span className="text-faint">—</span>}</Td>
                  <Td>{o.openCase ? <Link href={`/investigations/${o.openCase}`}><Badge tone="bad">{o.openCase}</Badge></Link> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty>No orders match.</Empty>}
      </Card>
    </>
  );
}
