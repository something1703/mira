import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newSession, sessionSecret, signSession, verifySession } from "./session";

const SECRET = "x".repeat(40);

describe("anonymous sessions (D14)", () => {
  it("round-trips a signed session", () => {
    const s = newSession();
    expect(s.userId).toMatch(/^usr_[a-z0-9]{32}$/);
    expect(verifySession(signSession(s, SECRET), SECRET)).toEqual(s);
  });

  it("rejects tampering, another key, and malformed values", () => {
    const value = signSession(newSession(), SECRET);
    const [body, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "usr_attacker1", s: "ses_attacker1" })).toString(
      "base64url",
    );
    expect(verifySession(`${forged}.${sig ?? ""}`, SECRET)).toBeUndefined();
    expect(verifySession(value, "y".repeat(40))).toBeUndefined();
    for (const bad of [undefined, "", "abc", `${body ?? ""}.`, `${value}.extra`, "....."]) {
      expect(verifySession(bad, SECRET)).toBeUndefined();
    }
  });

  it("rejects a correctly signed body whose ids are not MIRA ids", () => {
    const body = Buffer.from(JSON.stringify({ u: "admin", s: "../../x" })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifySession(`${body}.${sig}`, SECRET)).toBeUndefined();
  });

  it("needs a real secret in live mode and uses a fixed one in mock", () => {
    expect(() => sessionSecret({ MIRA_MODE: "live" })).toThrow("MIRA_SESSION_SECRET");
    expect(() => sessionSecret({ MIRA_MODE: "live", MIRA_SESSION_SECRET: "short" })).toThrow();
    expect(sessionSecret({ MIRA_MODE: "live", MIRA_SESSION_SECRET: SECRET })).toBe(SECRET);
    expect(sessionSecret({ MIRA_MODE: "mock" })).toMatch(/mock/);
  });
});
