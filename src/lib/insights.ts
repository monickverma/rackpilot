// Deterministic stock insights. Each flag carries the numbers behind it so the
// UI can show the evidence and link to the ledger rows that produced them.

const DAY = 86_400_000;
export const SALES_WINDOW_DAYS = 30;
export const DEAD_AFTER_DAYS = 60;
/** Reorder enough to cover the supplier's lead time plus this many days. */
export const REORDER_BUFFER_DAYS = 14;
/** Seasonal stock is worth buying when its season starts within lead time + this. */
const PRE_SEASON_DAYS = 30;

/** Festival windows for seasonal products (IST dates); extend as years pass. */
export const SEASONS: Record<string, { label: string; windows: [string, string][] }> = {
  navratri: { label: "Navratri", windows: [["2026-10-11", "2026-10-20"]] },
};

export interface StockRow {
  variantId: number;
  sku: string;
  productId: number;
  productCode: string;
  productName: string;
  colour: string;
  size: string;
  location: string;
  onHand: number;
  reserved: number;
  costPrice: number;
  sellPrice: number;
  supplierName: string;
  leadTimeDays: number;
  packRatio: string;
  season: string | null;
}

const istDate = (iso: string, endOfDay = false) => new Date(`${iso}T${endOfDay ? "23:59:59" : "00:00:00"}+05:30`);

/** Whether a seasonal product's season is on now or close enough to stock up for. */
export function seasonIsNear(row: StockRow, now: Date): boolean {
  const season = row.season ? SEASONS[row.season] : undefined;
  if (!season) return true;
  const until = now.getTime() + (row.leadTimeDays + PRE_SEASON_DAYS) * DAY;
  return season.windows.some(([start, end]) => istDate(start).getTime() <= until && istDate(end, true).getTime() >= now.getTime());
}

/** Last day of the season that has just ended, for the "season over" note. */
export function lastSeasonEnd(row: StockRow, now: Date): Date | null {
  const season = row.season ? SEASONS[row.season] : undefined;
  if (!season) return null;
  const ended = season.windows.map(([, end]) => istDate(end, true)).filter((d) => d.getTime() < now.getTime());
  return ended.length ? ended[ended.length - 1] : null;
}

export interface SalesStats {
  /** Units sold in the last SALES_WINDOW_DAYS. */
  sold30: number;
  lastSaleAt: Date | null;
  firstReceivedAt: Date | null;
}

export type Severity = "out" | "critical" | "low";

export interface LowStockFlag {
  row: StockRow;
  available: number;
  sold30: number;
  dailyRate: number;
  daysOfCover: number;
  severity: Severity;
  evidence: string;
}

export interface DeadStockFlag {
  row: StockRow;
  daysIdle: number;
  neverSold: boolean;
  valueAtCost: number;
  evidence: string;
}

export interface ReorderLine {
  row: StockRow;
  available: number;
  sold30: number;
  need: number;
  qty: number;
}

export interface ReorderSuggestion {
  productId: number;
  productCode: string;
  productName: string;
  colour: string;
  supplierName: string;
  leadTimeDays: number;
  packs: number | null;
  packRatio: string | null;
  lines: ReorderLine[];
  units: number;
  costEstimate: number;
  evidence: string;
}

export const available = (r: StockRow) => r.onHand - r.reserved;
const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const emptyStats: SalesStats = { sold30: 0, lastSaleAt: null, firstReceivedAt: null };

/**
 * Flag a variant when what is free to sell will not last until a new delivery
 * could arrive. Seasonal stock is skipped once its season is over.
 */
export function lowStockFlags(rows: StockRow[], stats: Map<number, SalesStats>, now: Date): LowStockFlag[] {
  const flags: LowStockFlag[] = [];
  for (const row of rows) {
    const s = stats.get(row.variantId) ?? emptyStats;
    if (s.sold30 <= 0 || !seasonIsNear(row, now)) continue;
    const avail = available(row);
    const dailyRate = s.sold30 / SALES_WINDOW_DAYS;
    const daysOfCover = Math.max(avail, 0) / dailyRate;
    if (daysOfCover >= row.leadTimeDays) continue;
    const severity: Severity = avail <= 0 ? "out" : daysOfCover < row.leadTimeDays / 2 ? "critical" : "low";
    const held = row.reserved > 0 ? ` (${row.onHand} on hand, ${row.reserved} reserved)` : "";
    flags.push({
      row,
      available: avail,
      sold30: s.sold30,
      dailyRate,
      daysOfCover,
      severity,
      evidence:
        `Sold ${s.sold30} in the last ${SALES_WINDOW_DAYS} days (${round1(dailyRate)}/day). ` +
        `${plural(Math.max(avail, 0), "unit")} free to sell${held} covers ${round1(daysOfCover)} days; ` +
        `${row.supplierName} takes ${row.leadTimeDays} days to deliver.`,
    });
  }
  const order: Record<Severity, number> = { out: 0, critical: 1, low: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity] || a.daysOfCover - b.daysOfCover || b.sold30 - a.sold30);
}

/** Stock that has sat for DEAD_AFTER_DAYS without a sale, most money tied up first. */
export function deadStockFlags(rows: StockRow[], stats: Map<number, SalesStats>, now: Date): DeadStockFlag[] {
  const cutoff = now.getTime() - DEAD_AFTER_DAYS * DAY;
  const flags: DeadStockFlag[] = [];
  for (const row of rows) {
    // Leftovers from a finished season are listed by seasonHolds() instead.
    if (row.onHand <= 0 || (!seasonIsNear(row, now) && lastSeasonEnd(row, now))) continue;
    const s = stats.get(row.variantId) ?? emptyStats;
    if (!s.firstReceivedAt || s.firstReceivedAt.getTime() > cutoff) continue;
    if (s.lastSaleAt && s.lastSaleAt.getTime() > cutoff) continue;
    const since = s.lastSaleAt ?? s.firstReceivedAt;
    const daysIdle = Math.floor((now.getTime() - since.getTime()) / DAY);
    const valueAtCost = row.onHand * row.costPrice;
    flags.push({
      row,
      daysIdle,
      neverSold: !s.lastSaleAt,
      valueAtCost,
      evidence: s.lastSaleAt
        ? `Last sold ${daysIdle} days ago; ${plural(row.onHand, "unit")} still on the rack (₹${valueAtCost.toLocaleString("en-IN")} at cost).`
        : `Never sold since it arrived ${daysIdle} days ago; ${plural(row.onHand, "unit")} on the rack (₹${valueAtCost.toLocaleString("en-IN")} at cost).`,
    });
  }
  return flags.sort((a, b) => b.valueAtCost - a.valueAtCost || b.daysIdle - a.daysIdle);
}

export interface DeadStockGroup {
  productId: number;
  productCode: string;
  productName: string;
  location: string;
  units: number;
  valueAtCost: number;
  /** Fewest idle days among its variants: the whole group has sat at least this long. */
  daysIdle: number;
  neverSold: boolean;
  flags: DeadStockFlag[];
}

export function groupDeadStock(flags: DeadStockFlag[]): DeadStockGroup[] {
  const groups = new Map<number, DeadStockGroup>();
  for (const f of flags) {
    const g = groups.get(f.row.productId) ?? {
      productId: f.row.productId, productCode: f.row.productCode, productName: f.row.productName, location: f.row.location,
      units: 0, valueAtCost: 0, daysIdle: Infinity, neverSold: true, flags: [],
    };
    g.units += f.row.onHand;
    g.valueAtCost += f.valueAtCost;
    g.daysIdle = Math.min(g.daysIdle, f.daysIdle);
    g.neverSold &&= f.neverSold;
    g.flags.push(f);
    groups.set(f.row.productId, g);
  }
  return [...groups.values()].sort((a, b) => b.valueAtCost - a.valueAtCost);
}

export interface SeasonHold {
  productId: number;
  productCode: string;
  productName: string;
  seasonLabel: string;
  seasonEnded: Date;
  units: number;
  valueAtCost: number;
}

/** Seasonal products whose season has passed: keep what is left, do not reorder. */
export function seasonHolds(rows: StockRow[], now: Date): SeasonHold[] {
  const holds = new Map<number, SeasonHold>();
  for (const row of rows) {
    if (row.onHand <= 0 || seasonIsNear(row, now)) continue;
    const ended = lastSeasonEnd(row, now);
    if (!ended) continue;
    const h = holds.get(row.productId) ?? {
      productId: row.productId, productCode: row.productCode, productName: row.productName,
      seasonLabel: SEASONS[row.season!].label, seasonEnded: ended, units: 0, valueAtCost: 0,
    };
    h.units += row.onHand;
    h.valueAtCost += row.onHand * row.costPrice;
    holds.set(row.productId, h);
  }
  return [...holds.values()];
}

function parsePack(ratio: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of ratio.split(":")) {
    const m = /^([A-Z]+)(\d+)$/.exec(part.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/**
 * One suggestion per product colour that has a low-stock size: enough to cover
 * lead time + REORDER_BUFFER_DAYS at the last 30 days' rate, bought in the
 * supplier's size-set packs (free-size items in fours).
 */
export function reorderSuggestions(rows: StockRow[], stats: Map<number, SalesStats>, now: Date): ReorderSuggestion[] {
  const low = new Set(lowStockFlags(rows, stats, now).map((f) => f.row.variantId));
  const groups = new Map<string, StockRow[]>();
  for (const row of rows) {
    const key = `${row.productId}|${row.colour}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: ReorderSuggestion[] = [];
  for (const group of groups.values()) {
    if (!group.some((r) => low.has(r.variantId))) continue;
    const first = group[0];
    const horizon = first.leadTimeDays + REORDER_BUFFER_DAYS;
    const needOf = (r: StockRow) => {
      const s = stats.get(r.variantId) ?? emptyStats;
      return Math.max(0, Math.ceil((s.sold30 / SALES_WINDOW_DAYS) * horizon) - Math.max(available(r), 0));
    };
    const free = group.every((r) => r.size === "FREE");
    let packs: number | null = null;
    let lines: ReorderLine[];
    if (free) {
      lines = group.map((r) => {
        const need = needOf(r);
        return { row: r, available: available(r), sold30: (stats.get(r.variantId) ?? emptyStats).sold30, need, qty: need > 0 ? Math.ceil(need / 4) * 4 : 0 };
      });
    } else {
      const pack = parsePack(first.packRatio);
      packs = 1;
      for (const r of group) {
        const need = needOf(r);
        if (need > 0) packs = Math.max(packs, Math.ceil(need / (pack[r.size] ?? 1)));
      }
      packs = Math.min(packs, 6);
      lines = group.map((r) => ({ row: r, available: available(r), sold30: (stats.get(r.variantId) ?? emptyStats).sold30, need: needOf(r), qty: (pack[r.size] ?? 0) * packs! }));
    }
    const units = lines.reduce((a, l) => a + l.qty, 0);
    if (units === 0) continue;
    const short = lines.filter((l) => low.has(l.row.variantId)).map((l) => (l.row.size === "FREE" ? "free size" : l.row.size));
    out.push({
      productId: first.productId,
      productCode: first.productCode,
      productName: first.productName,
      colour: first.colour,
      supplierName: first.supplierName,
      leadTimeDays: first.leadTimeDays,
      packs,
      packRatio: free ? null : first.packRatio,
      lines,
      units,
      costEstimate: units * first.costPrice,
      evidence:
        `${short.join(", ")} will run out before a ${first.leadTimeDays}-day delivery. ` +
        `Covers ${horizon} days at the last ${SALES_WINDOW_DAYS} days' sales` +
        (packs ? `, in ${plural(packs, "pack")} of ${first.packRatio}.` : ", in fours."),
    });
  }
  return out.sort((a, b) => b.costEstimate - a.costEstimate);
}

export interface BestSeller {
  productId: number;
  productCode: string;
  productName: string;
  units: number;
  revenue: number;
  topVariants: { sku: string; colour: string; size: string; units: number }[];
}

export function bestSellers(rows: StockRow[], stats: Map<number, SalesStats>, limit = 8): BestSeller[] {
  const byProduct = new Map<number, BestSeller>();
  for (const row of rows) {
    const sold = (stats.get(row.variantId) ?? emptyStats).sold30;
    if (sold <= 0) continue;
    const b = byProduct.get(row.productId) ?? { productId: row.productId, productCode: row.productCode, productName: row.productName, units: 0, revenue: 0, topVariants: [] };
    b.units += sold;
    b.revenue += sold * row.sellPrice;
    b.topVariants.push({ sku: row.sku, colour: row.colour, size: row.size, units: sold });
    byProduct.set(row.productId, b);
  }
  return [...byProduct.values()]
    .map((b) => ({ ...b, topVariants: b.topVariants.sort((x, y) => y.units - x.units).slice(0, 3) }))
    .sort((a, b) => b.units - a.units)
    .slice(0, limit);
}
