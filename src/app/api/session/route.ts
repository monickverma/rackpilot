// Demo sign-in and sign-out. POST { userId } picks a synthetic user.

import { NextResponse, type NextRequest } from "next/server";
import * as z from "zod/v4";
import { one } from "@/db/client";
import { body, errorResponse, HttpError } from "@/lib/api";
import { SESSION_COOKIE, sessionValue } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await body(req, z.object({ userId: z.coerce.number().int().positive() }));
    const user = await one<{ id: number }>(`SELECT id FROM users WHERE id = $1`, userId);
    if (!user) throw new HttpError(404, "No such demo user.");
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, sessionValue(user.id), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7 });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
