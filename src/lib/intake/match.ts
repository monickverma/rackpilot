// Matches parsed order lines to the business's own catalogue. Product words
// are scored against each product's name, category, design and keywords,
// with words shared by many products ("tee") counting less than words that
// pick one out ("oversized"). If two products score the same, or the colour
// or size is missing, the line needs a person to choose: RackPilot never
// guesses a SKU.

import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import type { ParsedLine } from "./parse.ts";

export interface CatalogVariant {
  variantId: number;
  sku: string;
  productId: number;
  productCode: string;
  productName: string;
  text: string;
  colour: string;
  size: string;
  location: string;
  available: number;
  unitPrice: number;
  ordered28: number;
}

export interface Candidate {
  variantId: number;
  sku: string;
  productName: string;
  colour: string;
  size: string;
  location: string;
  available: number;
  unitPrice: number;
}

export interface LineMatch {
  status: "matched" | "needs-choice" | "unmatched";
  chosenId: number | null;
  candidates: Candidate[];
  reason: string;
  matchedWords: string[];
}

export async function catalogue(ctx: Ctx): Promise<CatalogVariant[]> {
  return q<CatalogVariant>(
    `SELECT v.id AS "variantId", v.sku, p.id AS "productId", p.code AS "productCode", p.name AS "productName",
            lower(p.code || ' ' || p.name || ' ' || p.category || ' ' || p.design || ' ' || p.keywords) AS text, v.colour, v.size, l.code AS location,
            COALESCE((SELECT SUM(b.on_hand - b.reserved) FROM inventory_balances b JOIN locations bl ON bl.id = b.location_id WHERE b.variant_id = v.id AND bl.sellable), 0)::int AS available,
            p.unit_price AS "unitPrice",
            COALESCE((SELECT SUM(oi.qty_ordered) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.variant_id = v.id AND o.created_at > now() - interval '28 days'), 0)::int AS ordered28
       FROM product_variants v JOIN products p ON p.id = v.product_id JOIN locations l ON l.id = v.home_location_id WHERE v.business_id = $1`,
    ctx.businessId,
  );
}

const stem = (w: string) => w.replace(/(?:es|s)$/, "").replace(/^tshirt$/, "tee");
const wordsOf = (text: string) => new Set(text.replace(/t-shirt/g, "tshirt").split(/[^a-z0-9]+/).filter(Boolean).map(stem));

const toCandidate = (v: CatalogVariant): Candidate => ({
  variantId: v.variantId, sku: v.sku, productName: v.productName, colour: v.colour, size: v.size, location: v.location, available: v.available, unitPrice: v.unitPrice,
});

export function matchLine(line: ParsedLine, catalog: CatalogVariant[], hint?: { productCode?: string | null }): LineMatch {
  const products = new Map<number, { code: string; name: string; words: Set<string>; nameWords: Set<string>; variants: CatalogVariant[]; sales: number }>();
  for (const v of catalog) {
    let p = products.get(v.productId);
    if (!p) products.set(v.productId, (p = { code: v.productCode, name: v.productName, words: wordsOf(v.text), nameWords: wordsOf(v.productName.toLowerCase()), variants: [], sales: 0 }));
    p.variants.push(v);
    p.sales += v.ordered28;
  }
  const lineWords = [...new Set(line.words.map(stem))].filter((w) => w.length > 1);
  const df = new Map<string, number>();
  for (const w of lineWords) df.set(w, [...products.values()].filter((p) => p.words.has(w)).length);

  let scored = [...products.values()].map((p) => {
    const hits = lineWords.filter((w) => p.words.has(w));
    // A word in the product's name counts double: "sweatshirt" picks the Crew Sweatshirt over a hoodie tagged "sweatshirt".
    return { p, hits, score: hits.reduce((a, w) => a + (p.nameWords.has(w) ? 2 : 1) / (df.get(w) || 1), 0) };
  });
  if (hint?.productCode) {
    const hinted = scored.find((s) => s.p.code === hint.productCode);
    if (hinted) scored = [{ ...hinted, score: Math.max(hinted.score, 1) + 10 }];
  }
  const best = Math.max(0, ...scored.map((s) => s.score));
  if (best === 0) {
    return { status: "unmatched", chosenId: null, candidates: [], reason: line.words.length ? `No product matches "${line.words.join(" ")}".` : "No product named.", matchedWords: [] };
  }
  const top = scored.filter((s) => Math.abs(s.score - best) < 1e-9).sort((a, b) => b.p.sales - a.p.sales);
  const matchedWords = [...new Set(top.flatMap((s) => s.hits))];
  const pool = top.flatMap((s) => s.p.variants);
  const fits = pool.filter((v) => (!line.colour || v.colour === line.colour) && (!line.size || v.size === line.size));
  const describe = (s: (typeof top)[number]) => `${s.p.name} (${s.p.code})`;

  if (!fits.length) {
    const sameProduct = pool.filter((v) => !line.size || v.size === line.size).sort((a, b) => b.ordered28 - a.ordered28).slice(0, 8);
    const missing = line.colour && !pool.some((v) => v.colour === line.colour) ? `in ${line.colour}` : line.size ? `in ${line.colour ?? ""} size ${line.size}`.replace("  ", " ") : "";
    return {
      status: "unmatched", chosenId: null, candidates: sameProduct.map(toCandidate), matchedWords,
      reason: `${top.map(describe).join(" or ")} doesn't come ${missing}. Pick a variant or leave the line out.`,
    };
  }
  if (top.length > 1) {
    return {
      status: "needs-choice", chosenId: null, candidates: fits.sort((a, b) => b.ordered28 - a.ordered28).slice(0, 8).map(toCandidate), matchedWords,
      reason: `"${line.words.join(" ")}" fits ${top.length} products: ${top.map(describe).join(", ")}. Choose the right one.`,
    };
  }
  if (fits.length > 1) {
    const missing = [!line.colour && "colour", !line.size && "size"].filter(Boolean).join(" and ");
    return {
      status: "needs-choice", chosenId: null, candidates: fits.sort((a, b) => b.ordered28 - a.ordered28).slice(0, 8).map(toCandidate), matchedWords,
      reason: `${describe(top[0])}, but the ${missing || "variant"} isn't given. Choose one.`,
    };
  }
  const v = fits[0];
  const via = hint?.productCode ? "the product Claude read" : `"${top[0].hits.join(" ")}"`;
  return { status: "matched", chosenId: v.variantId, candidates: [toCandidate(v)], matchedWords, reason: `${v.productName} from ${via}, ${v.colour}, size ${v.size}.` };
}
