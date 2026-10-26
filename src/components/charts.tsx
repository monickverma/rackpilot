// Small single-series charts in inline SVG: one hue (--chart), 4px rounded
// data ends on a recessive baseline, 2px gaps between bars, a hover tooltip
// per bar, and no legend because the card title names the series. Each chart
// sits next to a table view of the same numbers.

import { cn } from "./ui";

export function WeeklyBars({ weeks, value, label }: { weeks: { start: Date; units: number; revenue: number }[]; value: "units" | "revenue"; label: (w: { start: Date; units: number; revenue: number }) => string }) {
  const W = 640;
  const H = 160;
  const pad = { t: 8, b: 22, l: 0, r: 0 };
  const max = Math.max(1, ...weeks.map((w) => w[value]));
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Weekly ${value}`}>
      <line x1={0} x2={W} y1={H - pad.b} y2={H - pad.b} className="stroke-line" strokeWidth={1} />
      {weeks.map((w, i) => {
        const x = pad.l + i * bw + 1;
        const top = y(w[value]);
        const h = Math.max(0, H - pad.b - top);
        const r = Math.min(4, h / 2, (bw - 2) / 2);
        return (
          <g key={i} className="group">
            <rect x={x - 1} y={pad.t} width={bw} height={H - pad.t - pad.b} className="fill-transparent group-hover:fill-panel-2" />
            {h > 0 && <path d={`M${x},${H - pad.b} V${top + r} q0,-${r} ${r},-${r} h${bw - 2 - 2 * r} q${r},0 ${r},${r} V${H - pad.b} Z`} className="fill-chart" />}
            <title>{label(w)}</title>
            {i % 4 === 0 && (
              <text x={x} y={H - 6} className="fill-faint text-[10px]">
                {fmt.format(w.start)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A horizontal bar per row, for shares such as units by size. */
export function BarList({ rows, format }: { rows: { label: string; value: number; note?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-[13px]" title={`${r.label}: ${format ? format(r.value) : r.value}${r.note ? ` · ${r.note}` : ""}`}>
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-3 rounded-r-[4px] bg-chart" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          <span className={cn("tabular text-right", "w-16")}>{format ? format(r.value) : r.value}</span>
        </li>
      ))}
    </ul>
  );
}
