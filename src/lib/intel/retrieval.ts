// Retrieval over supplier terms and house policies, using Postgres full-text
// search (tsvector + ts_rank). Questions about stock, sales or orders never
// come here; they go to the database through the query templates.

import { q } from "../../db/client.ts";
import type { Ctx } from "../context.ts";

export interface Passage {
  documentId: number;
  title: string;
  supplier: string | null;
  heading: string;
  body: string;
  rank: number;
}

const STOP = new Set(["what", "whats", "is", "the", "a", "an", "of", "for", "to", "do", "does", "how", "much", "many", "our", "we", "i", "can", "with", "on", "in", "and", "or", "if", "are", "their", "they", "me", "tell", "about", "policy"]);

/** A small trade thesaurus: how people ask versus how the terms are written. */
const SYNONYMS: Record<string, string[]> = {
  deliver: ["lead"], delivery: ["lead"], long: ["lead"], discount: ["off", "price"], cheaper: ["off", "price"], moq: ["minimum"],
  pay: ["payment"], refund: ["return", "credit"], approve: ["approve"], book: ["lead"], late: ["lead", "payment"],
};

export async function searchPolicies(ctx: Ctx, question: string, limit = 3): Promise<Passage[]> {
  const base = question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const words = [...new Set([...base, ...base.flatMap((w) => SYNONYMS[w] ?? [])])];
  if (!words.length) return [];
  const suppliers = await q<{ id: number; name: string }>(`SELECT id, name FROM suppliers WHERE business_id = $1`, ctx.businessId);
  const named = suppliers.find((s) => s.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && words.includes(w.replace(/[^a-z]/g, ""))));
  const query = words.filter((w) => !named || !named.name.toLowerCase().includes(w)).join(" | ") || words.join(" | ");
  return q<Passage>(
    `SELECT d.id AS "documentId", d.title, s.name AS supplier, c.heading, c.body,
            ts_rank_cd(c.tsv, to_tsquery('english', $2)) + CASE WHEN $3::int IS NOT NULL AND d.supplier_id = $3 THEN 1 ELSE 0 END AS rank
       FROM document_chunks c JOIN documents d ON d.id = c.document_id LEFT JOIN suppliers s ON s.id = d.supplier_id
      WHERE c.business_id = $1 AND c.tsv @@ to_tsquery('english', $2) AND ($3::int IS NULL OR d.supplier_id = $3 OR d.supplier_id IS NULL)
      ORDER BY rank DESC LIMIT $4`,
    ctx.businessId, query, named?.id ?? null, limit,
  );
}
