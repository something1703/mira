import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../../../skills/measured-shade-match");

interface Script {
  parseReply: (text: string) => unknown;
  request: (skin: string, shades: unknown[], top: number) => unknown;
  shadeMatch: (o: {
    url: string;
    token: string;
    skin: string;
    shades: unknown[];
    top?: number;
    fetchImpl: (
      url: string,
      init: { headers: Record<string, string>; body: string },
    ) => Promise<unknown>;
  }) => Promise<unknown>;
}

const load = async () =>
  (await import(pathToFileURL(join(DIR, "scripts/shade_match.mjs")).href)) as Script;

describe("the measured-shade-match skill", () => {
  it("has the front matter a Skill needs, and says what it does not do", () => {
    const md = readFileSync(join(DIR, "SKILL.md"), "utf8");
    expect(md).toMatch(/^---\nname: measured-shade-match\ndescription: .+\n---/);
    expect(md).toMatch(/does not render the shade/);
    expect(md).toMatch(/Never print it/);
  });

  it("reads a plain JSON reply and a server-sent event the same way", async () => {
    const { parseReply } = await load();
    const msg = { jsonrpc: "2.0", id: 1, result: { structuredContent: { ranked: [] } } };
    expect(parseReply(JSON.stringify(msg))).toEqual(msg);
    expect(parseReply(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)).toEqual(msg);
    expect(() => parseReply("event: ping\n\n")).toThrow(/no message/);
  });

  it("sends the token as a bearer header and returns the structured answer", async () => {
    const { shadeMatch } = await load();
    let seen: { headers: Record<string, string>; body: string } | undefined;
    const out = await shadeMatch({
      url: "https://mira.example/mcp",
      token: "tok_secret",
      skin: "#C79A78",
      shades: [{ id: "a", name: "A", hex: "#C99870" }],
      fetchImpl: (_u, init) => {
        seen = init;
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(JSON.stringify({ result: { structuredContent: { checked: 1 } } })),
        });
      },
    });
    expect(out).toEqual({ checked: 1 });
    expect(seen?.headers.authorization).toBe("Bearer tok_secret");
    expect(JSON.parse(seen?.body ?? "{}")).toMatchObject({
      method: "tools/call",
      params: { name: "shade_match" },
    });
  });

  it("says plainly when the token is refused or the units are used", async () => {
    const { shadeMatch } = await load();
    const args = { url: "u", token: "t", skin: "#C79A78", shades: [] };
    await expect(
      shadeMatch({
        ...args,
        fetchImpl: () =>
          Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("") }),
      }),
    ).rejects.toThrow(/refused the token/);
    await expect(
      shadeMatch({
        ...args,
        fetchImpl: () =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  result: { isError: true, content: [{ text: "0 of its daily units left" }] },
                }),
              ),
          }),
      }),
    ).rejects.toThrow(/daily units left/);
  });
});
