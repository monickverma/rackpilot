import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SearchIcon } from "@/components/icons";
import { SeverityBadge } from "@/components/status";
import { Badge, Button, Card, CardSkeleton, cn, Empty, inputClass, Location, Mono, PageHeader, Swatch, Table, Td, Th } from "@/components/ui";
import { colourDot } from "@/lib/format";
import { insights } from "@/lib/inventory";

export const metadata: Metadata = { title: "Inventory" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default function InventoryPage({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Stock by rack"
        description="On hand is what is on the rack; reserved is held for open orders; free is what you can still sell. Click any SKU for its full stock card."
      />
      <Suspense fallback={<CardSkeleton rows={10} />}>
        <Inventory searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inventory({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await connection();
  const q = one(sp.q).trim().toLowerCase();
  const rack = one(sp.rack);
  const flag = one(sp.flag);
  const now = new Date();
  const ins = insights(now);
  const low = new Map(ins.low.map((f) => [f.row.variantId, f]));
  const dead = new Map(ins.dead.map((f) => [f.row.variantId, f]));

  const racks = ["R1", "R2", "R3", "R4", "R5", "R6"].map((r) => {
    const rows = ins.rows.filter((x) => x.location.startsWith(`${r}-`));
    return {
      rack: r,
      variants: rows.length,
      units: rows.reduce((a, x) => a + x.onHand, 0),
      flagged: rows.filter((x) => low.has(x.variantId)).length,
      products: [...new Set(rows.map((x) => x.productName))].slice(0, 2),
    };
  });

  const rows = ins.rows.filter((r) => {
    if (rack && !r.location.startsWith(`${rack}-`)) return false;
    if (flag === "low" && !low.has(r.variantId)) return false;
    if (flag === "dead" && !dead.has(r.variantId)) return false;
    if (q && !`${r.sku} ${r.productName} ${r.productCode} ${r.colour}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(rack && { rack }), ...(flag && { flag }), ...patch });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const s = p.toString();
    return s ? `/inventory?${s}` : "/inventory";
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {racks.map((r) => (
          <Link
            key={r.rack}
            href={href({ rack: rack === r.rack ? "" : r.rack })}
            className={cn("rounded-xl border bg-panel p-3 shadow-card transition-colors hover:border-line-strong", rack === r.rack ? "border-accent ring-2 ring-accent/15" : "border-line")}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-semibold">{r.rack}</span>
              {r.flagged > 0 && <Badge tone="bad">{r.flagged} low</Badge>}
            </div>
            <div className="mt-2 text-lg font-semibold">{r.units.toLocaleString("en-IN")}</div>
            <div className="text-[11px] text-muted">pcs in {r.variants} SKUs</div>
            <div className="mt-1 truncate text-[11px] text-faint">{r.products.join(", ")}</div>
          </Link>
        ))}
      </div>

      <Card>
        <Form action="/inventory" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {rack && <input type="hidden" name="rack" value={rack} />}
          <div className="relative min-w-52 flex-1">
            <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input name="q" defaultValue={q} placeholder="Search SKU, product or colour" className={cn(inputClass, "pl-9")} />
          </div>
          <select name="flag" defaultValue={flag} className={cn(inputClass, "w-auto")}>
            <option value="">All stock</option>
            <option value="low">Low stock only</option>
            <option value="dead">Dead stock only</option>
          </select>
          <Button type="submit">Filter</Button>
          {(q || rack || flag) && (
            <Link href="/inventory" className="text-[13px] text-muted hover:text-fg">Clear</Link>
          )}
          <span className="ml-auto text-xs text-muted">{rows.length} of {ins.rows.length} SKUs</span>
        </Form>
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Bin</Th>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th>Colour</Th>
                <Th>Size</Th>
                <Th align="right">On hand</Th>
                <Th align="right">Reserved</Th>
                <Th align="right">Free</Th>
                <Th align="right">Sold 30d</Th>
                <Th>Flag</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lf = low.get(r.variantId);
                const df = dead.get(r.variantId);
                return (
                  <tr key={r.variantId} className="hover:bg-panel-2/50">
                    <Td><Location code={r.location} /></Td>
                    <Td><Link href={`/inventory/${r.sku}`} className="hover:underline"><Mono>{r.sku}</Mono></Link></Td>
                    <Td className="whitespace-nowrap">{r.productName}</Td>
                    <Td><Swatch colour={r.colour} hex={colourDot(r.colour)} /></Td>
                    <Td>{r.size === "FREE" ? "FS" : r.size}</Td>
                    <Td align="right">{r.onHand}</Td>
                    <Td align="right" className={r.reserved ? "" : "text-faint"}>{r.reserved}</Td>
                    <Td align="right" className="font-medium">{r.onHand - r.reserved}</Td>
                    <Td align="right" className="text-muted">{ins.stats.get(r.variantId)?.sold30 ?? 0}</Td>
                    <Td>
                      {lf && <SeverityBadge severity={lf.severity} />}
                      {df && <Badge tone="warn">idle {df.daysIdle}d</Badge>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>No SKUs match.</Empty>
        )}
      </Card>
    </div>
  );
}
