// GET ?q=: find a variant by SKU, barcode or description, with its locations.

import type { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { catalogue, matchLine } from "@/lib/intake/match";
import { parseOrder } from "@/lib/intake/parse";
import { balancesOf, variantBySku } from "@/lib/ops/stock";

export const GET = handle(async (req: NextRequest, s) => {
  const qy = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!qy) return [];
  const exact = await variantBySku(s, qy);
  if (exact) return [{ sku: exact.sku, locations: await balancesOf(s, exact.id) }];
  const line = parseOrder(`1 ${qy}`).lines[0];
  const m = line ? matchLine(line, await catalogue(s)) : null;
  return Promise.all((m?.candidates ?? []).slice(0, 6).map(async (c) => ({ sku: c.sku, locations: await balancesOf(s, c.variantId) })));
}, { write: false });
