import { cookies } from "next/headers";
import { currentSession } from "../budget";
import { workflowsUrl } from "../runs/api";
import type { Session } from "../session";

/**
 * The browser never talks to mira-workflows. These route handlers do, on the person's behalf, with
 * the user id taken from the signed session cookie, never from the request body: a request cannot
 * name another person's profile, upload or run.
 */
export const PROFILE_COOKIE = "mira_profile";

export async function requireSession(): Promise<Session | Response> {
  const session = await currentSession();
  return session ?? Response.json({ error: "no_session" }, { status: 401 });
}

export const isResponse = (v: Session | Response): v is Response => v instanceof Response;

export async function toWorkflows(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  try {
    return await fetch(`${workflowsUrl()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      ...init,
    });
  } catch {
    return Response.json({ error: "workflows_unreachable" }, { status: 502 });
  }
}

/** Passes a workflows answer through as JSON with the same status. */
export async function relay(res: Response): Promise<Response> {
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

/** The Welcome screen reads this cookie (src/profile-state.ts). */
export async function setProfileCookie(value: "exists" | "deleted"): Promise<void> {
  (await cookies()).set({
    name: PROFILE_COOKIE,
    value,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
