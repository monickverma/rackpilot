// GET ?sku=: the variant id for a SKU or barcode in this business.

import type { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api";
import { variantBySku } from "@/lib/ops/stock";

export const GET = handle(async (req: NextRequest, s) => {
  const v = await variantBySku(s, req.nextUrl.searchParams.get("sku") ?? "");
  if (!v) throw new HttpError(404, "Unknown SKU.");
  return { variantId: v.id, sku: v.sku };
}, { write: false });
