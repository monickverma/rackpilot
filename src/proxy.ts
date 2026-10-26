// Sends visitors without a session to the demo sign-in. The pages and the API
// still verify the signed session themselves; this only saves a round trip.

import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!request.cookies.has("rp_session")) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(request.nextUrl.pathname)}`, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/orders/:path*", "/inventory/:path*", "/stock/:path*", "/investigations/:path*", "/ordertrace/:path*", "/stocksleuth/:path*", "/alerts/:path*", "/analytics/:path*", "/purchasing/:path*", "/assistant/:path*", "/metrics/:path*", "/r/:path*"],
};
