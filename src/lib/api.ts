// Shared plumbing for the API route handlers: authenticate from the session
// cookie, validate the body with zod, map domain errors to HTTP statuses, and
// re-run the investigation checks after every write so OrderTrace and
// StockSleuth see each change as it happens.

import { NextResponse, type NextRequest } from "next/server";
import * as z from "zod/v4";
import { DomainError, ForbiddenError, NotFoundError } from "./context.ts";
import { runChecks } from "./investigate/engine.ts";
import { SESSION_COOKIE, sessionFromToken, type Session } from "./auth.ts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiSession(req: NextRequest): Promise<Session> {
  const s = await sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) throw new HttpError(401, "Sign in first.");
  return s;
}

export function handle<T, P extends Record<string, string> = Record<string, string>>(
  fn: (req: NextRequest, s: Session, params: P) => Promise<T>,
  opts: { write?: boolean } = { write: true },
) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      const s = await apiSession(req);
      const data = await fn(req, s, (await context?.params) ?? ({} as P));
      if (opts.write) await runChecks(s.businessId, new Date());
      return NextResponse.json({ ok: true, data });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  if (err instanceof ForbiddenError) return NextResponse.json({ ok: false, error: err.message }, { status: 403 });
  if (err instanceof NotFoundError) return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
  if (err instanceof DomainError) return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
  if (err instanceof z.ZodError) return NextResponse.json({ ok: false, error: `Invalid request: ${err.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("; ")}` }, { status: 400 });
  console.error(err);
  return NextResponse.json({ ok: false, error: "Something went wrong. Nothing was changed." }, { status: 500 });
}

export async function body<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Send a JSON body.");
  }
  return schema.parse(json);
}

export const id = z.coerce.number().int().positive();
