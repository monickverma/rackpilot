import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/client";
import { Card, PageHeader, RecordLink } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/context";
import { day, locationPath, sizeLabel } from "@/lib/format";
import { pickListView } from "@/lib/ops/orders";
import { ConfirmPick } from "./confirm";

export const metadata: Metadata = { title: "Pick list" };

export default async function PickPage({ params }: { params: Promise<{ code: string; id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const pl = /^\d+$/.test(id) ? await pickListView(s, Number(id)) : null;
  if (!pl) notFound();
  return (
    <>
      <PageHeader
        title={`Pick list ${pl.code}`}
        description={<>For <RecordLink code={pl.orderCode} /> · {pl.customer}{pl.dueAt ? ` · due ${day(pl.dueAt)}` : ""}. Lines are in walking order through {pl.racks} {pl.racks === 1 ? "rack" : "racks"}. Picking doesn&apos;t change on-hand: stock leaves the ledger when it is dispatched.</>}
        actions={<PrintButton label="Print pick list" />}
      />
      <Card className="print-plain">
        <ConfirmPick
          code={pl.orderCode} pickListId={pl.id} open={pl.status === "open"} allowed={can(s, "warehouse.write")}
          lines={pl.lines.map((l) => ({ id: l.id, sku: l.sku, what: `${l.productName}, ${l.colour} ${sizeLabel(l.size)}`, location: l.location, path: locationPath(l), qtyToPick: l.qtyToPick, qtyPicked: l.qtyPicked }))}
        />
      </Card>
    </>
  );
}
