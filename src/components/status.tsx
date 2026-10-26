// One place that decides how each status looks.

import type { LineStatus, MovementType, OrderStatus } from "@/db/schema";
import type { Severity } from "@/lib/insights";
import { StatusBadge, type Tone } from "./ui";

const ORDER: Record<OrderStatus, [Tone, string]> = {
  confirmed: ["accent", "Open"],
  fulfilled: ["ok", "Fulfilled"],
  cancelled: ["neutral", "Cancelled"],
};

const LINE: Record<LineStatus, [Tone, string]> = {
  reserved: ["ok", "Reserved"],
  short: ["bad", "Short"],
  unmatched: ["warn", "Not matched"],
  fulfilled: ["neutral", "Fulfilled"],
  released: ["neutral", "Released"],
};

export const MOVEMENT: Record<MovementType, [Tone, string]> = {
  receive: ["info", "Receive"],
  reserve: ["accent", "Reserve"],
  release: ["neutral", "Release"],
  sale: ["ok", "Sale"],
  adjust: ["warn", "Adjust"],
  exchange: ["neutral", "Exchange"],
};

const SEVERITY: Record<Severity, [Tone, string]> = {
  out: ["bad", "Out"],
  critical: ["bad", "Critical"],
  low: ["warn", "Low"],
};

export const OrderBadge = ({ status }: { status: OrderStatus }) => <StatusBadge tone={ORDER[status][0]}>{ORDER[status][1]}</StatusBadge>;
export const LineBadge = ({ status }: { status: LineStatus }) => <StatusBadge tone={LINE[status][0]}>{LINE[status][1]}</StatusBadge>;
export const MovementBadge = ({ type }: { type: MovementType }) => <StatusBadge tone={MOVEMENT[type][0]}>{MOVEMENT[type][1]}</StatusBadge>;
export const SeverityBadge = ({ severity }: { severity: Severity }) => <StatusBadge tone={SEVERITY[severity][0]}>{SEVERITY[severity][1]}</StatusBadge>;

export function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="text-faint">0</span>;
  return <span className={n > 0 ? "text-ok" : "text-bad"}>{n > 0 ? `+${n}` : `−${-n}`}</span>;
}
