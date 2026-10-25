// Optional fallback reader for messages the rules can't follow. Claude sees only
// the message text (no stock, prices or customer details) and returns order
// lines in a fixed schema. Those lines then go through the same matching and
// reservation code as the rule parser's, so stock is never Claude's call.
// Server only: the API key comes from ANTHROPIC_API_KEY in .env.local.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { COLOURS, FREE_SIZE_PRODUCTS, PRODUCTS } from "./parser/lexicon.ts";
import type { ParsedLine, ParseResult } from "./parser/types.ts";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

const SIZES = ["S", "M", "L", "XL", "XXL", "XXXL", "FREE"] as const;
const DUE = ["today", "tomorrow", "day-after", "this-week", "next-week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "diwali"] as const;
const oneOf = (values: string[]) => z.enum(values as [string, ...string[]]);

const OrderSchema = z.object({
  lines: z
    .array(
      z.object({
        source_text: z.string().describe("The exact words of the message this line comes from."),
        qty: z.number().int().min(1).max(500),
        product: oneOf(Object.keys(PRODUCTS)).nullable(),
        colour: oneOf(Object.keys(COLOURS)).nullable(),
        size: z.enum(SIZES).nullable(),
        design_words: z.array(z.string()).describe("Fabric or style words that pick out a product, such as chikankari, a-line, rayon or mirror work."),
        product_code: z.string().nullable().describe("A design code like K101, only when the customer wrote one."),
      }),
    )
    .max(50),
  due: z.enum(DUE).nullable(),
  due_day_of_month: z.number().int().min(1).max(31).nullable().describe('For a date such as "28 tak"; otherwise null.'),
  urgent: z.boolean(),
  unclear: z.array(z.string()).describe("Words from the message that you could not map to the allowed values."),
});

const synonyms = (map: Record<string, string[]>) =>
  Object.entries(map).map(([key, words]) => `${key}: ${words.slice(0, 6).join(", ")}`).join("\n");

const SYSTEM = `You read WhatsApp orders sent to a small clothing shop in India. Customers mix Hindi and English, misspell words, and use Hindi numbers and colours (ek, do, teen; kaala, safed, laal).

Turn the message into order lines:
- One line per item. When one quantity covers several sizes or colours ("2-2 M aur L"), write a line for each.
- A line that leaves out the product or colour takes it from the line before only when the message clearly means the same item.
- qty is the number of pieces. Use 1 when the customer gives no number.
- Use only the allowed values for product, colour, size and due. If the customer asks for something outside them, set that field to null and add their word to unclear. Don't swap in a similar colour.
- Free size, and every saree and dupatta, is FREE. Chest sizes 36, 38, 40, 42 and 44 are S, M, L, XL and XXL.
- source_text is the exact part of the message the line comes from.
- design_words are fabric or style words that narrow the product: chikankari, a-line, rayon, cotton, anarkali, mirror work, banarasi and the like.
- due: kal means tomorrow and parso means day-after. Use a weekday name, diwali, or due_day_of_month for a date like "28 tak". Leave it null when no date is given.
- urgent is true for words such as urgent, jaldi or asap.
- Never add items the customer didn't ask for. Greetings and chit-chat are not items.

Products and words customers use for them:
${synonyms(PRODUCTS)}

Colours and words customers use for them:
${synonyms(COLOURS)}`;

/** Raised with a message that can be shown to the shopkeeper as is. */
export class ClaudeReadError extends Error {}

/** The fallback is offered only when a key is configured. */
export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client: Anthropic | undefined;

const FORMAT = betaZodOutputFormat(OrderSchema);
const NOT_AN_ORDER = "Claude's answer wasn't in the order format. Read it by hand.";

export async function parseWithClaude(message: string): Promise<ParseResult> {
  let response;
  try {
    // A shopkeeper is waiting on this, so fail fast rather than retry for minutes.
    client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 });
    // Same request as the SDK's messages.parse(), which sends the structured-outputs
    // beta too; create() lets us check stop_reason before parsing.
    response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "low", format: FORMAT },
      messages: [{ role: "user", content: `<message>\n${message}\n</message>` }],
    });
  } catch (e) {
    console.error("Claude fallback failed:", e);
    throw new ClaudeReadError(explain(e));
  }
  // Why it stopped decides whether there is anything to read.
  if (response.stop_reason === "refusal") throw new ClaudeReadError("Claude declined to read this message.");
  if (response.stop_reason === "max_tokens") throw new ClaudeReadError("Claude's answer was cut off. Try a shorter message.");
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let out: z.infer<typeof OrderSchema>;
  try {
    out = FORMAT.parse(text);
  } catch (e) {
    console.error("Claude fallback returned an unexpected shape:", e);
    throw new ClaudeReadError(NOT_AN_ORDER);
  }
  return toParseResult(message, out);
}

function explain(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.local.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Claude took too long to answer. Try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "no status"}). Try again, or read the message by hand.`;
  if (e instanceof Anthropic.AnthropicError) return NOT_AN_ORDER;
  return "Couldn't read the message with Claude.";
}

function toParseResult(message: string, out: z.infer<typeof OrderSchema>): ParseResult {
  const lines: ParsedLine[] = out.lines.map((l) => {
    const sourceText = l.source_text.trim() || message;
    const at = message.indexOf(sourceText);
    const size = l.size ?? (l.product && FREE_SIZE_PRODUCTS.has(l.product) ? "FREE" : null);
    const warnings = [!l.product && "product missing", !l.colour && "colour missing", !size && "size missing"].filter((w): w is string => Boolean(w));
    return {
      product: l.product,
      colour: l.colour,
      size,
      qty: l.qty,
      descriptors: l.design_words.map((w) => w.toLowerCase()),
      code: l.product_code ? l.product_code.toUpperCase() : null,
      priceHint: null,
      sourceText,
      span: at >= 0 ? [at, at + sourceText.length] : [0, 0],
      inherited: [],
      warnings,
    };
  });
  const label = out.due ?? (out.due_day_of_month ? `date:${out.due_day_of_month}` : null);
  const confidence = !lines.length || lines.some((l) => !l.product) ? "low" : out.unclear.length || lines.some((l) => l.warnings.length) ? "medium" : "high";
  return {
    lines,
    tokens: [],
    due: label ? { label, text: label } : null,
    urgent: out.urgent,
    unknownWords: out.unclear,
    confidence,
  };
}
