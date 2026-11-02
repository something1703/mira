import { timingSafeEqual } from "node:crypto";

/**
 * Bearer tokens for MIRA's MCP server (docs/SECURITY_PRIVACY.md §3). `MIRA_MCP_TOKENS` is a list
 * `token:name:units`, comma separated: the secret, a name for logs, and how many units that token
 * may use a day. Nothing here is a person's: a token is a partner's key to the engines.
 */
export interface TokenRecord {
  token: string;
  name: string;
  dailyUnits: number;
}

export function parseTokens(raw: string | undefined): TokenRecord[] {
  if (!raw) return [];
  const out: TokenRecord[] = [];
  for (const part of raw.split(",")) {
    const [token, name, units] = part.trim().split(":");
    const cap = Number(units);
    if (!token || token.length < 16 || !name || !Number.isInteger(cap) || cap < 0) continue;
    out.push({ token, name, dailyUnits: cap });
  }
  return out;
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The record a bearer header names, compared in constant time; undefined when it names none. */
export function authenticate(
  header: string | undefined,
  tokens: readonly TokenRecord[],
): TokenRecord | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  const given = m?.[1];
  if (given === undefined) return undefined;
  let found: TokenRecord | undefined;
  // Every token is compared, so the time taken does not say which one matched.
  for (const t of tokens) if (same(t.token, given)) found = t;
  return found;
}

/**
 * Units used per token per UTC day. In memory: one instance counts its own calls, so the service
 * runs at one instance until the shared counter (Firestore) exists, like the other limiters (D36).
 */
export class UnitLedger {
  private readonly used = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private key(token: string): string {
    return `${new Date(this.now()).toISOString().slice(0, 10)}:${token}`;
  }

  used_today(token: string): number {
    return this.used.get(this.key(token)) ?? 0;
  }

  /** Takes `units` if the token has them left; otherwise takes nothing and says so. */
  spend(
    record: TokenRecord,
    units: number,
  ): { ok: true; left: number } | { ok: false; left: number } {
    const key = this.key(record.token);
    const used = this.used.get(key) ?? 0;
    if (used + units > record.dailyUnits)
      return { ok: false, left: Math.max(0, record.dailyUnits - used) };
    this.used.set(key, used + units);
    return { ok: true, left: record.dailyUnits - used - units };
  }
}
