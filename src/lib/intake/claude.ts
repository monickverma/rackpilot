// Claude reading an order: pasted text, a voice-note transcript, or a photo
// or PDF of an order sheet. It sees the message and the catalogue's product
// names and colours, never stock, prices or customers, and returns lines in a
// fixed schema. The same deterministic matcher then decides the variant, so a
// product Claude can't place stays unmatched instead of becoming a made-up SKU.

import * as z from "zod/v4";
import { structured, type Content } from "../ai/claude.ts";
import type { ParsedLine, ParseResult } from "./parse.ts";

const DUE = ["today", "tomorrow", "day-after", "this-week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const SIZES = ["S", "M", "L", "XL", "XXL", "28", "30", "32", "34", "36"] as const;

export interface CatalogueHint {
  products: { code: string; name: string; category: string; colours: string[] }[];
}

function schema(hint: CatalogueHint) {
  const codes = hint.products.map((p) => p.code) as [string, ...string[]];
  const colours = [...new Set(hint.products.flatMap((p) => p.colours))] as [string, ...string[]];
  return z.object({
    lines: z.array(z.object({
      source_text: z.string().describe("The exact words of the message (or document line) this item comes from."),
      qty: z.number().int().min(1).max(5000).nullable().describe("Pieces. Null if the customer gave no quantity."),
      product_code: z.enum(codes).nullable().describe("Only when the words clearly identify exactly one product; otherwise null."),
      product_words: z.array(z.string()).describe("The customer's own words for the product, lower case."),
      colour: z.enum(colours).nullable(),
      size: z.enum(SIZES).nullable(),
    })).max(60),
    due: z.enum(DUE).nullable(),
    urgent: z.boolean(),
    unclear: z.array(z.string()).describe("Words you could not map to the allowed values."),
  });
}

const system = (hint: CatalogueHint) => `You read incoming orders for a clothing wholesaler in India. Orders come as WhatsApp messages, voice-note transcripts, or photos and PDFs of order sheets, often mixing Hindi and English.

Turn the order into lines, one per product, colour and size:
- "M L XL 10 each" is three lines of 10. "M-12 L-15" is two lines.
- A line that leaves out the product or colour takes it from the line before only when the message clearly means the same item.
- Set product_code only when the words identify exactly one product below. If two products could fit (for example "tee" when there is a crew tee and an oversized tee), leave it null and put the words in product_words. Never pick one to be helpful.
- Use only the listed colours and sizes. Anything else goes to unclear, with the field null.
- kal means tomorrow, parso the day after. jaldi, urgent or asap mean urgent.
- Greetings and chit-chat are not items. Never add items the customer did not ask for.

Products:
${hint.products.map((p) => `${p.code}: ${p.name} (${p.category}); colours ${p.colours.join(", ")}`).join("\n")}`;

export async function readWithClaude(content: Content, hint: CatalogueHint): Promise<ParseResult & { hints: (string | null)[] }> {
  const out = await structured(schema(hint), { system: system(hint), content, effort: "low" });
  const lines: ParsedLine[] = out.lines.map((l) => {
    const warnings = [l.qty === null && "quantity missing", !l.colour && "colour missing", !l.size && "size missing", !l.product_code && !l.product_words.length && "product missing"].filter((w): w is string => Boolean(w));
    return { qty: l.qty, colour: l.colour, size: l.size, words: l.product_words.map((w) => w.toLowerCase()), sourceText: l.source_text, inherited: [], warnings };
  });
  return { lines, due: out.due ? { label: out.due, text: out.due } : null, urgent: out.urgent, ignored: out.unclear, hints: out.lines.map((l) => l.product_code) };
}
