import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { MessagePlusIcon } from "@/components/icons";
import { OrderBadge } from "@/components/status";
import { Badge, ButtonLink, Card, CardSkeleton, cn, Empty, Mono, PageHeader, Table, Td, Th } from "@/components/ui";
import type { OrderStatus } from "@/db/schema";
import { ago, dueDay, dueIn } from "@/lib/format";
import { listOrders } from "@/lib/orders";

export const metadata: Metadata = { title: "Orders" };

const TABS: { key: string; label: string; status?: OrderStatus }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open", status: "confirmed" },
  { key: "fulfilled", label: "Fulfilled", status: "fulfilled" },
  { key: "cancelled", label: "Cancelled", status: "cancelled" },
];

export default function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      <PageHeader
        eyebrow="Orders"
        title="WhatsApp orders"
        description="Every order keeps the customer's original message next to what was reserved, so you can always see why."
        actions={
          <ButtonLink href="/orders/new" variant="primary">
            <MessagePlusIcon size={15} /> New order
          </ButtonLink>
        }
      />
      <Suspense fallback={<CardSkeleton rows={8} />}>
        <OrderList searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function OrderList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  await connection();
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const orders = listOrders(tab.status);
  const now = new Date().getTime();
  return (
    <Card>
      <div className="flex gap-1 border-b border-line px-3 py-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/orders" : `/orders?tab=${t.key}`}
            className={cn("rounded-md px-2.5 py-1 text-[13px] font-medium", t.key === tab.key ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {orders.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th className="hidden md:table-cell">Message</Th>
              <Th align="right">Pcs</Th>
              <Th>Status</Th>
              <Th>Due</Th>
              <Th align="right">Received</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-panel-2/50">
                <Td>
                  <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                    <Mono>{o.code}</Mono>
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{o.customerName}</Td>
                <Td className="hidden max-w-sm md:table-cell">
                  <span className="line-clamp-1 text-muted">{o.rawMessage}</span>
                </Td>
                <Td align="right">{o.units}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    <OrderBadge status={o.status} />
                    {o.status === "confirmed" && o.shortLines > 0 && <Badge tone="bad">{o.shortLines} short</Badge>}
                    {o.unmatchedLines > 0 && <Badge tone="warn">{o.unmatchedLines} unmatched</Badge>}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {o.dueAt ? dueDay(o.dueLabel, o.dueAt) : "—"}
                  {o.status === "confirmed" && o.dueAt && <div className="text-[11px]">{dueIn(o.dueAt, now)}</div>}
                </Td>
                <Td align="right" className="whitespace-nowrap text-muted">{ago(o.createdAt, now)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>No {tab.key === "all" ? "" : `${tab.label.toLowerCase()} `}orders.</Empty>
      )}
    </Card>
  );
}
