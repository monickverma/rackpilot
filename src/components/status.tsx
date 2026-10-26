// One place that decides how each state looks. State is never colour alone:
// every badge carries its word.

import type { InvestigationStatus, MovementType, OrderStatus } from "@/db/schema";
import { Badge, StatusBadge, type Tone } from "./ui";

const ORDER: Record<OrderStatus, [Tone, string]> = {
  confirmed: ["accent", "Confirmed"],
  picking: ["info", "Picking"],
  packed: ["info", "Packed"],
  dispatched: ["warn", "Dispatched, unpaid"],
  completed: ["ok", "Completed"],
  cancelled: ["neutral", "Cancelled"],
};

const CASE: Record<InvestigationStatus, [Tone, string]> = {
  detected: ["bad", "Detected"],
  investigating: ["warn", "Investigating"],
  action_required: ["accent", "Action required"],
  resolved: ["ok", "Resolved"],
  closed: ["neutral", "Closed"],
};

export const MOVEMENT: Record<MovementType, [Tone, string]> = {
  opening: ["neutral", "Opening"],
  receipt: ["info", "Receipt"],
  dispatch: ["ok", "Dispatch"],
  transfer_out: ["accent", "Transfer out"],
  transfer_in: ["accent", "Transfer in"],
  customer_return: ["info", "Customer return"],
  supplier_return: ["neutral", "Supplier return"],
  damage: ["warn", "Damage"],
  adjustment: ["bad", "Adjustment"],
};

export const OrderBadge = ({ status }: { status: string }) => {
  const [tone, label] = ORDER[status as OrderStatus] ?? ["neutral", status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
};

export const CaseBadge = ({ status }: { status: string }) => {
  const [tone, label] = CASE[status as InvestigationStatus] ?? ["neutral", status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
};

export const MovementBadge = ({ type }: { type: string }) => {
  const [tone, label] = MOVEMENT[type as MovementType] ?? ["neutral", type];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
};

export function PriorityBadge({ priority }: { priority: string }) {
  const tone: Tone = priority === "high" ? "bad" : priority === "medium" ? "warn" : "neutral";
  return <Badge tone={tone}>{priority[0].toUpperCase() + priority.slice(1)}</Badge>;
}

export function ModuleBadge({ module }: { module: string }) {
  if (module === "both") {
    return (
      <span className="inline-flex gap-1">
        <Badge tone="accent">OrderTrace</Badge>
        <Badge tone="info">StockSleuth</Badge>
      </span>
    );
  }
  return module === "ordertrace" ? <Badge tone="accent">OrderTrace</Badge> : <Badge tone="info">StockSleuth</Badge>;
}

const KIND: Record<string, [Tone, string]> = { fact: ["ok", "Fact"], inference: ["warn", "Inference"], hypothesis: ["neutral", "Unverified hypothesis"] };
export function KindBadge({ kind }: { kind: string }) {
  const [tone, label] = KIND[kind] ?? ["neutral", kind];
  return <Badge tone={tone}>{label}</Badge>;
}

const CERTAINTY: Record<string, string> = { verified: "Verified from records", likely: "Likely", possible: "Possible" };
export const certaintyLabel = (c: string) => CERTAINTY[c] ?? c;

const HEALTH: Record<string, [Tone, string]> = {
  selling: ["ok", "Selling"], slow: ["warn", "Slow"], dead: ["bad", "Unsold 60d+"], "too-new": ["info", "Too new to judge"],
  "out-of-season": ["neutral", "Out of season"], "no-stock": ["neutral", "No stock"],
};
export function HealthBadge({ health }: { health: string }) {
  const [tone, label] = HEALTH[health] ?? ["neutral", health];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone: Tone = severity === "high" ? "bad" : severity === "medium" ? "warn" : "neutral";
  return <StatusBadge tone={tone}>{severity === "high" ? "Act now" : severity === "medium" ? "Soon" : "Review"}</StatusBadge>;
}

export function Delta({ n }: { n: number }) {
  if (n === 0) return <span className="text-faint">0</span>;
  return <span className={n > 0 ? "text-ok" : "text-bad"}>{n > 0 ? `+${n}` : `−${-n}`}</span>;
}
