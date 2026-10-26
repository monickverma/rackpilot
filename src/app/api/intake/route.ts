// Reads an order into a draft. Writes nothing.
// JSON { text, channel, reader: "rules" | "claude" }, or multipart with a
// "file" (photo or PDF of an order sheet), read by Claude.

import type { NextRequest } from "next/server";
import * as z from "zod/v4";
import { body, handle, HttpError } from "@/lib/api";
import { ClaudeError, claudeConfigured } from "@/lib/ai/claude";
import { draftWithClaude, draftWithRules } from "@/lib/intake/draft";

const Read = z.object({ text: z.string().trim().min(1, "Paste a message first.").max(4000), channel: z.enum(["message", "voice", "document"]).default("message"), reader: z.enum(["rules", "claude"]).default("rules") });
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"];

export const POST = handle(async (req: NextRequest, s) => {
  if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
    if (!claudeConfigured()) throw new HttpError(400, "Reading photos and PDFs needs Claude: add ANTHROPIC_API_KEY to .env.local.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Attach a photo or PDF.");
    if (!TYPES.includes(file.type)) throw new HttpError(400, "Use a PNG, JPEG, WebP or GIF photo, or a PDF.");
    if (file.size > 8 * 1024 * 1024) throw new HttpError(400, "Files are limited to 8 MB.");
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    try {
      return await draftWithClaude(s, { text: String(form.get("text") ?? ""), file: { mediaType: file.type, base64, name: file.name } }, "document");
    } catch (e) {
      if (e instanceof ClaudeError) throw new HttpError(502, e.message);
      throw e;
    }
  }
  const input = await body(req, Read);
  if (input.reader === "claude") {
    if (!claudeConfigured()) throw new HttpError(400, "Claude is off: add ANTHROPIC_API_KEY to .env.local and restart.");
    try {
      return await draftWithClaude(s, { text: input.text }, input.channel);
    } catch (e) {
      if (e instanceof ClaudeError) throw new HttpError(502, e.message);
      throw e;
    }
  }
  return draftWithRules(s, input.text, input.channel);
}, { write: false });
