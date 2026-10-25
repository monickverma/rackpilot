// Matches parsed order lines to catalogue variants. Pure: the caller passes the
// catalogue with recent sales, so the same message always gets the same match,
// and every match comes with the reason it was chosen.

import { PRODUCT_LABELS } from "./parser/lexicon.ts";
import type { ParsedLine } from "./parser/types.ts";

export interface CatalogVariant {
  variantId: number;
  sku: string;
  productId: number;
  productCode: string;
  productName: string;
  category: string;
  keywords: string;
  colour: string;
  size: string;
  location: string;
  onHand: number;
  reserved: number;
  sellPrice: number;
  sold30: number;
}

export interface Candidate {
  variantId: number;
  sku: string;
  productCode: string;
  productName: string;
  colour: string;
  size: string;
  location: string;
  onHand: number;
  available: number;
  sold30: number;
}

export interface LineMatch {
  status: "matched" | "needs-choice" | "unmatched";
  chosenId: number | null;
  /** Best first; the owner can switch to any of these in the draft. */
  candidates: Candidate[];
  reason: string;
}

const MAX_CANDIDATES = 8;
const words = (s: string) =>
  s.toLowerCase().replace(/[-']/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2);

const toCandidate = (v: CatalogVariant): Candidate => ({
  variantId: v.variantId, sku: v.sku, productCode: v.productCode, productName: v.productName,
  colour: v.colour, size: v.size, location: v.location, onHand: v.onHand, available: v.onHand - v.reserved, sold30: v.sold30,
});

const sizeLabel = (size: string) => (size === "FREE" ? "free size" : size);
const plural = (label: string) => (/s$/.test(label) ? label : `${label}s`);

export function matchLines(lines: ParsedLine[], catalog: CatalogVariant[]): LineMatch[] {
  let previousProductId: number | null = null;
  return lines.map((line) => {
    const m = matchLine(line, catalog, previousProductId);
    const chosen = m.chosenId === null ? undefined : catalog.find((v) => v.variantId === m.chosenId);
    if (chosen) previousProductId = chosen.productId;
    return m;
  });
}

function matchLine(line: ParsedLine, catalog: CatalogVariant[], previousProductId: number | null): LineMatch {
  const label = line.product ? (PRODUCT_LABELS[line.product] ?? line.product).toLowerCase() : null;
  const unmatched = (reason: string, alternatives: CatalogVariant[] = []): LineMatch => ({
    status: "unmatched", chosenId: null, reason,
    candidates: rank(alternatives, line, previousProductId, catalog).slice(0, MAX_CANDIDATES).map(toCandidate),
  });

  let pool: CatalogVariant[];
  let what: string;
  if (line.code) {
    const digits = line.code.replace(/\D/g, "");
    pool = catalog.filter((v) => v.productCode === line.code!.toUpperCase() || (digits && v.productCode.replace(/\D/g, "") === digits));
    what = `design ${line.code}`;
    if (!pool.length) return unmatched(`No design ${line.code} in the catalogue.`);
  } else if (line.product) {
    pool = catalog.filter((v) => v.category === line.product);
    what = plural(label!);
    if (!pool.length) return unmatched(`The shop doesn't stock ${what}.`);
  } else {
    return unmatched("The message doesn't say which product.");
  }

  pool = narrowByKeywords(pool, line);

  if (line.colour) {
    const inColour = pool.filter((v) => v.colour === line.colour);
    if (!inColour.length) {
      const sameSize = line.size ? pool.filter((v) => v.size === line.size) : pool;
      return unmatched(`No ${line.colour} ${what}. Other colours are listed.`, sameSize.length ? sameSize : pool);
    }
    pool = inColour;
  }

  const freeSize = pool.every((v) => v.size === "FREE");
  if (!freeSize && line.size && line.size !== "FREE") {
    const inSize = pool.filter((v) => v.size === line.size);
    if (!inSize.length) return unmatched(`No ${line.colour ? `${line.colour} ` : ""}${what} in ${line.size}. Other sizes are listed.`, pool);
    pool = inSize;
  }

  const ranked = rank(pool, line, previousProductId, catalog);
  const candidates = ranked.slice(0, MAX_CANDIDATES).map(toCandidate);
  const colours = new Set(pool.map((v) => v.colour));
  const sizes = new Set(pool.map((v) => v.size));
  if (!line.colour && colours.size > 1) {
    return { status: "needs-choice", chosenId: null, candidates, reason: `Colour not given: ${what} come in ${[...colours].join(", ")}.` };
  }
  if (!freeSize && !line.size && sizes.size > 1) {
    return { status: "needs-choice", chosenId: null, candidates, reason: `Size not given for ${line.colour ?? ""} ${what}.`.replace(/\s+/g, " ") };
  }
  const top = ranked[0];
  return { status: "matched", chosenId: top.variantId, candidates, reason: explain(top, ranked, line, previousProductId, what) };
}

interface Scored {
  v: CatalogVariant;
  keywordHits: string[];
  sameAsPrevious: boolean;
  priceMatch: boolean;
}

function keywordHits(v: CatalogVariant, line: ParsedLine): string[] {
  const said = new Set([...line.descriptors.flatMap(words), ...words(line.sourceText)]);
  const known = new Set(words(`${v.productName} ${v.keywords}`));
  return [...said].filter((w) => known.has(w) && w !== line.product && !/^\d+$/.test(w));
}

/** Words every candidate shares (like "kurti") tell them apart from nothing. */
function sharedWords(hits: string[][]): string[] {
  return hits.length > 1 ? hits.reduce((a, b) => a.filter((w) => b.includes(w))) : [];
}

/**
 * A design word ("chikankari", "denim", "anarkali") names a product: keep only
 * the products that match the most such words, before colour and size.
 */
function narrowByKeywords(pool: CatalogVariant[], line: ParsedLine): CatalogVariant[] {
  const products = new Map<number, CatalogVariant>();
  for (const v of pool) if (!products.has(v.productId)) products.set(v.productId, v);
  if (products.size < 2) return pool;
  const hits = [...products].map(([id, v]) => [id, keywordHits(v, line)] as const);
  const common = sharedWords(hits.map(([, h]) => h));
  const counts = new Map(hits.map(([id, h]) => [id, h.filter((w) => !common.includes(w)).length]));
  const best = Math.max(...counts.values());
  return best === 0 ? pool : pool.filter((v) => counts.get(v.productId) === best);
}

function score(v: CatalogVariant, line: ParsedLine, previousProductId: number | null): Scored {
  return {
    v,
    keywordHits: keywordHits(v, line),
    sameAsPrevious: previousProductId === v.productId && line.inherited.includes("product"),
    priceMatch: line.priceHint !== null && Math.abs(v.sellPrice - line.priceHint) <= line.priceHint * 0.15,
  };
}

const weight = (s: Scored) => s.keywordHits.length * 3 + (s.sameAsPrevious ? 5 : 0) + (s.priceMatch ? 2 : 0);

type Ranked = CatalogVariant & { scored: Scored; productSold30: number };

function rank(pool: CatalogVariant[], line: ParsedLine, previousProductId: number | null, catalog: CatalogVariant[]): Ranked[] {
  // Ties go to the product that sells most overall, not to whichever size
  // happened to sell one more this month.
  const productSold = new Map<number, number>();
  for (const v of catalog) productSold.set(v.productId, (productSold.get(v.productId) ?? 0) + v.sold30);
  const scored = pool.map((v) => score(v, line, previousProductId));
  const common = sharedWords(scored.map((s) => s.keywordHits));
  for (const s of scored) s.keywordHits = s.keywordHits.filter((w) => !common.includes(w));
  const sold = (s: Scored) => productSold.get(s.v.productId) ?? 0;
  return scored
    .sort((a, b) => weight(b) - weight(a) || sold(b) - sold(a) || b.v.sold30 - a.v.sold30 || a.v.sku.localeCompare(b.v.sku))
    .map((s) => ({ ...s.v, scored: s, productSold30: sold(s) }));
}

function explain(top: Ranked, ranked: Ranked[], line: ParsedLine, previousProductId: number | null, what: string): string {
  const s = top.scored;
  const bits: string[] = [];
  if (line.code) bits.push(`Design ${line.code} is ${top.productCode} ${top.productName}.`);
  if (s.keywordHits.length) bits.push(`"${s.keywordHits.join(", ")}" matches ${top.productName}.`);
  if (s.sameAsPrevious && previousProductId !== null) bits.push("Same product as the line before.");
  if (s.priceMatch) bits.push(`₹${line.priceHint} is close to its price of ₹${top.sellPrice}.`);
  const rivals = new Set(ranked.filter((r) => weight(r.scored) === weight(s)).map((r) => r.productId));
  const desc = `${line.colour ? `${line.colour} ` : ""}${what}${top.size !== "FREE" ? ` in ${sizeLabel(top.size)}` : ""}`;
  if (rivals.size > 1) bits.push(`${rivals.size} ${desc} match; ${top.productCode} ${top.productName} sells most (${top.productSold30} in 30 days).`);
  else if (!bits.length) bits.push(`The only ${desc.replace(/s(?= in |$)/, "")} in the catalogue.`);
  return bits.join(" ");
}
