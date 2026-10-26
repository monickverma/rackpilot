// Display helpers shared by pages and by notes written into the database.
// Times always show in India time, whatever the server's time zone.

const TZ = "Asia/Kolkata";
const DAY = 86_400_000;

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const orderCode = (id: number) => `ORD-${1000 + id}`;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
}

/** "saturday" -> "Saturday", "date:28" -> "the 28th", "day-after" -> "day after tomorrow". */
export function dueText(label: string): string {
  if (WEEKDAYS.includes(label)) return label[0].toUpperCase() + label.slice(1);
  const words: Record<string, string> = {
    today: "today", tomorrow: "tomorrow", "day-after": "day after tomorrow", "this-week": "this week", "next-week": "next week", diwali: "Diwali",
  };
  if (words[label]) return words[label];
  const m = /^date:(\d{1,2})$/.exec(label);
  return m ? `the ${ordinal(Number(m[1]))}` : label;
}

/** The due date as a calendar day, e.g. "Fri, 30 Oct" or "Diwali · Sun, 8 Nov". */
export function dueDay(label: string | null, at: number) {
  return label === "diwali" ? `Diwali · ${day(at)}` : day(at);
}

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const dayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const shortDayFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });

export const dateTime = (ms: number) => dateTimeFmt.format(ms);
export const day = (ms: number) => dayFmt.format(ms);
export const shortDay = (ms: number) => shortDayFmt.format(ms);

export function ago(ms: number, now = Date.now()) {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < DAY / 1000) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const istDay = (ms: number) => Math.floor((ms + 5.5 * 3_600_000) / DAY);

/** "due in 2 days", "due today", "3 days late", counted in India calendar days. */
export function dueIn(ms: number, now = Date.now()) {
  const days = istDay(ms) - istDay(now);
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return ms < now ? "late today" : "due today";
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function colourDot(colour: string): string {
  const map: Record<string, string> = {
    black: "#18181b", white: "#f4f4f5", maroon: "#7f1d1d", mustard: "#ca8a04", navy: "#1e3a8a", pink: "#f472b6", peach: "#fdba74",
    green: "#15803d", rust: "#b45309", red: "#dc2626", yellow: "#facc15", magenta: "#c026d3", olive: "#65a30d", beige: "#d6c7a1",
    wine: "#881337", teal: "#0d9488", "sky blue": "#7dd3fc", grey: "#9ca3af", lavender: "#c4b5fd", orange: "#f97316", blue: "#2563eb",
  };
  return map[colour] ?? "#a1a1aa";
}
