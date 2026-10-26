// Regenerates the synthetic businesses as of now.

import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { need } from "@/lib/context";
import { resetDemo } from "@/seed/index";

export const POST = handle(async (req, s) => {
  await body(req, z.object({ action: z.literal("reset") }));
  need(s, "demo.reset");
  await resetDemo();
  return { reset: true };
}, { write: false });
