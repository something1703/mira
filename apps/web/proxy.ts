import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  newSession,
  sessionSecret,
  signSession,
  verifySession,
} from "./src/session";

/**
 * Gives every visitor an anonymous session before the page renders (D14). The cookie is set on
 * the response and on the request, so the first render already sees it.
 */
export function proxy(request: NextRequest) {
  const secret = sessionSecret();
  if (verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret)) return NextResponse.next();
  const value = signSession(newSession(), secret);
  request.cookies.set(SESSION_COOKIE, value);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set({
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });
  return response;
}

export const config = {
  // Pages and the dev API; not static files, health checks or the machine-to-machine doors.
  matcher: ["/((?!_next/|brand/|icons/|health|webhooks/|mcp|favicon|manifest).*)"],
};
