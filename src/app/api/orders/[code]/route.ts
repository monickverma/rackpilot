// GET: an order with every linked record (what OrderTrace reconciles).
// POST: one workflow action on the order.

import * as z from "zod/v4";
import { one } from "@/db/client";
import { body, handle, HttpError } from "@/lib/api";
import { issueInvoice, recordPayment } from "@/lib/ops/billing";
import { cancelOrder, confirmPick, createPickList, decideShortage, dispatchOrder, markCompleted } from "@/lib/ops/orders";
import { orderRecords } from "@/lib/records";
import type { Session } from "@/lib/auth";

async function orderId(s: Session, code: string) {
  const o = await one<{ id: number }>(`SELECT id FROM orders WHERE business_id = $1 AND code = $2`, s.businessId, code.toUpperCase());
  if (!o) throw new HttpError(404, "Order not found.");
  return o.id;
}

export const GET = handle(async (_req, s, p: { code: string }) => orderRecords(s.businessId, await orderId(s, p.code)), { write: false });

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pick_list") }),
  z.object({ action: z.literal("confirm_pick"), pickListId: z.coerce.number().int(), lines: z.array(z.object({ lineId: z.coerce.number().int(), qtyPicked: z.coerce.number().int().min(0) })) }),
  z.object({ action: z.literal("dispatch"), carrier: z.string().max(60).optional(), tracking: z.string().max(60).optional(), lines: z.array(z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().int().min(0) })).optional() }),
  z.object({ action: z.literal("shortage"), orderItemId: z.coerce.number().int(), decision: z.enum(["backorder", "ship_partial", "retry"]) }),
  z.object({ action: z.literal("invoice"), lines: z.array(z.object({ orderItemId: z.coerce.number().int(), qty: z.coerce.number().int().min(0) })).optional(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("payment"), invoiceId: z.coerce.number().int().nullable(), amount: z.coerce.number().int().positive(), method: z.enum(["upi", "bank", "cash", "cheque"]), reference: z.string().max(80).default("") }),
  z.object({ action: z.literal("cancel"), reason: z.string().max(300).default("") }),
  z.object({ action: z.literal("complete"), reason: z.string().max(300).default("") }),
]);

export const POST = handle(async (req, s, p: { code: string }) => {
  const id = await orderId(s, p.code);
  const a = await body(req, Action);
  switch (a.action) {
    case "pick_list": return createPickList(s, id);
    case "confirm_pick": return confirmPick(s, a.pickListId, a.lines);
    case "dispatch": return dispatchOrder(s, id, a);
    case "shortage": return decideShortage(s, a.orderItemId, a.decision);
    case "invoice": return issueInvoice(s, id, { lines: a.lines?.filter((l) => l.qty > 0), note: a.note });
    case "payment": {
      const o = await one<{ customerId: number }>(`SELECT customer_id AS "customerId" FROM orders WHERE id = $1`, id);
      return recordPayment(s, { customerId: o!.customerId, invoiceId: a.invoiceId, amount: a.amount, method: a.method, reference: a.reference });
    }
    case "cancel": return cancelOrder(s, id, a.reason);
    case "complete": return markCompleted(s, id, a.reason);
  }
});
