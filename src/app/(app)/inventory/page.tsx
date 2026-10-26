import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { HealthBadge } from "@/components/status";
import { Badge, Button, Card, cn, Empty, inputClass, PageHeader, Stat, Swatch, Table, Td, Th, tabClass } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { COLOUR_HEX, round1, rupees, sizeLabel } from "@/lib/format";
import { variantHealth } from "@/lib/intel/analytics";

export const metadata: Metadata = { title: "Inventory" };

const FILTERS = [["", "All"], ["low", "Running low"], ["flagged", "Needs verifying"], ["dead", "Unsold 60d+"], ["season", "Out of season"], ["new", "Too new"]] as const;

export default async function Inventory({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const all = await variantHealth(s);
  const low = (h: (typeof all)[number]) => (h.demand?.rate ?? 0) > 0 && (Math.max(h.available, 0) + h.onOrder) / (h.demand?.rate ?? 1) < h.leadTimeDays;
  const rows = all.filter((h) => {
    if (sp.f === "low" && !low(h)) return false;
    if (sp.f === "flagged" && !h.flagged) return false;
    if (sp.f === "dead" && h.health !== "dead") return false;
    if (sp.f === "season" && h.health !== "out-of-season") return false;
    if (sp.f === "new" && h.health !== "too-new") return false;
    if (q && !`${h.sku} ${h.barcode} ${h.productName} ${h.productCode} ${h.colour} ${h.category} ${h.home}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const value = all.reduce((a, h) => a + h.stockValue, 0);
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.q && { q: sp.q }), ...(sp.f && { f: sp.f }), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    return `/inventory${p.size ? `?${p}` : ""}`;
  };
  return (
    <>
      <PageHeader title="Inventory" description="Every variant by SKU, size and colour. Available = sellable on-hand − reserved; damaged and quarantined stock is on hand but not sellable. Scan a barcode or type a SKU to find where it is." />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Variants" value={all.length} sub={`${new Set(all.map((h) => h.productId)).size} products`} />
        <Stat label="On hand" value={all.reduce((a, h) => a + h.onHand, 0).toLocaleString("en-IN")} sub={`${all.reduce((a, h) => a + h.reserved, 0)} reserved, ${all.reduce((a, h) => a + h.unavailable, 0)} not sellable`} />
        <Stat label="Stock at cost" value={rupees(value)} sub="All locations" />
        <Stat label="Running low" value={all.filter(low).length} sub="Runs out before a reorder could arrive" href="/inventory?f=low" tone="warn" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap gap-1">{FILTERS.map(([k, l]) => <Link key={k} href={href({ f: k })} className={tabClass((sp.f ?? "") === k)}>{l}</Link>)}</div>
          <Form action="/inventory" className="flex items-center gap-2">
            {sp.f && <input type="hidden" name="f" value={sp.f} />}
            <input name="q" defaultValue={sp.q} autoFocus placeholder="Scan barcode, SKU or product" className={cn(inputClass, "w-64")} />
            <Button type="submit" size="sm"><SearchIcon size={14} /> Find</Button>
          </Form>
        </div>
        {rows.length ? (
          <Table>
            <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Home location</Th><Th align="right">On hand</Th><Th align="right">Reserved</Th><Th align="right">Available</Th><Th align="right">On order</Th><Th align="right">Cover</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.slice(0, 300).map((h) => (
                <tr key={h.variantId} className="hover:bg-panel-2">
                  <Td><Link href={`/inventory/${h.sku}`} className="font-mono text-[12px] font-medium hover:underline">{h.sku}</Link>{h.flagged && <Badge tone="warn" className="ml-1.5">verify</Badge>}</Td>
                  <Td><span>{h.productName}</span><div className="flex items-center gap-2 text-xs text-muted"><Swatch colour={h.colour} hex={COLOUR_HEX[h.colour] ?? "#999"} /> {sizeLabel(h.size)} · {h.brand}</div></Td>
                  <Td><Link href={`/stocksleuth?loc=${h.home}&sku=${h.sku}`} className="font-mono text-[12px] hover:underline">{h.home}</Link></Td>
                  <Td align="right">{h.onHand}</Td>
                  <Td align="right">{h.reserved || <span className="text-faint">0</span>}</Td>
                  <Td align="right" className={cn("font-medium", h.available <= 0 && "text-bad")}>{h.available}</Td>
                  <Td align="right">{h.onOrder || <span className="text-faint">0</span>}</Td>
                  <Td align="right">{h.coverDays === null ? <span className="text-faint">—</span> : `${round1(h.coverDays)}d`}</Td>
                  <Td><HealthBadge health={h.health} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <Empty>No variants match.</Empty>}
      </Card>
    </>
  );
}
