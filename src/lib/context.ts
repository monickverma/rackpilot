// Who is acting, for which business, and what they may do. Every domain
// function takes a Ctx, scopes its queries by ctx.businessId and checks the
// permission it needs, so the API can't be used to reach another tenant's
// records or skip a role check.

import { run } from "../db/client.ts";
import type { Role } from "../db/schema.ts";

export interface Ctx {
  businessId: number;
  user: { id: number; name: string; role: Role };
  now?: Date;
}

export const nowOf = (ctx: Ctx) => ctx.now ?? new Date();

/** A rule of the business was broken; the message is safe to show. */
export class DomainError extends Error {}
export class ForbiddenError extends DomainError {}
export class NotFoundError extends DomainError {}

export type Permission =
  | "orders.write" | "warehouse.write" | "billing.write" | "stock.adjust" | "purchasing.approve" | "investigations.work"
  | "investigations.resolve.ordertrace" | "investigations.resolve.stocksleuth" | "investigations.close" | "demo.reset";

const GRANTS: Record<Role, Permission[]> = {
  owner: ["orders.write", "warehouse.write", "billing.write", "stock.adjust", "purchasing.approve", "investigations.work", "investigations.resolve.ordertrace", "investigations.resolve.stocksleuth", "investigations.close", "demo.reset"],
  warehouse: ["warehouse.write", "investigations.work", "investigations.resolve.stocksleuth", "demo.reset"],
  accounts: ["orders.write", "billing.write", "investigations.work", "investigations.resolve.ordertrace", "demo.reset"],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", warehouse: "Warehouse", accounts: "Accounts" };

export const can = (ctx: Ctx, p: Permission) => GRANTS[ctx.user.role].includes(p);

const WHY: Record<Permission, string> = {
  "orders.write": "Only the owner or accounts can create and change orders.",
  "warehouse.write": "Only the owner or warehouse staff can pick, dispatch, move or count stock.",
  "billing.write": "Only the owner or accounts can issue invoices and record payments.",
  "stock.adjust": "Only the owner can approve a stock adjustment.",
  "purchasing.approve": "Only the owner can approve a purchase plan.",
  "investigations.work": "You can't work on investigations.",
  "investigations.resolve.ordertrace": "Only the owner or accounts can resolve an OrderTrace case.",
  "investigations.resolve.stocksleuth": "Only the owner or warehouse staff can resolve a StockSleuth case.",
  "investigations.close": "Only the owner can close a case.",
  "demo.reset": "You can't reset the demo.",
};

export function need(ctx: Ctx, p: Permission) {
  if (!can(ctx, p)) throw new ForbiddenError(WHY[p]);
}

/** Who changed what, when, and why. Append-only. */
export async function audit(ctx: Ctx, action: string, entity: { type: string; id?: number | null; code?: string | null }, reason: string | null = null, data: object = {}) {
  await run(
    `INSERT INTO audit_events (business_id, actor_user_id, action, entity_type, entity_id, entity_code, reason, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    ctx.businessId, ctx.user.id, action, entity.type, entity.id ?? null, entity.code ?? null, reason, JSON.stringify(data), nowOf(ctx),
  );
}
