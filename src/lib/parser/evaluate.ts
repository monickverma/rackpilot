// Scores the parser against the labelled test set. Shared by the CLI script and
// the /parser page so both always report the same numbers.

import type { ParseResult } from "./types.ts";

export interface ExpectedLine {
  product: string | null;
  colour: string | null;
  size: string | null;
  qty: number;
}

export interface TestCase {
  id: string;
  split: "dev" | "holdout";
  lang: "english" | "hinglish";
  message: string;
  expected: { due: string | null; lines: ExpectedLine[] };
}

export interface CaseResult {
  id: string;
  split: TestCase["split"];
  lang: TestCase["lang"];
  message: string;
  pass: boolean;
  duePass: boolean;
  expected: TestCase["expected"];
  got: { due: string | null; lines: ExpectedLine[] };
  missing: string[];
  extra: string[];
}

export interface Tally {
  total: number;
  passed: number;
}

export interface EvalSummary {
  cases: Tally;
  dev: Tally;
  holdout: Tally;
  english: Tally;
  hinglish: Tally;
  lines: { expected: number; predicted: number; correct: number };
  due: Tally;
}

export const lineKey = (l: ExpectedLine) => [l.product ?? "?", l.colour ?? "?", l.size ?? "?", l.qty].join(" | ");

function multisetDiff(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const x of a) {
    const k = rest.indexOf(x);
    if (k >= 0) rest.splice(k, 1);
    else out.push(x);
  }
  return out;
}

export function evaluate(cases: TestCase[], parse: (message: string) => ParseResult): { results: CaseResult[]; summary: EvalSummary } {
  const tally = (): Tally => ({ total: 0, passed: 0 });
  const summary: EvalSummary = {
    cases: tally(), dev: tally(), holdout: tally(), english: tally(), hinglish: tally(),
    lines: { expected: 0, predicted: 0, correct: 0 },
    due: tally(),
  };
  const results = cases.map((c): CaseResult => {
    const parsed = parse(c.message);
    const gotLines = parsed.lines.map((l) => ({ product: l.product, colour: l.colour, size: l.size, qty: l.qty }));
    const want = c.expected.lines.map(lineKey);
    const got = gotLines.map(lineKey);
    const missing = multisetDiff(want, got);
    const extra = multisetDiff(got, want);
    const gotDue = parsed.due?.label ?? null;
    const duePass = gotDue === c.expected.due;
    const pass = missing.length === 0 && extra.length === 0 && duePass;

    for (const t of [summary.cases, summary[c.split], summary[c.lang]]) {
      t.total++;
      if (pass) t.passed++;
    }
    summary.lines.expected += want.length;
    summary.lines.predicted += got.length;
    summary.lines.correct += want.length - missing.length;
    if (c.expected.due !== null || gotDue !== null) {
      summary.due.total++;
      if (duePass) summary.due.passed++;
    }
    return { id: c.id, split: c.split, lang: c.lang, message: c.message, pass, duePass, expected: c.expected, got: { due: gotDue, lines: gotLines }, missing, extra };
  });
  return { results, summary };
}

export const pct = (t: Tally) => (t.total ? Math.round((100 * t.passed) / t.total) : 0);
