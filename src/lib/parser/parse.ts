// Rule-based parser: WhatsApp order text -> line items. No LLM, no I/O.
//
// 1. tokenize: split into words, numbers and punctuation, keeping offsets
// 2. classify: longest-phrase lookup in the lexicon, then context rules for
//    numbers (qty vs date vs price vs chest size) and the word "do"
// 3. segment: cut at separators (comma, newline, "aur", "and"...)
// 4. assemble: turn each segment into lines, carrying product/colour/size
//    forward the way people write ("3 black kurti M, 2 L, 1 maroon XL")

import {
  CODE_MARKERS,
  DATE_SUFFIX_WORDS,
  DO_VERBS,
  FREE_SIZE_PRODUCTS,
  LEXICON,
  MAX_PHRASE_WORDS,
  MONTHS,
  NUMERIC_SIZES,
  PRICE_WORDS,
  SIZE_WORDS,
} from "./lexicon.ts";
import type { Attr, DueInfo, ParsedLine, ParseResult, Size, Token } from "./types.ts";

type RawKind = "date" | "xl" | "code" | "num" | "word" | "rupee" | "punct";

interface Raw {
  text: string;
  norm: string;
  start: number;
  end: number;
  raw: RawKind;
  ordinal?: boolean;
}

// Alternatives, in priority order: 28/10 dates, XL-family sizes (2xl, 3xl),
// product codes (K101), numbers with optional ordinal, words, rupee sign, punctuation.
const TOKEN_RE =
  /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|([23]?x{1,3}l)(?![a-z])|((?:ts|sr|lh|sh|k|s|p|l|t|n|d|g|j|c)\d{3,4})(?![a-z\d])|(\d+)(?:(st|nd|rd|th)(?![a-z]))?|([a-z]+(?:['’][a-z]+)?(?:-[a-z]+)*)|(₹)|([,;.!?|&+:=\n—–/()#-])/gi;

const MAX_QTY = 500;

function tokenize(message: string): Raw[] {
  const out: Raw[] = [];
  for (const m of message.matchAll(TOKEN_RE)) {
    const text = m[0];
    const start = m.index ?? 0;
    const end = start + text.length;
    const lower = text.toLowerCase();
    if (m[1]) out.push({ text, norm: lower, start, end, raw: "date" });
    else if (m[2]) out.push({ text, norm: lower, start, end, raw: "xl" });
    else if (m[3]) out.push({ text, norm: lower, start, end, raw: "code" });
    else if (m[4]) out.push({ text, norm: m[4], start, end, raw: "num", ordinal: Boolean(m[5]) });
    else if (m[6]) out.push({ text, norm: lower.replace(/['’-]/g, ""), start, end, raw: "word" });
    else if (m[7]) out.push({ text, norm: "₹", start, end, raw: "rupee" });
    else out.push({ text, norm: lower, start, end, raw: "punct" });
  }
  return out;
}

const SEP_PUNCT = new Set([",", ";", ".", "!", "?", "|", "&", "+", ":", "\n", "—", "–", "/"]);
const DOT_ABBREVIATIONS = new Set(["pc", "pcs", "no", "nos", "rs", "qty"]);
const ITEM_KINDS = new Set(["qty", "size", "colour", "product", "descriptor", "code"]);
const SOFT_PUNCT = new Set(["-", "(", ")"]);

function classify(raws: Raw[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raws.length) {
    const r = raws[i];
    const base = { text: r.text, norm: r.norm, start: r.start, end: r.end };
    if (r.raw === "word") {
      // Longest phrase first: "diwali se pehle" beats "diwali".
      let matched = false;
      for (let n = Math.min(MAX_PHRASE_WORDS, raws.length - i); n >= 1; n--) {
        const slice = raws.slice(i, i + n);
        if (slice.some((s) => s.raw !== "word")) continue;
        const phrase = slice.map((s) => s.norm).join(" ");
        if (n === 1 && phrase === "do") break; // decided later from context
        const entry = LEXICON.get(phrase);
        if (!entry) continue;
        const last = slice[slice.length - 1];
        tokens.push({ text: slice.map((s) => s.text).join(" "), norm: phrase, start: r.start, end: last.end, kind: entry.kind, value: entry.value });
        i += n;
        matched = true;
        break;
      }
      if (matched) continue;
      if (r.norm === "do") tokens.push({ ...base, kind: "filler", value: "maybe-two" });
      else tokens.push({ ...base, kind: "unknown" });
    } else if (r.raw === "num") {
      const n = Number(r.norm);
      if (r.ordinal) tokens.push({ ...base, kind: "due", value: `date:${n}` });
      else if (n > MAX_QTY) tokens.push({ ...base, kind: "unknown" });
      else tokens.push({ ...base, kind: "qty", value: n });
    } else if (r.raw === "xl") {
      const v = r.norm === "2xl" ? "XXL" : r.norm === "3xl" ? "XXXL" : r.norm.toUpperCase();
      tokens.push({ ...base, kind: "size", value: v });
    } else if (r.raw === "code") {
      tokens.push({ ...base, kind: "code", value: r.norm.toUpperCase() });
    } else if (r.raw === "date") {
      tokens.push({ ...base, kind: "due", value: `date:${Number(r.norm.split("/")[0])}` });
    } else if (r.raw === "rupee") {
      tokens.push({ ...base, kind: "filler", value: "rupee" });
    } else {
      tokens.push({ ...base, kind: SEP_PUNCT.has(r.norm) ? "sep" : "filler" });
    }
    i++;
  }
  applyContextRules(tokens);
  return tokens;
}

function applyContextRules(t: Token[]) {
  // Neighbours within the same segment, skipping "-", "(" and ")".
  const prev = (i: number) => {
    for (let j = i - 1; j >= 0; j--) {
      if (SOFT_PUNCT.has(t[j].norm)) continue;
      return t[j].kind === "sep" ? undefined : t[j];
    }
    return undefined;
  };
  const next = (i: number) => {
    for (let j = i + 1; j < t.length; j++) {
      if (SOFT_PUNCT.has(t[j].norm)) continue;
      return t[j].kind === "sep" ? undefined : t[j];
    }
    return undefined;
  };

  for (let i = 0; i < t.length; i++) {
    const tok = t[i];

    if (tok.kind === "qty" && typeof tok.value === "number" && /^\d+$/.test(tok.norm)) {
      const n = tok.value;
      const nx = next(i);
      const pv = prev(i);
      // "28 tak", "5 tarikh", "28 oct", "oct 28" -> date
      if (n >= 1 && n <= 31 && ((nx && (DATE_SUFFIX_WORDS.has(nx.norm) || nx.norm in MONTHS)) || (pv && pv.norm in MONTHS))) {
        tok.kind = "due";
        tok.value = `date:${n}`;
        continue;
      }
      // "₹549", "rs 549", "549 wali" -> price hint, not a quantity
      if ((pv && (pv.value === "rupee" || pv.norm === "rs" || pv.norm === "inr")) || (nx && PRICE_WORDS.has(nx.norm) && n >= 50)) {
        tok.kind = "price";
        continue;
      }
      // "40 size", "size 40" -> chest size
      if (n in NUMERIC_SIZES && ((nx && SIZE_WORDS.has(nx.norm)) || (pv && SIZE_WORDS.has(pv.norm)))) {
        tok.kind = "size";
        tok.value = NUMERIC_SIZES[n];
        continue;
      }
      // "design 104", "design no 104", "#104" -> product code
      const pv2 = pv ? prev(t.indexOf(pv)) : undefined;
      if ((pv && CODE_MARKERS.has(pv.norm)) || (pv && SIZE_WORDS.has(pv.norm) && pv2 && CODE_MARKERS.has(pv2.norm)) || t[i - 1]?.norm === "#") {
        tok.kind = "code";
        tok.value = String(n);
        continue;
      }
      // "2 dozen" -> 24
      if (nx && nx.kind === "unit" && (nx.norm === "dozen" || nx.norm === "dozens" || nx.norm === "darjan")) tok.value = n * 12;
    }

    // "do" means 2 only when it opens a quantity: "do kurti", not "bhej do".
    if (tok.value === "maybe-two") {
      const pv = prev(i);
      const nx = next(i);
      const opensItem = nx && (ITEM_KINDS.has(nx.kind) || nx.kind === "unit" || nx.kind === "each" || nx.norm === "do");
      const afterDo = pv && pv.norm === "do" && pv.kind === "qty";
      if ((opensItem && !(pv && DO_VERBS.has(pv.norm))) || afterDo) {
        tok.kind = "qty";
        tok.value = 2;
      } else {
        tok.value = undefined;
      }
    }
  }

  // "2-2" and "ek ek" / "do do" mean "that many of each".
  for (let i = 0; i < t.length; i++) {
    const a = t[i];
    if (a.kind !== "qty") continue;
    const dash = t[i + 1];
    const b = dash?.norm === "-" ? t[i + 2] : dash;
    if (!b || b.kind !== "qty" || b.value !== a.value) continue;
    const digitPair = dash.norm === "-" && /^\d+$/.test(a.norm) && /^\d+$/.test(b.norm);
    const wordPair = dash === b && !/^\d/.test(a.norm) && !/^\d/.test(b.norm);
    if (!digitPair && !wordPair) continue;
    a.each = true;
    a.end = b.end;
    a.text = `${a.text}${digitPair ? "-" : " "}${b.text}`;
    b.kind = "filler";
    b.value = "merged";
  }

  // "M:3" (no spaces) joins a size to its quantity; "Size M: 2 black..." is still a heading.
  for (let i = 1; i < t.length - 1; i++) {
    const tight = t[i - 1].end === t[i].start && t[i].end === t[i + 1].start;
    if (t[i].norm === ":" && tight && (t[i - 1].kind === "size" || t[i - 1].kind === "colour") && t[i + 1].kind === "qty") t[i].kind = "filler";
  }

  // "pc." and "no." are abbreviations, not sentence ends.
  for (let i = 1; i < t.length; i++) {
    if (t[i].norm === "." && DOT_ABBREVIATIONS.has(t[i - 1].norm) && t[i - 1].end === t[i].start) t[i].kind = "filler";
  }
}

interface Segment {
  toks: Token[];
  qtys: Token[];
  sizes: Token[];
  colours: Token[];
  products: Token[];
  descriptors: string[];
  codes: string[];
  price: number | null;
  each: boolean;
}

function makeSegment(toks: Token[]): Segment {
  const seg: Segment = { toks, qtys: [], sizes: [], colours: [], products: [], descriptors: [], codes: [], price: null, each: false };
  for (const tok of toks) {
    if (tok.kind === "qty") {
      seg.qtys.push(tok);
      if (tok.each) seg.each = true;
    } else if (tok.kind === "size") seg.sizes.push(tok);
    else if (tok.kind === "colour") seg.colours.push(tok);
    else if (tok.kind === "product") {
      // "palazzo plazo" is one mention, not two products.
      if (seg.products[seg.products.length - 1]?.value !== tok.value) seg.products.push(tok);
    } else if (tok.kind === "descriptor") seg.descriptors.push(String(tok.value));
    else if (tok.kind === "code") seg.codes.push(String(tok.value));
    else if (tok.kind === "price") seg.price = Number(tok.norm);
    else if (tok.kind === "each") seg.each = true;
  }
  return seg;
}

function attrs(seg: Segment): Set<string> {
  const s = new Set<string>();
  if (seg.products.length || seg.codes.length) s.add("product");
  if (seg.colours.length) s.add("colour");
  if (seg.sizes.length) s.add("size");
  if (seg.qtys.length) s.add("qty");
  return s;
}

/** Splits "1 denim jacket blue M 2 grey shrugs L" into one segment per product. */
function splitByProduct(g: Token[]): Token[][] {
  const out: Token[][] = [];
  let current: Token[] = [];
  let currentProduct: string | undefined;
  for (const tok of g) {
    if (tok.kind === "product" && currentProduct !== undefined && tok.value !== currentProduct) {
      let cut = -1;
      for (let j = current.length - 1; j >= 0; j--) if (current[j].kind === "size") { cut = j + 1; break; }
      if (cut >= 0) {
        // "kurti black M 2 legging..." - a trailing qty belongs to the item before it
        // unless that item already has its quantity ("1 jacket blue M 2 grey shrugs").
        const nextQty = current.slice(cut).find((x) => x.kind === "qty");
        const hasQty = current.slice(0, cut).some((x) => x.kind === "qty");
        if (nextQty && !hasQty) cut = current.indexOf(nextQty) + 1;
      } else {
        cut = current.length;
        for (let j = current.length - 1; j >= 0; j--) {
          const k = current[j].kind;
          if (k === "qty" || k === "colour" || k === "descriptor") cut = j;
          else if (k !== "filler" && k !== "unit") break;
        }
      }
      out.push(current.slice(0, cut));
      current = current.slice(cut);
    }
    if (tok.kind === "product") currentProduct = String(tok.value);
    current.push(tok);
  }
  out.push(current);
  return out;
}

function splitSegments(tokens: Token[]): Segment[] {
  const groups: Token[][] = [[]];
  for (const tok of tokens) {
    if (tok.kind === "sep") groups.push([]);
    else groups[groups.length - 1].push(tok);
  }
  const items = groups.flatMap(splitByProduct).map(makeSegment).filter((s) => attrs(s).size > 0);

  // A list split by commas belongs together: "black leggings M, L, XL - 2 each".
  const merged: Segment[] = [];
  for (const seg of items) {
    const prevSeg = merged[merged.length - 1];
    if (prevSeg && !prevSeg.qtys.length && !seg.products.length && !seg.codes.length) {
      const a = attrs(seg);
      a.delete("qty");
      const pa = attrs(prevSeg);
      if (a.size === 1 && [...a].every((x) => pa.has(x))) {
        merged[merged.length - 1] = makeSegment([...prevSeg.toks, ...seg.toks]);
        continue;
      }
    }
    merged.push(seg);
  }
  return merged;
}

interface Context {
  product: string | null;
  colour: string | null;
  size: Size | null;
  sizeSticky: boolean;
  descriptors: string[];
  code: string | null;
  price: number | null;
}

/** Tokens that matter for "which number belongs to which size". */
const isAnchor = (t: Token) => ITEM_KINDS.has(t.kind);

function pairQuantities(seg: Segment, slots: Token[]): { qtys: (number | null)[]; leftovers: Token[]; assumedEach: boolean } {
  const anchors = seg.toks.filter(isAnchor);
  const at = (t: Token, d: number) => anchors[anchors.indexOf(t) + d];

  if (slots.length <= 1) {
    if (seg.qtys.length === 0) return { qtys: [null], leftovers: [], assumedEach: false };
    if (seg.qtys.length === 1) return { qtys: [Number(seg.qtys[0].value)], leftovers: [], assumedEach: false };
    const slot = slots[0];
    let pick: Token | undefined;
    if (slot) {
      const after = at(slot, 1);
      const before = at(slot, -1);
      pick = after?.kind === "qty" ? after : before?.kind === "qty" ? before : undefined;
    }
    pick ??= seg.qtys[seg.qtys.length - 1];
    return { qtys: [Number(pick.value)], leftovers: seg.qtys.filter((q) => q !== pick), assumedEach: false };
  }

  const tryMode = (dir: 1 | -1): Token[] | null => {
    const picked: Token[] = [];
    for (const s of slots) {
      const q = at(s, dir);
      if (!q || q.kind !== "qty" || picked.includes(q)) return null;
      picked.push(q);
    }
    return picked;
  };
  const sizeFirst = anchors[0] === slots[0];
  const picked = sizeFirst ? (tryMode(1) ?? tryMode(-1)) : (tryMode(-1) ?? tryMode(1));
  if (picked) {
    return { qtys: picked.map((q) => Number(q.value)), leftovers: seg.qtys.filter((q) => !picked.includes(q)), assumedEach: false };
  }
  if (seg.qtys.length === 1) return { qtys: slots.map(() => Number(seg.qtys[0].value)), leftovers: [], assumedEach: !seg.each };
  if (seg.qtys.length === slots.length) return { qtys: seg.qtys.map((q) => Number(q.value)), leftovers: [], assumedEach: false };
  if (seg.qtys.length === 0) return { qtys: slots.map(() => null), leftovers: [], assumedEach: false };
  return {
    qtys: slots.map((_, k) => (seg.qtys[k] ? Number(seg.qtys[k].value) : null)),
    leftovers: seg.qtys.slice(slots.length),
    assumedEach: false,
  };
}

function spanOf(seg: Segment, message: string): { text: string; span: [number, number] } {
  const items = seg.toks.filter((t) => isAnchor(t) || t.kind === "unit" || t.kind === "each");
  const list = items.length ? items : seg.toks;
  const start = Math.min(...list.map((t) => t.start));
  const end = Math.max(...list.map((t) => t.end));
  return { text: message.slice(start, end).replace(/\s+/g, " ").trim(), span: [start, end] };
}

interface Group {
  total: number | null;
  lines: ParsedLine[];
  headerQtyApplied: boolean;
}

export function parseOrder(message: string): ParseResult {
  const tokens = classify(tokenize(message));
  const segs = splitSegments(tokens);

  const ctx: Context = { product: null, colour: null, size: null, sizeSticky: false, descriptors: [], code: null, price: null };
  const lines: ParsedLine[] = [];
  // Lines under one product mention, used to check stated totals ("10 pcs: M 3, L 4, XL 3").
  const groups: Group[] = [];
  let group: Group | null = null;
  let headerQty: number | null = null;

  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const nextSeg = segs[si + 1];

    // "2 pcs" on its own completes the previous line's quantity.
    if (seg.qtys.length && !seg.sizes.length && !seg.colours.length && !seg.products.length && !seg.codes.length) {
      const last = lines[lines.length - 1];
      if (last?.warnings.includes("qty assumed 1")) {
        last.qty = Number(seg.qtys[0].value);
        last.warnings = last.warnings.filter((w) => w !== "qty assumed 1");
      }
      continue;
    }

    // "Size M:" heading a list applies to every item below it.
    const sizeOnly = seg.sizes.length === 1 && !seg.qtys.length && !seg.colours.length && !seg.products.length && !seg.codes.length;
    if (sizeOnly && nextSeg && (nextSeg.colours.length || nextSeg.products.length || nextSeg.codes.length)) {
      ctx.size = seg.sizes[0].value as Size;
      ctx.sizeSticky = true;
      continue;
    }

    const segProduct = seg.products[0] ? String(seg.products[0].value) : null;
    if (segProduct || seg.codes.length || !group) {
      if (segProduct && ctx.product && segProduct !== ctx.product) {
        ctx.colour = null;
        if (!ctx.sizeSticky) ctx.size = null;
        ctx.descriptors = [];
        ctx.code = null;
        ctx.price = null;
      }
      if (segProduct) ctx.product = segProduct;
      group = { total: null, lines: [], headerQtyApplied: false };
      groups.push(group);
      headerQty = null;
    }
    if (seg.descriptors.length) ctx.descriptors = segProduct ? seg.descriptors : [...new Set([...ctx.descriptors, ...seg.descriptors])];
    if (seg.codes.length) ctx.code = seg.codes[0];
    if (seg.price !== null) ctx.price = seg.price;

    const product = ctx.product;
    const free = product !== null && FREE_SIZE_PRODUCTS.has(product);
    const colourVals: (string | null)[] = seg.colours.length ? seg.colours.map((c) => String(c.value)) : [ctx.colour];
    const sizeVals: (Size | null)[] = seg.sizes.length ? seg.sizes.map((s) => s.value as Size) : [free ? "FREE" : ctx.size];

    // A sizeless heading followed by sized lines: "Kurti black / M - 2 / L - 3".
    const continues = nextSeg && !nextSeg.products.length && !nextSeg.codes.length && nextSeg.sizes.length > 0;
    if (sizeVals[0] === null && sizeVals.length === 1 && !free && continues) {
      if (seg.colours.length === 1) ctx.colour = String(seg.colours[0].value);
      if (seg.qtys.length === 1) {
        headerQty = Number(seg.qtys[0].value);
        group.total = headerQty;
      }
      continue;
    }

    const multiSize = sizeVals.length > 1;
    const multiColour = colourVals.length > 1;
    const slots = multiSize ? seg.sizes : multiColour ? seg.colours : seg.sizes.length ? seg.sizes : seg.colours;
    const paired = pairQuantities(seg, multiSize && multiColour ? [] : slots);
    if (paired.leftovers.length === 1 && group.total === null) group.total = Number(paired.leftovers[0].value);

    const { text, span } = spanOf(seg, message);
    const inherited: Attr[] = [];
    if (!segProduct && product) inherited.push("product");
    if (!seg.colours.length && ctx.colour) inherited.push("colour");
    if (!seg.sizes.length && !free && ctx.size) inherited.push("size");

    const combos: { colour: string | null; size: Size | null; qty: number | null }[] = [];
    if (multiSize && multiColour) {
      const q = seg.qtys.length === 1 ? Number(seg.qtys[0].value) : null;
      for (const c of colourVals) for (const s of sizeVals) combos.push({ colour: c, size: s, qty: q });
    } else if (multiSize) {
      sizeVals.forEach((s, k) => combos.push({ colour: colourVals[0], size: s, qty: paired.qtys[k] ?? null }));
    } else if (multiColour) {
      colourVals.forEach((c, k) => combos.push({ colour: c, size: sizeVals[0], qty: paired.qtys[k] ?? null }));
    } else {
      combos.push({ colour: colourVals[0], size: sizeVals[0], qty: paired.qtys[0] ?? null });
    }

    for (const combo of combos) {
      const warnings: string[] = [];
      let qty = combo.qty;
      if (qty === null && headerQty !== null) {
        qty = headerQty;
        group.headerQtyApplied = true;
        if (combos.length > 1 || group.lines.length > 0) warnings.push(`assumed ${headerQty} each`);
      }
      if (qty === null) {
        qty = 1;
        warnings.push("qty assumed 1");
      }
      if (paired.assumedEach) warnings.push(`assumed ${qty} each`);
      if (!product && !ctx.code) warnings.push("product missing");
      if (!combo.colour) warnings.push("colour missing");
      if (!combo.size) warnings.push("size missing");
      const line: ParsedLine = {
        product,
        colour: combo.colour,
        size: combo.size,
        qty,
        descriptors: [...ctx.descriptors],
        code: ctx.code,
        priceHint: ctx.price,
        sourceText: text,
        span,
        inherited: [...inherited],
        warnings,
      };
      lines.push(line);
      group.lines.push(line);
    }

    if (seg.colours.length) ctx.colour = String(seg.colours[seg.colours.length - 1].value);
    if (seg.sizes.length === 1) {
      ctx.size = seg.sizes[0].value as Size;
      ctx.sizeSticky = false;
    } else if (seg.sizes.length > 1 && !ctx.sizeSticky) ctx.size = null;
  }

  for (const g of groups) {
    if (g.total === null || g.headerQtyApplied || g.lines.length === 0) continue;
    const sum = g.lines.reduce((acc, l) => acc + l.qty, 0);
    if (sum !== g.total) g.lines[0].warnings.push(`message says ${g.total} in total but lines add up to ${sum}`);
  }

  let due: DueInfo | null = null;
  const dueIdx = tokens.findIndex((t) => t.kind === "due");
  if (dueIdx >= 0) {
    const dueTok = tokens[dueIdx];
    const before = tokens[dueIdx - 1];
    const after = tokens[dueIdx + 1];
    const start = before?.value === "due-connector" ? before.start : dueTok.start;
    const end = after?.value === "due-connector" ? after.end : dueTok.end;
    due = { label: String(dueTok.value), text: message.slice(start, end) };
  }

  const unknownWords = tokens.filter((t) => t.kind === "unknown").map((t) => t.text);
  const urgent = tokens.some((t) => t.kind === "urgent");
  return { lines, tokens, due, urgent, unknownWords, confidence: scoreConfidence(lines, unknownWords) };
}

function scoreConfidence(lines: ParsedLine[], unknown: string[]): ParseResult["confidence"] {
  if (lines.length === 0) return "low";
  if (lines.some((l) => l.warnings.includes("product missing"))) return "low";
  if (unknown.length >= 3) return "low";
  if (unknown.length > 0 || lines.some((l) => l.warnings.length > 0)) return "medium";
  return "high";
}
