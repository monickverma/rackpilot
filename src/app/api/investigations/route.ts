// GET: the Investigation Centre queue. POST { action: "run_checks" }: run every rule now.

import type { NextRequest } from "next/server";
import * as z from "zod/v4";
import { body, handle } from "@/lib/api";
import { listCases } from "@/lib/investigate/cases";
import { runChecks } from "@/lib/investigate/engine";

export const GET = handle(async (req: NextRequest, s) => listCases(s, { status: (req.nextUrl.searchParams.get("status") as "open" | "closed" | "all") ?? "open" }), { write: false });

export const POST = handle(async (req, s) => {
  await body(req, z.object({ action: z.literal("run_checks") }));
  return runChecks(s.businessId, new Date());
}, { write: false });
