import { OAuth2Client } from "google-auth-library";

/**
 * Checks that a call to `/internal/tasks/*` really came from Cloud Tasks acting as MIRA's own
 * service account. Cloud Run already refuses a call with no valid invoker identity; this is the
 * second check, in the service, so the route is safe even if it is ever exposed another way.
 */
export interface TaskCallVerifier {
  (authorization: string | undefined): Promise<boolean>;
}

export interface VerifyOptions {
  /** The ID token's audience: the base URL of mira-workflows. */
  audience: string;
  /** The only service account whose tokens are accepted. */
  serviceAccountEmail: string;
  /** Replaced in tests. Live it checks Google's signature. */
  verifyIdToken?: (
    idToken: string,
    audience: string,
  ) => Promise<{ email?: string; email_verified?: boolean } | undefined>;
}

export function taskCallVerifier(o: VerifyOptions): TaskCallVerifier {
  const client = new OAuth2Client();
  const verify =
    o.verifyIdToken ??
    (async (idToken: string, audience: string) => {
      const ticket = await client.verifyIdToken({ idToken, audience });
      return ticket.getPayload();
    });
  return async (authorization) => {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
    if (!match?.[1]) return false;
    try {
      const claims = await verify(match[1], o.audience);
      return claims?.email_verified === true && claims.email === o.serviceAccountEmail;
    } catch {
      return false;
    }
  };
}
