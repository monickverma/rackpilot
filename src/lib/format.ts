// Display helpers shared by pages, rules and explanations. Times always show
// in India time, whatever the server's time zone.

const TZ = "Asia/Kolkata";
export const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

export const rupees = (n: number) => `${n < 0 ? "−" : ""}₹${Math.abs(Math.round(n)).toLocaleString("en-IN")}`;
export const num = (n: number) => Math.round(n).toLocaleString("en-IN");
export const plural = (n: number, word: string, many = `${word}s`) => `${num(n)} ${n === 1 || n === -1 ? word : many}`;
export const units = (n: number) => plural(n, "unit");
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (n: number) => `${Math.round(n * 100)}%`;

const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const shortDayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });

const ms = (d: Date | number | string) => (d instanceof Date ? d.getTime() : typeof d === "string" ? new Date(d).getTime() : d);
export const time = (d: Date | number | string) => timeFmt.format(ms(d));
export const dateTime = (d: Date | number | string) => dateTimeFmt.format(ms(d));
export const day = (d: Date | number | string) => dayFmt.format(ms(d));
export const shortDay = (d: Date | number | string) => shortDayFmt.format(ms(d));

/** Days since the epoch in India time, for calendar-day comparisons. */
export const istDay = (d: Date | number | string) => Math.floor((ms(d) + IST) / DAY);

/** Start of the India-time day containing d. */
export function startOfIstDay(d: Date | number): Date {
  return new Date(istDay(d) * DAY - IST);
}

/** "10:04" for today, "yesterday 10:04", or "24 Oct 10:04". */
export function when(d: Date | number | string, now: Date | number = Date.now()) {
  const diff = istDay(now) - istDay(d);
  if (diff === 0) return `today ${time(d)}`;
  if (diff === 1) return `yesterday ${time(d)}`;
  return dateTime(d);
}

export function ago(d: Date | number | string, now: Date | number = Date.now()) {
  const s = Math.round((ms(now) - ms(d)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** "due tomorrow", "due in 3 days", "2 days late", counted in India calendar days. */
export function dueIn(d: Date | number | string, now: Date | number = Date.now()) {
  const days = istDay(d) - istDay(now);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "due today";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

/** "Warehouse A → Rack R-12 → Shelf 3 → Bin 12" from a location row. */
export function locationPath(l: { warehouse: string; rack: string | null; shelf: string | null; bin: string | null; kind: string }) {
  if (l.kind === "packing") return `Warehouse ${l.warehouse} → Packing area`;
  if (l.kind === "receiving") return `Warehouse ${l.warehouse} → Receiving bay`;
  if (l.kind === "quarantine") return `Warehouse ${l.warehouse} → Quarantine (damaged)`;
  const rack = l.rack === "SR" ? "Showroom rail" : `Rack ${l.rack}`;
  return `Warehouse ${l.warehouse} → ${rack} → Shelf ${l.shelf} → Bin ${Number(l.bin)}`;
}

export const sizeLabel = (s: string) => (/^\d+$/.test(s) ? `W${s}` : s);

export const COLOUR_HEX: Record<string, string> = {
  black: "#18181b", white: "#f4f4f5", navy: "#1e3a8a", grey: "#9ca3af", beige: "#d6c7a1", olive: "#65a30d", maroon: "#7f1d1d",
  blue: "#3b82f6", pink: "#f472b6", sky: "#7dd3fc", mustard: "#ca8a04", indigo: "#312e81", khaki: "#b8a27a", brown: "#78350f",
  ecru: "#e7dcc7", rust: "#b45309",
};

export const titleCase = (s: string) => s.replace(/(^|[\s_-])\w/g, (m) => m.toUpperCase()).replaceAll("_", " ");
