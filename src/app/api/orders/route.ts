// GET: the order list. POST: confirm a draft order (validate, then reserve stock).

import type { NextRequest } from "next/server";
import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { confirmOrder, dueFromLabel, listOrders } from "@/lib/ops/orders";

export const GET = handle(async (req: NextRequest, s) => listOrders(s, { status: req.nextUrl.searchParams.get("status") ?? undefined, search: req.nextUrl.searchParams.get("q") ?? undefined }), { write: false });

const Confirm = z.object({
  customerId: z.coerce.number().int().positive(),
  channel: z.enum(["message", "voice", "document", "manual", "email"]),
  sourceText: z.string().max(4000).default(""),
  extractedBy: z.enum(["rules", "claude", "manual"]),
  dueLabel: z.string().max(20).nullable().default(null),
  lines: z.array(z.object({
    variantId: z.coerce.number().int().positive(),
    qty: z.coerce.number().int().min(1).max(5000),
    sourceText: z.string().max(300).nullable().default(null),
    matchNote: z.string().max(500).nullable().default(null),
  })).min(1, "The order has no lines.").max(60),
});

export const POST = handle(async (req, s) => {
  const input = await body(req, Confirm);
  return confirmOrder(s, { ...input, dueAt: dueFromLabel(input.dueLabel, new Date()) });
});
