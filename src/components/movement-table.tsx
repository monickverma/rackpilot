import Link from "next/link";
import type { MovementRow } from "@/lib/inventory";
import { dateTime } from "@/lib/format";
import { Delta, MovementBadge } from "./status";
import { Empty, Mono, Table, Td, Th } from "./ui";

/** Ledger rows, newest first. `balances` adds the on-hand/reserved after each row. */
export function MovementTable({ rows, showSku = true, showOrder = true, balances }: {
  rows: MovementRow[];
  showSku?: boolean;
  showOrder?: boolean;
  balances?: Map<number, { onHand: number; reserved: number }>;
}) {
  if (!rows.length) return <Empty>No ledger rows.</Empty>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>When</Th>
          <Th>Type</Th>
          {showSku && <Th>SKU</Th>}
          <Th align="right">On hand</Th>
          <Th align="right">Reserved</Th>
          {balances && <Th align="right">After</Th>}
          {showOrder && <Th>Order / ref</Th>}
          <Th className="hidden lg:table-cell">Note</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const after = balances?.get(m.id);
          return (
            <tr key={m.id} id={`m${m.id}`} className="hover:bg-panel-2 target:bg-accent-soft">
              <Td className="text-faint tabular">{m.id}</Td>
              <Td className="whitespace-nowrap text-muted">{dateTime(m.createdAt)}</Td>
              <Td><MovementBadge type={m.type} /></Td>
              {showSku && (
                <Td>
                  <Link href={`/inventory/${m.sku}`} className="hover:underline"><Mono>{m.sku}</Mono></Link>
                </Td>
              )}
              <Td align="right"><Delta n={m.onHandDelta} /></Td>
              <Td align="right"><Delta n={m.reservedDelta} /></Td>
              {balances && (
                <Td align="right" className="whitespace-nowrap">
                  {after ? <span>{after.onHand}<span className="text-faint"> / {after.reserved}</span></span> : "—"}
                </Td>
              )}
              {showOrder && (
                <Td className="whitespace-nowrap">
                  {m.orderId ? (
                    <Link href={`/orders/${m.orderId}`} className="hover:underline"><Mono>{m.orderCode}</Mono></Link>
                  ) : (
                    <span className="text-muted">{m.ref ?? "—"}</span>
                  )}
                </Td>
              )}
              <Td className="hidden max-w-xs truncate text-muted lg:table-cell">{m.note}</Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
