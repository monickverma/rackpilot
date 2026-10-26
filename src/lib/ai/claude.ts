// The one place RackPilot calls Claude. Server only; the key comes from
// ANTHROPIC_API_KEY in .env.local and is never sent to the browser.
//
// Claude is used for three bounded jobs: reading messy order text or
// documents into a fixed schema, routing a question to one of the fixed query
// templates, and phrasing explanations of results the database already
// computed. Every reply is schema-checked, and explanations are checked
// against the source records before they are shown (see grounding.ts).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Raised with a message that can be shown to the user as is. */
export class ClaudeError extends Error {}

let client: Anthropic | undefined;

export type Content = string | Anthropic.Beta.BetaContentBlockParam[];

export async function structured<S extends z.ZodType>(schema: S, opts: { system: string; content: Content; effort?: "low" | "medium" | "high"; maxTokens?: number }): Promise<z.infer<S>> {
  if (!claudeConfigured()) throw new ClaudeError("Claude is off: add ANTHROPIC_API_KEY to .env.local and restart.");
  const format = betaZodOutputFormat(schema);
  let response;
  try {
    // Someone is waiting on the answer, so fail fast rather than retry for minutes.
    client ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
    response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "low", format },
      messages: [{ role: "user", content: opts.content }],
    });
  } catch (e) {
    console.error("Claude request failed:", e);
    throw new ClaudeError(explain(e));
  }
  if (response.stop_reason === "refusal") throw new ClaudeError("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off.");
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    return format.parse(text) as z.infer<S>;
  } catch (e) {
    console.error("Claude returned an unexpected shape:", e);
    throw new ClaudeError("Claude's answer wasn't in the expected format.");
  }
}

function explain(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy right now. Try again in a minute.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Claude took too long to answer.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? "no status"}).`;
  return "Couldn't get an answer from Claude.";
}
