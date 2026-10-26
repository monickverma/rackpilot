// Stock actions: transfers, counts, write-offs, owner adjustments, restocking returns.

import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { adjustStock, cancelTransfer, receiveTransfer, recordCount, restockReturn, sendTransfer, writeOffDamage } from "@/lib/ops/stock";

const n = z.coerce.number().int();
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send_transfer"), variantId: n, fromLocationId: n, toLocationId: n, qty: n, note: z.string().max(200).optional() }),
  z.object({ action: z.literal("receive_transfer"), transferId: n, qty: n.optional() }),
  z.object({ action: z.literal("cancel_transfer"), transferId: n, reason: z.string().max(200).default("Goods never left") }),
  z.object({ action: z.literal("count"), scope: z.string().max(120).default("Spot count"), source: z.enum(["handheld", "sheet", "cycle"]).default("handheld"), lines: z.array(z.object({ variantId: n, locationId: n, counted: n.min(0) })).min(1).max(200) }),
  z.object({ action: z.literal("damage"), variantId: n, locationId: n, qty: n, reason: z.string().max(200).default("Damaged") }),
  z.object({ action: z.literal("adjust"), variantId: n, locationId: n, qty: n, reason: z.string().min(3).max(300) }),
  z.object({ action: z.literal("restock_return"), returnId: n }),
]);

export const POST = handle(async (req, s) => {
  const a = await body(req, Action);
  switch (a.action) {
    case "send_transfer": return sendTransfer(s, a);
    case "receive_transfer": return receiveTransfer(s, a.transferId, a.qty);
    case "cancel_transfer": return cancelTransfer(s, a.transferId, a.reason);
    case "count": return recordCount(s, a);
    case "damage": return writeOffDamage(s, a);
    case "adjust": return adjustStock(s, a);
    case "restock_return": return restockReturn(s, a.returnId);
  }
});
