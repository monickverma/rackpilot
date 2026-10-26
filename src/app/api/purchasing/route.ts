// Purchasing: generate a budget plan, approve or reject it, receive a purchase order.

import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { approvePlan, rejectPlan, savePlan } from "@/lib/intel/plan";
import { receivePurchaseOrder } from "@/lib/ops/purchasing";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("plan"), budget: z.coerce.number().int().min(1000).max(10_000_000) }),
  z.object({ action: z.literal("approve"), code: z.string().max(20) }),
  z.object({ action: z.literal("reject"), code: z.string().max(20), reason: z.string().max(300).default("") }),
  z.object({ action: z.literal("receive"), purchaseOrderId: z.coerce.number().int() }),
]);

export const POST = handle(async (req, s) => {
  const a = await body(req, Action);
  switch (a.action) {
    case "plan": {
      const { code, plan } = await savePlan(s, a.budget);
      return { code, used: plan.used, lines: plan.lines.length };
    }
    case "approve": return approvePlan(s, a.code);
    case "reject": return rejectPlan(s, a.code, a.reason);
    case "receive": return receivePurchaseOrder(s, a.purchaseOrderId);
  }
});
