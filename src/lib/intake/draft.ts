// Turns a message, transcript or document into a draft order for the
// confirmation screen. Nothing is written: stock only moves when a person
// confirms the draft.

import type Anthropic from "@anthropic-ai/sdk";
import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";
import { dueFromLabel } from "../ops/orders.ts";
import { readWithClaude } from "./claude.ts";
import { catalogue, matchLine, type LineMatch } from "./match.ts";
import { parseOrder, type ParsedLine, type ParseResult } from "./parse.ts";

export interface DraftLine extends ParsedLine {
  key: string;
  match: LineMatch;
}

export interface Draft {
  text: string;
  channel: "message" | "voice" | "document";
  extractedBy: "rules" | "claude";
  lines: DraftLine[];
  due: { label: string; text: string; at: string | null } | null;
  urgent: boolean;
  ignored: string[];
  confidence: "high" | "medium" | "low";
  customerGuess: { id: number; name: string } | null;
}

async function build(ctx: Ctx, text: string, channel: Draft["channel"], parsed: ParseResult, by: Draft["extractedBy"], hints: (string | null)[] = []): Promise<Draft> {
  const cat = await catalogue(ctx);
  const lines = parsed.lines.map((l, i) => ({ ...l, key: `${i}`, match: matchLine(l, cat, { productCode: hints[i] ?? null }) }));
  const confidence = !lines.length || lines.some((l) => l.match.status === "unmatched" || l.qty === null)
    ? "low"
    : lines.some((l) => l.match.status === "needs-choice" || l.warnings.length)
      ? "medium"
      : "high";
  const customers = await q<{ id: number; name: string }>(`SELECT id, name FROM customers WHERE business_id = $1`, ctx.businessId);
  const lower = text.toLowerCase();
  const guess = customers.find((c) => c.name.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && lower.includes(w))) ?? null;
  const at = parsed.due ? dueFromLabel(parsed.due.label, ctx.now ?? new Date()) : null;
  return {
    text, channel, extractedBy: by, lines, urgent: parsed.urgent, ignored: parsed.ignored, confidence, customerGuess: guess,
    due: parsed.due ? { ...parsed.due, at: at?.toISOString() ?? null } : null,
  };
}

export async function draftWithRules(ctx: Ctx, text: string, channel: Draft["channel"] = "message") {
  return build(ctx, text, channel, parseOrder(text), "rules");
}

export async function draftWithClaude(ctx: Ctx, input: { text?: string; file?: { mediaType: string; base64: string; name: string } }, channel: Draft["channel"]) {
  const products = await q<{ code: string; name: string; category: string; colours: string[] }>(
    `SELECT p.code, p.name, p.category, array_agg(DISTINCT v.colour) AS colours FROM products p JOIN product_variants v ON v.product_id = p.id
      WHERE p.business_id = $1 GROUP BY p.id ORDER BY p.code`,
    ctx.businessId,
  );
  let content: string | Anthropic.Beta.BetaContentBlockParam[];
  if (input.file) {
    const block: Anthropic.Beta.BetaContentBlockParam = input.file.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.file.base64 } }
      : { type: "image", source: { type: "base64", media_type: input.file.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: input.file.base64 } };
    content = [block, { type: "text", text: input.text?.trim() ? `Note from staff: ${input.text}` : "Read the order in this file." }];
  } else {
    content = `<order>\n${input.text ?? ""}\n</order>`;
  }
  const parsed = await readWithClaude(content, { products });
  return build(ctx, input.text || `[${input.file?.name ?? "document"}]`, channel, parsed, "claude", parsed.hints);
}
