// Scores the order reader and the policy retrieval against hand-written test
// sets. Used by the measurements page (live) and by `npm run eval`.

import intakeSet from "../../data/intake-testset.json" with { type: "json" };
import retrievalSet from "../../data/retrieval-testset.json" with { type: "json" };
import type { Ctx } from "./context.ts";
import { catalogue, matchLine } from "./intake/match.ts";
import { parseOrder } from "./intake/parse.ts";
import { searchPolicies } from "./intel/retrieval.ts";

type Expect = { sku?: string; choose?: string[] | "any"; unknown?: boolean; qty: number };
interface Case { id: string; set: string; lang: string; text: string; due?: string; expect: Expect[] }

export interface IntakeResult {
  id: string; set: string; lang: string; text: string; ok: boolean; dueOk: boolean;
  lines: { expected: string; got: string; ok: boolean }[];
}

export interface IntakeSummary {
  cases: number; exact: number; bySet: Record<string, { cases: number; exact: number }>; byLang: Record<string, { cases: number; exact: number }>;
  lines: { expected: number; correct: number; extra: number };
  matched: { expected: number; correct: number };
  asked: { expected: number; correct: number };
  refused: { expected: number; correct: number };
  wrongSku: number;
  results: IntakeResult[];
}

export async function evalIntake(ctx: Ctx): Promise<IntakeSummary> {
  const cat = await catalogue(ctx);
  const cases = (intakeSet as { cases: Case[] }).cases;
  const results: IntakeResult[] = [];
  const s: IntakeSummary = { cases: cases.length, exact: 0, bySet: {}, byLang: {}, lines: { expected: 0, correct: 0, extra: 0 }, matched: { expected: 0, correct: 0 }, asked: { expected: 0, correct: 0 }, refused: { expected: 0, correct: 0 }, wrongSku: 0, results };
  for (const c of cases) {
    const parsed = parseOrder(c.text);
    const got = parsed.lines.map((l) => ({ l, m: matchLine(l, cat) }));
    const used = new Set<number>();
    const lines: IntakeResult["lines"] = [];
    for (const e of c.expect) {
      s.lines.expected++;
      let idx = -1;
      let desc = "";
      if (e.sku) {
        s.matched.expected++;
        idx = got.findIndex((g, i) => !used.has(i) && g.m.status === "matched" && g.m.candidates[0]?.sku === e.sku && g.l.qty === e.qty);
        desc = `${e.qty} × ${e.sku}`;
        if (idx >= 0) s.matched.correct++;
      } else if (e.choose) {
        s.asked.expected++;
        idx = got.findIndex((g, i) => !used.has(i) && g.m.status !== "matched" && g.l.qty === e.qty && (e.choose === "any" || (e.choose as string[]).every((x) => g.m.candidates.some((cd) => cd.sku === x))));
        desc = `${e.qty} × ask: ${e.choose === "any" ? "any variant" : (e.choose as string[]).join(" / ")}`;
        if (idx >= 0) s.asked.correct++;
      } else if (e.unknown) {
        s.refused.expected++;
        idx = got.findIndex((g, i) => !used.has(i) && g.m.status !== "matched" && g.l.qty === e.qty);
        desc = `${e.qty} × not in catalogue (must not match)`;
        if (idx >= 0) s.refused.correct++;
      }
      if (idx >= 0) used.add(idx);
      const g = idx >= 0 ? got[idx] : null;
      lines.push({ expected: desc, got: g ? `${g.l.qty} × ${g.m.status === "matched" ? g.m.candidates[0].sku : g.m.status}` : "—", ok: idx >= 0 });
      if (idx >= 0) s.lines.correct++;
    }
    for (const [i, g] of got.entries()) {
      if (used.has(i)) continue;
      s.lines.extra++;
      if (g.m.status === "matched") s.wrongSku++;
      lines.push({ expected: "(nothing)", got: `${g.l.qty} × ${g.m.status === "matched" ? g.m.candidates[0].sku : g.m.status}`, ok: false });
    }
    const dueOk = (parsed.due?.label ?? undefined) === c.due;
    const ok = lines.every((l) => l.ok) && dueOk;
    if (ok) s.exact++;
    for (const [k, key] of [["bySet", c.set], ["byLang", c.lang]] as const) {
      const b = (s[k][key] ??= { cases: 0, exact: 0 });
      b.cases++;
      if (ok) b.exact++;
    }
    results.push({ id: c.id, set: c.set, lang: c.lang, text: c.text, ok, dueOk, lines });
  }
  return s;
}

export async function evalRetrieval(ctx: Ctx) {
  const cases = (retrievalSet as { cases: { q: string; title: string; heading: string }[] }).cases;
  const results = [];
  let top1 = 0;
  let top3 = 0;
  for (const c of cases) {
    const hits = await searchPolicies(ctx, c.q, 3);
    const rank = hits.findIndex((h) => h.title === c.title && h.heading === c.heading);
    if (rank === 0) top1++;
    if (rank >= 0) top3++;
    results.push({ q: c.q, expected: `${c.title} › ${c.heading}`, got: hits[0] ? `${hits[0].title} › ${hits[0].heading}` : "nothing", rank });
  }
  return { cases: cases.length, top1, top3, results };
}
