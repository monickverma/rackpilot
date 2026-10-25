// Turns a due label from the parser ("saturday", "tomorrow", "date:28") into a
// calendar date in India time.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Diwali (Lakshmi Puja) dates; extend as years pass. */
const DIWALI: Record<number, [number, number]> = { 2026: [11, 8], 2027: [10, 29], 2028: [10, 17] };

/** Calendar parts of `date` as seen in India. */
export function istParts(date: Date) {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** 8 PM IST on the given calendar day: "by Saturday" means by closing time. */
export function istEvening(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 20, 0) - IST_OFFSET_MS);
}

function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function resolveDue(label: string | null | undefined, now: Date): Date | null {
  if (!label) return null;
  const today = istParts(now);
  const at = (n: number) => {
    const d = addDays(today.year, today.month, today.day, n);
    return istEvening(d.year, d.month, d.day);
  };
  if (label === "today") return at(0);
  if (label === "tomorrow") return at(1);
  if (label === "day-after") return at(2);
  if (label === "this-week") return at((7 - today.weekday) % 7);
  if (label === "next-week") return at(((7 - today.weekday) % 7) + 6);
  const weekday = WEEKDAYS.indexOf(label);
  if (weekday >= 0) return at((weekday - today.weekday + 7) % 7);
  if (label === "diwali") {
    for (const year of [today.year, today.year + 1]) {
      const d = DIWALI[year];
      if (!d) continue;
      const date = istEvening(year, d[0], d[1]);
      if (date.getTime() >= now.getTime() - 24 * 3600 * 1000) return date;
    }
    return null;
  }
  const m = /^date:(\d{1,2})$/.exec(label);
  if (m) {
    const day = Number(m[1]);
    const thisMonth = istEvening(today.year, today.month, day);
    if (day >= today.day) return thisMonth;
    const nextMonth = today.month === 12 ? { y: today.year + 1, m: 1 } : { y: today.year, m: today.month + 1 };
    return istEvening(nextMonth.y, nextMonth.m, day);
  }
  return null;
}
