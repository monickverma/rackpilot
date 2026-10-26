// Demo sign-in: pick one of the synthetic users. The session is a signed
// cookie naming the user; every request reloads the user from the database
// and takes the business from their record, so a request can only ever act
// for the signed-in user's own business. A production deployment would put
// Supabase Auth (or similar) here; the rest of the app only sees a Ctx.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { one, q } from "../db/client.ts";
import type { Role } from "../db/schema.ts";
import type { Ctx } from "./context.ts";

export const SESSION_COOKIE = "rp_session";
const SECRET = process.env.SESSION_SECRET || "rackpilot-demo-only-secret";

const sign = (value: string) => createHmac("sha256", SECRET).update(value).digest("base64url");

export function sessionValue(userId: number) {
  const v = `u${userId}`;
  return `${v}.${sign(v)}`;
}

function verify(token: string | undefined): number | null {
  if (!token) return null;
  const [v, sig] = token.split(".");
  if (!v || !sig) return null;
  const expected = Buffer.from(sign(v));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const id = Number(v.slice(1));
  return Number.isInteger(id) ? id : null;
}

export interface Session extends Ctx {
  business: { id: number; name: string; kind: string; city: string; slug: string };
  user: { id: number; name: string; role: Role; title?: string };
}

export async function sessionFromToken(token: string | undefined): Promise<Session | null> {
  const userId = verify(token);
  if (!userId) return null;
  const row = await one<{ id: number; name: string; role: Role; title: string; businessId: number; businessName: string; kind: string; city: string; slug: string }>(
    `SELECT u.id, u.name, u.role, u.title, b.id AS "businessId", b.name AS "businessName", b.kind, b.city, b.slug
       FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.id = $1`,
    userId,
  );
  if (!row) return null;
  return {
    businessId: row.businessId, user: { id: row.id, name: row.name, role: row.role, title: row.title },
    business: { id: row.businessId, name: row.businessName, kind: row.kind, city: row.city, slug: row.slug },
  };
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return sessionFromToken(jar.get(SESSION_COOKIE)?.value);
}

/** For pages: the session, or a redirect to sign in. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function demoUsers() {
  return q<{ id: number; name: string; role: Role; title: string; businessId: number; businessName: string; kind: string; city: string }>(
    `SELECT u.id, u.name, u.role, u.title, b.id AS "businessId", b.name AS "businessName", b.kind, b.city FROM users u JOIN businesses b ON b.id = u.business_id ORDER BY b.id, u.id`,
  );
}

export async function teammates(ctx: Ctx) {
  return q<{ id: number; name: string; role: Role; title: string }>(`SELECT id, name, role, title FROM users WHERE business_id = $1 ORDER BY id`, ctx.businessId);
}
