import { cookies } from "next/headers";
import { z } from "zod";
import { workflowsUrl } from "./runs/api";
import { SESSION_COOKIE, sessionSecret, verifySession, type Session } from "./session";

const Budget = z.object({
  cap: z.number().nonnegative(),
  reserved: z.number().nonnegative(),
  committed: z.number().nonnegative(),
  left: z.number().nonnegative(),
});
export type Budget = z.infer<typeof Budget>;

export async function currentSession(): Promise<Session | undefined> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value, sessionSecret());
}

/** The session's units, or undefined when they cannot be read (then no banner is better than a wrong one). */
export async function currentBudget(): Promise<Budget | undefined> {
  const session = await currentSession();
  if (!session) return undefined;
  try {
    const res = await fetch(`${workflowsUrl()}/internal/budgets/${session.sessionId}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return undefined;
    return Budget.parse(await res.json());
  } catch {
    return undefined;
  }
}
