// "Why is ORD-1042 flagged?" The answer is built from the records the case
// already holds. Without Claude it is assembled from the findings; with Claude
// it is reworded, then checked so that every number and record code in the
// wording comes from those records. Either way it is stored on the case.

import * as z from "zod/v4";
import { one, q } from "../../db/client.ts";
import { nowOf, type Ctx } from "../context.ts";
import { claudeConfigured, ClaudeError, structured } from "../ai/claude.ts";
import { checkGrounding } from "../ai/grounding.ts";
import { getCase, type CaseView } from "./cases.ts";
import { event } from "./engine.ts";
import { RULES } from "./types.ts";

export interface Explanation {
  caseCode: string;
  text: string;
  by: "rules" | "claude";
  cited: string[];
  note?: string;
}

/** Finds the case behind a question about an order, payment, SKU or case code. */
export async function caseFor(ctx: Ctx, ref: string): Promise<string | null> {
  const code = ref.trim().toUpperCase();
  if (/^(OT|SS)-\d+$/.test(code)) return code;
  const row = await one<{ code: string }>(
    `SELECT i.code FROM investigations i
       LEFT JOIN orders o ON i.case_key = 'order:' || o.id
       LEFT JOIN payments p ON i.case_key = 'payment:' || p.id
      WHERE i.business_id = $1 AND (o.code = $2 OR p.code = $2 OR i.subject_code LIKE $2 || ' @%')
      ORDER BY i.status IN ('resolved', 'closed'), i.detected_at DESC LIMIT 1`,
    ctx.businessId, code,
  );
  return row?.code ?? null;
}

/** Lower-cases a sentence start, but not a record code or acronym ("INV-2058", "SKU"). */
const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function deterministicExplanation(c: CaseView): string {
  const facts = c.findings.filter((f) => f.kind === "fact" && f.status !== "dismissed");
  const lead = facts.find((f) => f.status === "open") ?? facts[0];
  const inferences = c.findings.filter((f) => f.kind === "inference");
  const hypotheses = c.findings.filter((f) => f.kind === "hypothesis");
  // Paragraphs: what was flagged, what else is established, what it might mean, what to do.
  const paras: string[][] = [[], [], [], []];
  if (lead) {
    paras[0].push(`${c.subjectCode} is flagged by the ${RULES[lead.rule]?.name.toLowerCase() ?? lead.rule} rule (${lead.rule}): ${lc(lead.title)}. ${lead.detail}`);
    if (lead.calculation) paras[0].push(`Calculation: ${lead.calculation}.`);
  }
  const others = facts.filter((f) => f !== lead);
  if (others.length) paras[1].push(`Also established from the records: ${others.map((f) => lc(f.title)).join("; ")}.`);
  if (lead?.exceptions.length) paras[1].push(`Exceptions checked: ${lead.exceptions.join("; ")}.`);
  if (inferences.length) paras[2].push(`Inference: ${inferences.map((f) => f.title).join("; ")}.`);
  if (hypotheses.length) paras[2].push(`Not verified, possible explanations: ${hypotheses.map((f) => lc(f.title)).join("; ")}.`);
  const next = c.checks.find((x) => !x.doneAt);
  if (next) paras[3].push(`Next: ${next.text}.`);
  if (c.status === "resolved" || c.status === "closed") paras[3].push(`Resolved as ${c.outcome?.replaceAll("_", " ")}: ${c.resolutionNote}`);
  return paras.filter((p) => p.length).map((p) => p.join(" ")).join("\n\n");
}

const Reply = z.object({
  explanation: z.string().describe("3 to 6 sentences in plain English."),
  cited_records: z.array(z.string()).describe("Record codes the explanation relies on, e.g. INV-2058."),
});

const SYSTEM = `You explain discrepancy investigations to the staff of a small clothing wholesaler.

You get one case as JSON: the findings (facts, inferences and hypotheses), the timeline of source records and the suggested checks. Write a short explanation of why the case was flagged.

Rules:
- Use only numbers, record codes and names that appear in the JSON. Do not calculate new figures.
- Keep the categories distinct: say what the records establish (facts), what that suggests (inferences), and what is only possible (hypotheses).
- Never say or imply theft, fault or intent. A mismatch is not proof of its cause.
- End with the next check to do.
- Mention record codes as they appear, e.g. INV-2058, SHP-501.`;

export async function explainCase(ctx: Ctx, ref: string, opts: { useClaude?: boolean } = {}): Promise<Explanation | null> {
  const code = await caseFor(ctx, ref);
  const c = code ? await getCase(ctx, code) : null;
  if (!c) return null;
  const fallback = deterministicExplanation(c);
  const source = {
    case: { code: c.code, title: c.title, status: c.status, outcome: c.outcome, subject: c.subjectCode, module: c.module },
    findings: c.findings.map((f) => ({ kind: f.kind, certainty: f.certainty, module: f.module, rule: f.rule, title: f.title, detail: f.detail, expected: f.expected, actual: f.actual, unit: f.unit, calculation: f.calculation, exceptions: f.exceptions, status: f.status })),
    timeline: c.timeline.map((t) => ({ at: t.at.toISOString(), record: t.code, label: t.label, detail: t.detail })),
    checks: c.checks.map((x) => ({ text: x.text, done: Boolean(x.doneAt) })),
  };
  let result: Explanation = { caseCode: c.code, text: fallback, by: "rules", cited: [...new Set(c.timeline.map((t) => t.code))].slice(0, 8) };
  if ((opts.useClaude ?? true) && claudeConfigured()) {
    try {
      const reply = await structured(Reply, { system: SYSTEM, content: JSON.stringify(source), effort: "low", maxTokens: 4000 });
      const check = checkGrounding(reply.explanation, source);
      if (check.ok) result = { caseCode: c.code, text: reply.explanation, by: "claude", cited: reply.cited_records.filter((r) => JSON.stringify(source).includes(r)) };
      else result.note = `Claude's wording mentioned ${[...check.unsupportedNumbers, ...check.unknownCodes].slice(0, 4).join(", ")}, which the records don't contain, so the rule-based explanation is shown.`;
    } catch (e) {
      result.note = e instanceof ClaudeError ? `${e.message} Showing the rule-based explanation.` : "Showing the rule-based explanation.";
    }
  }
  await event(c.id, ctx.user.id, null, "explanation", result.text, { by: result.by, note: result.note ?? null }, nowOf(ctx));
  return result;
}

/** The most recent stored explanation, if any. */
export async function lastExplanation(investigationId: number) {
  const rows = await q<{ body: string; data: { by?: string; note?: string | null }; at: Date }>(
    `SELECT body, data, created_at AS at FROM investigation_events WHERE investigation_id = $1 AND type = 'explanation' ORDER BY created_at DESC LIMIT 1`,
    investigationId,
  );
  return rows[0] ?? null;
}
