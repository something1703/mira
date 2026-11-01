/**
 * Service-to-service identity on Cloud Run. A private Cloud Run service accepts a call only with a
 * Google-signed ID token for its own address, which the caller's service account can mint from the
 * metadata server. Tokens last an hour; they are reused until shortly before they expire.
 *
 * In mock mode services call each other on localhost with no identity, so callers ask for headers
 * only in live mode (`MIRA_MODE=live`).
 */
export interface IdentityOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Where the metadata server is. Only tests change it. */
  metadataHost?: string;
  /** Renew this long before expiry. */
  renewBeforeMs?: number;
}

export class IdentityError extends Error {
  constructor(
    readonly audience: string,
    detail: string,
  ) {
    super(`Could not get an identity token for ${audience}: ${detail}`);
    this.name = "IdentityError";
  }
}

interface Cached {
  token: string;
  expiresAt: number;
}

/** The `exp` claim of a JWT in milliseconds, or undefined if it cannot be read. */
export function jwtExpiryMs(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

export class Identity {
  private readonly cache = new Map<string, Cached>();
  private readonly pending = new Map<string, Promise<string>>();

  constructor(private readonly o: IdentityOptions = {}) {}

  /**
   * The header that lets a call into the private service at `audience` (its base URL, no path).
   * It is `X-Serverless-Authorization`, which Cloud Run checks and removes, so a request that
   * already carries its own `Authorization` (the MCP bearer token) passes through unchanged.
   */
  async headers(audience: string): Promise<Record<string, string>> {
    return { "x-serverless-authorization": `Bearer ${await this.token(audience)}` };
  }

  async token(audience: string): Promise<string> {
    const now = (this.o.now ?? Date.now)();
    const hit = this.cache.get(audience);
    if (hit && hit.expiresAt - (this.o.renewBeforeMs ?? 5 * 60_000) > now) return hit.token;
    // One request per audience at a time: a burst of calls must not make a burst of mints.
    const inflight = this.pending.get(audience);
    if (inflight) return await inflight;
    const mint = this.mint(audience, now).finally(() => this.pending.delete(audience));
    this.pending.set(audience, mint);
    return await mint;
  }

  private async mint(audience: string, now: number): Promise<string> {
    const host = this.o.metadataHost ?? "http://metadata.google.internal";
    const url = `${host}/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(url, {
        headers: { "Metadata-Flavor": "Google" },
        signal: AbortSignal.timeout(5_000),
      });
    } catch (error) {
      throw new IdentityError(audience, error instanceof Error ? error.message : "no answer");
    }
    if (!res.ok)
      throw new IdentityError(audience, `the metadata server answered ${String(res.status)}`);
    const token = (await res.text()).trim();
    const expiresAt = jwtExpiryMs(token);
    if (expiresAt === undefined) throw new IdentityError(audience, "the token could not be read");
    this.cache.set(audience, { token, expiresAt: Math.max(expiresAt, now) });
    return token;
  }
}
