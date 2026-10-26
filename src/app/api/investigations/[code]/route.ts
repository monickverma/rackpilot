// GET: one case with findings, evidence, checks and history.
// POST: a case action (assign, status, note, check, correction, resolve, close, explain).

import * as z from "zod/v4";
import { body, handle, HttpError } from "@/lib/api";
import { addNote, applyCorrection, assign, closeCase, getCase, resolveCase, setStatus, toggleCheck } from "@/lib/investigate/cases";
import { explainCase } from "@/lib/investigate/explain";

export const GET = handle(async (_req, s, p: { code: string }) => {
  const c = await getCase(s, p.code);
  if (!c) throw new HttpError(404, "Investigation not found.");
  return c;
}, { write: false });

const OUTCOMES = ["record_corrected", "goods_located", "adjustment_approved", "counting_error", "false_positive", "legitimate_partial_fulfilment", "awaiting_external_confirmation"] as const;
const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), userId: z.coerce.number().int().nullable() }),
  z.object({ action: z.literal("status"), status: z.enum(["detected", "investigating", "action_required"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("note"), body: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("check"), checkId: z.coerce.number().int(), done: z.boolean() }),
  z.object({ action: z.literal("correction"), correctionId: z.string().max(80), input: z.record(z.string(), z.string()).default({}) }),
  z.object({ action: z.literal("resolve"), outcome: z.enum(OUTCOMES), note: z.string().min(1, "Record what was verified.").max(2000) }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("explain"), useClaude: z.boolean().default(true) }),
]);

export const POST = handle(async (req, s, p: { code: string }) => {
  const a = await body(req, Action);
  switch (a.action) {
    case "assign": return assign(s, p.code, a.userId);
    case "status": return setStatus(s, p.code, a.status, a.note);
    case "note": return addNote(s, p.code, a.body);
    case "check": return toggleCheck(s, p.code, a.checkId, a.done);
    case "correction": return applyCorrection(s, p.code, a.correctionId, a.input);
    case "resolve": return resolveCase(s, p.code, a.outcome, a.note);
    case "close": return closeCase(s, p.code);
    case "explain": return explainCase(s, p.code, { useClaude: a.useClaude });
  }
});
