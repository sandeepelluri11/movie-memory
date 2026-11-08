import { NextResponse, type NextRequest } from "next/server";

// Auth.js session cookie names (the __Secure- prefix is used over HTTPS).
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

// Optimistic check only: gives signed-out users a real 307 instead of a streamed redirect.
// A forged/expired cookie passes here but is rejected by the page's authoritative DB session check.
export function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (!hasSession) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*"],
};
