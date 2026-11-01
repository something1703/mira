import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Anonymous sessions (D14): a signed, HttpOnly cookie carries a user id and a session id, so unit
 * caps and runs have a stable owner without an account. The signature is HMAC-SHA256 under
 * `MIRA_SESSION_SECRET`. Mock mode uses a fixed development secret; live mode refuses to run
 * without a real one.
 */
export const SESSION_COOKIE = "mira_session";

export interface Session {
  userId: string;
  sessionId: string;
}

const MOCK_SECRET = "mira-mock-mode-session-secret-not-for-live-use";

export function sessionSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.MIRA_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (env.MIRA_MODE === "live") {
    throw new Error("MIRA_SESSION_SECRET (at least 32 characters) is required in live mode.");
  }
  return MOCK_SECRET;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const mac = (body: string, secret: string) =>
  createHmac("sha256", secret).update(body).digest("base64url");
const ID = (prefix: string) => new RegExp(`^${prefix}_[a-z0-9]{6,64}$`);

export function newSession(): Session {
  const id = () => randomUUID().replaceAll("-", "");
  return { userId: `usr_${id()}`, sessionId: `ses_${id()}` };
}

export function signSession(session: Session, secret: string): string {
  const body = b64(JSON.stringify({ u: session.userId, s: session.sessionId }));
  return `${body}.${mac(body, secret)}`;
}

/** The session, or undefined if the cookie is missing, malformed or signed with another key. */
export function verifySession(value: string | undefined, secret: string): Session | undefined {
  if (!value) return undefined;
  const [body, sig, extra] = value.split(".");
  if (!body || !sig || extra !== undefined) return undefined;
  const want = Buffer.from(mac(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      u?: unknown;
      s?: unknown;
    };
    if (typeof parsed.u !== "string" || typeof parsed.s !== "string") return undefined;
    if (!ID("usr").test(parsed.u) || !ID("ses").test(parsed.s)) return undefined;
    return { userId: parsed.u, sessionId: parsed.s };
  } catch {
    return undefined;
  }
}
