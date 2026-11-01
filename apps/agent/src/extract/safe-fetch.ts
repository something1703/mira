import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { request } from "node:https";

/**
 * Fetching a page a person pasted. The address is untrusted: a link to the metadata server or to an
 * internal service must never be followed from inside the cloud. So only https is allowed, the
 * address a name resolves to is checked at the moment of connecting (not before, which a hostile DNS
 * answer could change), redirects are followed by hand and each one is checked again, and the body
 * is capped in size and time.
 */
export type FetchFailure =
  "url_invalid" | "url_blocked" | "fetch_failed" | "not_html" | "too_large" | "too_many_redirects";

export type PageResult =
  { ok: true; html: string; finalUrl: string } | { ok: false; reason: FetchFailure };

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

function ipv4Private(a: number[]): boolean {
  const [p, q] = a as [number, number, number, number];
  return (
    p === 0 ||
    p === 10 ||
    p === 127 ||
    (p === 100 && q >= 64 && q <= 127) || // carrier-grade NAT
    (p === 169 && q === 254) || // link-local, including the metadata server
    (p === 172 && q >= 16 && q <= 31) ||
    (p === 192 && q === 0) ||
    (p === 192 && q === 168) ||
    (p === 198 && (q === 18 || q === 19)) ||
    p >= 224 // multicast and reserved
  );
}

/** True only for an address on the public internet. Anything that cannot be read is not public. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !ipv4Private(address.split(".").map(Number));
  if (kind === 6) {
    const a = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    if (a === "::" || a === "::1") return false;
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
    return !/^(f[cd]|fe[89ab]|ff)/.test(a);
  }
  return false;
}

/** A DNS lookup that refuses to hand back a private address, used at connect time. */
export const validatingLookup: typeof dnsLookup = ((host, options, callback) => {
  const opts = options as { all?: boolean };
  const done = callback as unknown as (...args: unknown[]) => void;
  dnsLookup(host, { ...(options as object), all: true }, (error, addresses) => {
    const list = (Array.isArray(addresses) ? addresses : []) as {
      address: string;
      family: number;
    }[];
    if (error) {
      done(error);
      return;
    }
    const first = list[0];
    if (first === undefined || list.some((a) => !isPublicAddress(a.address))) {
      done(new Error("blocked address"));
      return;
    }
    if (opts.all) done(null, list);
    else done(null, first.address, first.family);
  });
}) as typeof dnsLookup;

export function checkUrl(
  raw: string,
): { ok: true; url: URL } | { ok: false; reason: FetchFailure } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "url_invalid" };
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return { ok: false, reason: "url_blocked" };
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // A literal address is checked now; a name is checked when it is resolved, at connect time.
  if (isIP(host) !== 0 && !isPublicAddress(host)) return { ok: false, reason: "url_blocked" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "url_blocked" };
  }
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "url_blocked" };
  return { ok: true, url };
}

function getOnce(
  url: URL,
): Promise<
  | { kind: "page"; html: string }
  | { kind: "redirect"; to: string }
  | { kind: "failed"; reason: FetchFailure }
> {
  return new Promise((resolve) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: validatingLookup,
        timeout: TIMEOUT_MS,
        headers: { accept: "text/html", "user-agent": "MIRA shade reader" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: "redirect", to: new URL(res.headers.location, url).toString() });
          return;
        }
        const type = res.headers["content-type"] ?? "";
        if (status !== 200 || !/text\/html|application\/xhtml/.test(type)) {
          res.resume();
          resolve({ kind: "failed", reason: status === 200 ? "not_html" : "fetch_failed" });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_PAGE_BYTES) {
            res.destroy();
            resolve({ kind: "failed", reason: "too_large" });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          resolve({ kind: "page", html: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", () => {
          resolve({ kind: "failed", reason: "fetch_failed" });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ kind: "failed", reason: "fetch_failed" });
    });
    req.on("error", (e) => {
      resolve({
        kind: "failed",
        reason: e.message === "blocked address" ? "url_blocked" : "fetch_failed",
      });
    });
    req.end();
  });
}

export async function fetchPage(raw: string): Promise<PageResult> {
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkUrl(current);
    if (!checked.ok) return checked;
    const got = await getOnce(checked.url);
    if (got.kind === "page") return { ok: true, html: got.html, finalUrl: checked.url.toString() };
    if (got.kind === "failed") return { ok: false, reason: got.reason };
    current = got.to;
  }
  return { ok: false, reason: "too_many_redirects" };
}
