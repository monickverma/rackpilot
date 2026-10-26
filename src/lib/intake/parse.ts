// The rule-based order reader. It turns a message such as
//   "Bhai, 2 black oversized tees size L, 1 white tee size M. Need everything by tomorrow."
// into lines of quantity, colour, size and product words, plus a due date.
// It never decides the product: the matcher does that against the catalogue,
// and asks when it isn't sure. Works without an API key.

import { COLOURS, DUE_WORDS, EACH_WORDS, FILLER, NUMBER_WORDS, SIZE_WORDS, URGENT_WORDS, WEEKDAYS, WEEKDAY_SHORT } from "./lexicon.ts";

export interface ParsedLine {
  qty: number | null;
  colour: string | null;
  size: string | null;
  words: string[];
  sourceText: string;
  inherited: ("product" | "colour")[];
  warnings: string[];
}

export interface ParseResult {
  lines: ParsedLine[];
  due: { label: string; text: string } | null;
  urgent: boolean;
  ignored: string[];
}

type Tok = { kind: "num" | "size" | "colour" | "word" | "each" | "sep"; text: string; value?: string | number; pos: number };

const COLOUR_INDEX: [string, string][] = Object.entries(COLOURS).flatMap(([c, ws]) => ws.map((w) => [w, c] as [string, string])).sort((a, b) => b[0].length - a[0].length);

function normalise(message: string) {
  return message
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\bt[\s-]?shirts?\b/g, "tshirt")
    .replace(/\btees\b/g, "tee")
    .replace(/(\d+)\s*(?:pcs?|pieces?|nos?)\b/g, "$1")
    .replace(/\bx\s*(\d+)\b/g, " $1 ")
    .replace(/\b(\d+)\s*x\b/g, " $1 ")
    .replace(/\b(\d+)-(\d+)\b(?!\s*(?:each))/g, (m, a, b) => (a === b ? `${a} each` : m))
    .replace(/\b(xxl|xl|[sml]|2xl)\s*[-:=]\s*(\d+)/g, "$1 $2")
    .replace(/\b(\d+)\s*[-:=]\s*(xxl|xl|[sml]|2xl)\b/g, "$1 $2");
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /\n|[,;/.+&]|\b(?:aur|and|also|then|phir)\b|[a-z0-9'-]+/g;
  let m: RegExpExecArray | null;
  const raw: { t: string; pos: number }[] = [];
  while ((m = re.exec(text))) raw.push({ t: m[0], pos: m.index });
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].t;
    const pos = raw[i].pos;
    if (/^[-']+$/.test(t)) continue;
    if (/^(\n|[,;/.+&]|aur|and|also|then|phir)$/.test(t)) {
      out.push({ kind: "sep", text: t, pos });
      continue;
    }
    // Multi-word colours first ("sky blue", "off white").
    const two = i + 1 < raw.length ? `${t} ${raw[i + 1].t}` : "";
    const c2 = COLOUR_INDEX.find(([w]) => w.includes(" ") && w === two);
    if (c2) {
      out.push({ kind: "colour", text: two, value: c2[1], pos });
      i++;
      continue;
    }
    const c1 = COLOUR_INDEX.find(([w]) => w === t);
    if (c1) {
      out.push({ kind: "colour", text: t, value: c1[1], pos });
      continue;
    }
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      // 28-36 next to a waist context reads as a size; the matcher sorts out which.
      if (SIZE_WORDS[t] && (/(?:waist|size)$/.test(raw[i - 1]?.t ?? "") || isSizeContext(raw, i))) out.push({ kind: "size", text: t, value: SIZE_WORDS[t], pos });
      else out.push({ kind: "num", text: t, value: n, pos });
      continue;
    }
    if (SIZE_WORDS[t] && !(t === "m" && raw[i + 1]?.t === "e")) {
      out.push({ kind: "size", text: t, value: SIZE_WORDS[t], pos });
      continue;
    }
    if (EACH_WORDS.has(t)) {
      out.push({ kind: "each", text: t, pos });
      continue;
    }
    if (t in NUMBER_WORDS && !(t === "do" && !isItemAhead(raw, i))) {
      out.push({ kind: "num", text: t, value: NUMBER_WORDS[t], pos });
      continue;
    }
    out.push({ kind: "word", text: t, pos });
  }
  return out;
}

/** "28" is a waist size when it sits between other sizes or follows a quantity that already has its item. */
function isSizeContext(raw: { t: string }[], i: number) {
  const prev = raw[i - 1]?.t ?? "";
  const next = raw[i + 1]?.t ?? "";
  const sizeLike = (s: string) => /^(2[89]|3[0-6])$/.test(s) || /^(jeans?|chinos?|shorts|trousers?|pants?|waist)$/.test(s);
  return /^(2[89]|3[0-6])$/.test(raw[i].t) && (sizeLike(prev) || sizeLike(next) || /^(jeans?|chinos?|shorts|trousers?)$/.test(raw[i - 2]?.t ?? ""));
}

/** Hinglish "do" is the number two only when an item follows ("do black tee"), not "bhej do". */
function isItemAhead(raw: { t: string }[], i: number) {
  const next = raw[i + 1]?.t;
  if (!next) return false;
  return !FILLER.has(next) && !/^(\n|[,;/.+&])$/.test(next);
}

function due(tokens: Tok[], text: string): { label: string; text: string } | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].text;
    if (DUE_WORDS[t]) return { label: DUE_WORDS[t], text: t };
    const day = WEEKDAYS.includes(t) ? t : WEEKDAY_SHORT[t];
    if (day) return { label: day, text: t };
  }
  if (/\b(?:is|iss)\s+(?:hafte|hafta|week)\b|\bthis week\b/.test(text)) return { label: "this-week", text: "this week" };
  return null;
}

export function parseOrder(message: string): ParseResult {
  const text = normalise(message);
  const tokens = tokenize(text);
  const dueInfo = due(tokens, text);
  const urgent = tokens.some((t) => URGENT_WORDS.has(t.text));
  const dropped = new Set<string>([...(dueInfo ? [dueInfo.text] : []), ...URGENT_WORDS, ...Object.keys(DUE_WORDS), ...WEEKDAYS, ...Object.keys(WEEKDAY_SHORT)]);
  const ignored: string[] = [];

  // Group tokens into items. A separator closes the item only once it has a quantity,
  // so "M, L, XL - 10 each" stays one item.
  type Group = { toks: Tok[]; start: number; end: number };
  const groups: Group[] = [];
  let cur: Group = { toks: [], start: 0, end: 0 };
  const close = () => {
    if (cur.toks.some((t) => t.kind !== "sep")) groups.push(cur);
    cur = { toks: [], start: 0, end: 0 };
  };
  const hasItem = (g: Group) => g.toks.some((t) => t.kind === "word" || t.kind === "colour" || t.kind === "size");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "word" && (FILLER.has(t.text) || dropped.has(t.text))) {
      if (!dropped.has(t.text) && !FILLER.has(t.text)) ignored.push(t.text);
      continue;
    }
    if (t.kind === "sep") {
      if (cur.toks.some((x) => x.kind === "num") && hasItem(cur)) close();
      continue;
    }
    // A new quantity after a complete item ("2 black tee L 1 white tee M") starts the next item,
    // unless it pairs with a size right before it ("M 10 L 15").
    if (t.kind === "num" && cur.toks.some((x) => x.kind === "num") && hasItem(cur)) {
      const prev = cur.toks[cur.toks.length - 1];
      const pairing = prev.kind === "size" && cur.toks.filter((x) => x.kind === "size").length > 1;
      const sizeNumPattern = cur.toks.filter((x) => x.kind === "num").length === cur.toks.filter((x) => x.kind === "size").length && prev.kind === "size";
      if (!pairing && !sizeNumPattern) close();
    }
    if (!cur.toks.length) cur.start = t.pos;
    cur.toks.push(t);
    cur.end = t.pos + t.text.length;
  }
  close();

  const lines: ParsedLine[] = [];
  let prev = null as { words: string[]; colour: string | null } | null;
  for (const g of groups) {
    const nums = g.toks.filter((t) => t.kind === "num").map((t) => t.value as number);
    const sizes = g.toks.filter((t) => t.kind === "size").map((t) => t.value as string);
    const colours = g.toks.filter((t) => t.kind === "colour").map((t) => t.value as string);
    const words = g.toks.filter((t) => t.kind === "word").map((t) => t.text).filter((w) => !/^\d+$/.test(w));
    const each = g.toks.some((t) => t.kind === "each");
    const source = text.slice(g.start, g.end).trim() || g.toks.map((t) => t.text).join(" ");
    const inherited: ParsedLine["inherited"] = [];
    let productWords = words;
    if (!productWords.length && prev) {
      productWords = prev.words;
      inherited.push("product");
    }
    let colour = colours[0] ?? null;
    if (!colour && inherited.includes("product") && prev?.colour) {
      colour = prev.colour;
      inherited.push("colour");
    }
    const warnings: string[] = [];
    if (colours.length > 1) warnings.push(`several colours (${colours.join(", ")}); check the split`);
    // Pair sizes with quantities.
    let pairs: { qty: number | null; size: string | null }[];
    const order = g.toks.filter((t) => t.kind === "num" || t.kind === "size");
    const alternating = sizes.length > 1 && nums.length === sizes.length && order.every((t, i) => (i % 2 === 0 ? t.kind === order[0].kind : t.kind !== order[0].kind));
    if (alternating) {
      pairs = [];
      for (let i = 0; i < order.length; i += 2) {
        const a = order[i];
        const b = order[i + 1];
        pairs.push(a.kind === "size" ? { size: a.value as string, qty: b.value as number } : { size: b.value as string, qty: a.value as number });
      }
    } else if (sizes.length > 1 && nums.length === 1) {
      pairs = sizes.map((s) => ({ size: s, qty: nums[0] }));
      if (!each) warnings.push(`${nums[0]} read as the quantity for each size`);
    } else if (!sizes.length && nums.length === 2 && prev && lines.length && /^\d+$/.test(lines[lines.length - 1].size ?? "") && nums.some((n) => SIZE_WORDS[String(n)])) {
      // "15 khaki chinos 32 aur 10 34": after a waist size, "10 34" is a quantity and a waist.
      const waist = nums.find((n) => SIZE_WORDS[String(n)])!;
      pairs = [{ size: SIZE_WORDS[String(waist)], qty: nums.find((n) => n !== waist) ?? waist }];
    } else if (sizes.length > 1 && nums.length === sizes.length) {
      pairs = sizes.map((s, i) => ({ size: s, qty: nums[i] }));
    } else {
      pairs = [{ size: sizes[0] ?? null, qty: nums.length ? nums.reduce((a, b) => (b > a ? b : a), nums[0]) : null }];
      if (nums.length > 1) warnings.push(`several numbers (${nums.join(", ")}); took ${pairs[0].qty}`);
      if (sizes.length > 1) warnings.push(`several sizes (${sizes.join(", ")}) and quantities don't line up`);
    }
    for (const p of pairs) {
      const w = [...warnings];
      if (p.qty === null) w.push("quantity missing");
      if (!p.size) w.push("size missing");
      if (!colour) w.push("colour missing");
      if (!productWords.length) w.push("product missing");
      lines.push({ qty: p.qty, colour, size: p.size, words: productWords, sourceText: source, inherited, warnings: w });
    }
    if (words.length) prev = { words, colour: colours[0] ?? colour };
    else if (prev && colours[0]) prev = { words: prev.words, colour: colours[0] };
  }
  return { lines, due: dueInfo, urgent, ignored };
}
