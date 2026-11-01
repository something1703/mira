import { describe, expect, it } from "vitest";
import { Identity, IdentityError, jwtExpiryMs } from "../src/identity";

const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString("base64url")}.s`;

describe("Identity", () => {
  const make = (answer: () => Response, clock = { now: 1_000_000 }) => {
    const calls: string[] = [];
    const id = new Identity({
      now: () => clock.now,
      fetch: ((url: string, init: RequestInit) => {
        calls.push(`${url}|${new Headers(init.headers).get("metadata-flavor") ?? ""}`);
        return Promise.resolve(answer());
      }) as typeof fetch,
    });
    return { id, calls, clock };
  };

  it("asks the metadata server for a token for that audience and sends it as a bearer", async () => {
    const { id, calls } = make(() => new Response(jwt(2_000)));
    expect(await id.headers("https://mira-workflows-1.run.app")).toEqual({
      "x-serverless-authorization": `Bearer ${jwt(2_000)}`,
    });
    expect(calls[0]).toContain("audience=https%3A%2F%2Fmira-workflows-1.run.app");
    expect(calls[0]).toContain("|Google");
  });

  it("reuses a token until shortly before it expires, then renews", async () => {
    const { id, calls, clock } = make(() => new Response(jwt(1_000 + 3_600)));
    await id.token("a");
    await id.token("a");
    expect(calls).toHaveLength(1);
    clock.now += 3_600_000 - 4 * 60_000; // inside the five minute renewal margin
    await id.token("a");
    expect(calls).toHaveLength(2);
  });

  it("keeps a token per audience and mints once for a burst of calls", async () => {
    const { id, calls } = make(() => new Response(jwt(5_000)));
    await Promise.all([id.token("a"), id.token("a"), id.token("a"), id.token("b")]);
    expect(calls).toHaveLength(2);
  });

  it("fails loudly: an unreachable or refusing metadata server, and a token it cannot read", async () => {
    await expect(make(() => new Response("no", { status: 403 })).id.token("a")).rejects.toThrow(
      IdentityError,
    );
    await expect(make(() => new Response("not-a-jwt")).id.token("a")).rejects.toThrow(
      "could not be read",
    );
    const down = new Identity({
      fetch: () => Promise.reject(new Error("offline")),
    });
    await expect(down.token("a")).rejects.toThrow("offline");
  });

  it("reads exp from a JWT", () => {
    expect(jwtExpiryMs(jwt(10))).toBe(10_000);
    expect(jwtExpiryMs("nope")).toBeUndefined();
  });
});
