// Ask your business: routes the question to a fixed query template and explains the result.

import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { ask } from "@/lib/intel/assistant";

export const POST = handle(async (req, s) => {
  const { question, useClaude } = await body(req, z.object({ question: z.string().trim().min(2).max(500), useClaude: z.boolean().default(true) }));
  return ask(s, question, { useClaude });
}, { write: false });
