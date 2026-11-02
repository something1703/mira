#!/usr/bin/env node
// Calls MIRA's shade_match tool. Reads MIRA_MCP_URL and MIRA_MCP_TOKEN from the environment.
import { readFileSync } from "node:fs";

/** The JSON-RPC message in a reply that is plain JSON or one server-sent event. */
export function parseReply(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  if (data === "") throw new Error("The server's reply had no message.");
  return JSON.parse(data);
}

export function request(skinHex, shades, top) {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "shade_match", arguments: { skin_hex: skinHex, shades, top } },
  };
}

export async function shadeMatch({ url, token, skin, shades, top = 5, fetchImpl = fetch }) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request(skin, shades, top)),
  });
  if (res.status === 401) throw new Error("The MIRA server refused the token.");
  if (!res.ok) throw new Error(`The MIRA server answered ${String(res.status)}.`);
  const message = parseReply(await res.text());
  const result = message.result;
  if (!result || result.isError) {
    const why = result?.content?.[0]?.text ?? message.error?.message ?? "No answer.";
    throw new Error(why);
  }
  return result.structuredContent;
}

function arg(name, args) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

async function main(args) {
  const url = process.env.MIRA_MCP_URL;
  const token = process.env.MIRA_MCP_TOKEN;
  const skin = arg("skin", args);
  const file = arg("shades", args);
  if (!url || !token || !skin || !file) {
    console.error(
      "Set MIRA_MCP_URL and MIRA_MCP_TOKEN, and pass --skin '#RRGGBB' --shades file.json",
    );
    process.exit(2);
  }
  const shades = JSON.parse(readFileSync(file, "utf8"));
  const top = arg("top", args) === undefined ? 5 : Number(arg("top", args));
  const out = await shadeMatch({ url, token, skin, shades, top });
  console.log(JSON.stringify(out, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
