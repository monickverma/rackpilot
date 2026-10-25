"use client";

// Units sold per week: one series, so no legend; festival weeks get a labelled
// band behind the columns. Each column is focusable and shows its numbers on
// hover or focus; the same numbers are in the table below the chart.

import { useState } from "react";

export interface Week {
  start: number;
  end: number;
  units: number;
  revenue: number;
}

export interface Band {
  label: string;
  start: number;
  end: number;
}

const TZ = "Asia/Kolkata";
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, month: "short" });
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const DAY = 86_400_000;

function niceMax(n: number) {
  if (n <= 0) return 10;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}

export function WeeklyChart({ weeks, bands }: { weeks: Week[]; bands: Band[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...weeks.map((w) => w.units)));
  const peak = weeks.reduce((best, w, i) => (w.units > weeks[best].units ? i : best), 0);
  const ticks = [0, max / 2, max];
  const n = weeks.length;
  const bandSpans = bands
    .map((b) => {
      const first = weeks.findIndex((w) => w.end > b.start);
      const last = weeks.findLastIndex((w) => w.start <= b.end);
      return first >= 0 && last >= first ? { ...b, first, last } : null;
    })
    .filter((b) => b !== null);

  return (
    <div>
      <div className="relative ml-9 h-44">
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / max) * 100}%` }}>
            <span className="absolute -left-9 -translate-y-1/2 text-[11px] text-muted tabular">{t}</span>
          </div>
        ))}
        {bandSpans.map((b) => (
          <div
            key={b.label}
            className="absolute inset-y-0 rounded-md bg-chart-band"
            style={{ left: `${(b.first / n) * 100}%`, width: `${((b.last - b.first + 1) / n) * 100}%` }}
          >
            <span className="absolute left-1.5 top-1 text-[11px] font-medium text-muted">{b.label}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end">
          {weeks.map((w, i) => (
            <div
              key={w.start}
              tabIndex={0}
              role="img"
              aria-label={`Week of ${dayFmt.format(w.start)}: ${w.units} units, ${rupees(w.revenue)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              className="group relative flex h-full flex-1 items-end justify-center px-px outline-none"
            >
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                style={{ height: `${Math.max((w.units / max) * 100, w.units ? 1.5 : 0)}%` }}
              />
              {i === peak && hover === null && (
                <span className="pointer-events-none absolute text-[11px] font-medium tabular" style={{ bottom: `calc(${(w.units / max) * 100}% + 4px)` }}>
                  {w.units}
                </span>
              )}
              {hover === i && (
                <div
                  className="pointer-events-none absolute z-10 w-max rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg"
                  style={{ bottom: `calc(${(w.units / max) * 100}% + 8px)`, ...(i > n - 5 ? { right: 0 } : i < 4 ? { left: 0 } : {}) }}
                >
                  <div className="text-sm font-semibold tabular">{w.units} units</div>
                  <div className="text-muted tabular">{rupees(w.revenue)}</div>
                  <div className="text-muted">
                    {dayFmt.format(w.start)} – {dayFmt.format(w.end - DAY)}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-9 mt-1.5 flex text-[11px] text-muted">
        {weeks.map((w, i) => {
          const month = monthFmt.format(w.start);
          const show = i === 0 || monthFmt.format(weeks[i - 1].start) !== month;
          return (
            <div key={w.start} className="flex-1 overflow-visible whitespace-nowrap">
              {show ? month : ""}
            </div>
          );
        })}
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <table className="mt-2 w-full text-left tabular">
          <thead>
            <tr className="text-muted">
              <th className="py-1 font-medium">Week</th>
              <th className="py-1 text-right font-medium">Units</th>
              <th className="py-1 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody className="text-fg">
            {weeks.map((w) => (
              <tr key={w.start} className="border-t border-line">
                <td className="py-1">{dayFmt.format(w.start)} – {dayFmt.format(w.end - DAY)}</td>
                <td className="py-1 text-right">{w.units}</td>
                <td className="py-1 text-right">{rupees(w.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
