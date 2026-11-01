import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { YOUCAM_MCP_SERVERS } from "@mira/youcam-client/mcp-servers";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * MIRA uses the YouCam MCP servers for discovery only (D3, docs/AGENT_RUNTIME.md §7): the
 * model may list look templates and background presets, and nothing else. Every other MCP tool
 * is filtered out here, before the model can see it, so a server that adds a tool cannot give the
 * model a way to spend units or start work outside MIRA's workflows.
 */
export interface Listed {
  id: string;
  name: string;
}
export type Discovery =
  { ok: true; items: Listed[] } | { ok: false; reason: "unavailable" | "no_tool" };

export interface LookDiscovery {
  templates(category: string): Promise<Discovery>;
  backgrounds(venue: string): Promise<Discovery>;
}

export const MCP_SERVERS = YOUCAM_MCP_SERVERS;

/**
 * The tools the model may use, by what they do. The real tool names are read from each server
 * (FACTS F47 records that they are unconfirmed), so a tool is allowed by its name matching one of
 * these discovery patterns and by not matching any pattern that suggests work.
 */
const TEMPLATE_TOOL = /(?:list|get|search)[_-]?(?:look[_-]?)?templates?/i;
const BACKGROUND_TOOL = /(?:list|get|search)[_-]?(?:backgrounds?|scenes?)/i;
const WORK_TOOL = /(?:run|create|generate|submit|start|apply|edit|upload|delete)/i;

export const isDiscoveryTool = (name: string, kind: "templates" | "backgrounds"): boolean =>
  !WORK_TOOL.test(name) && (kind === "templates" ? TEMPLATE_TOOL : BACKGROUND_TOOL).test(name);

/** Pulls `{id, name}` pairs out of whatever list a tool returned. */
export function parseListed(text: string): Listed[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? ((Object.values(value).find(Array.isArray) as unknown[] | undefined) ?? [])
      : [];
  const out: Listed[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const id = r.id ?? r.template_id ?? r.templateId ?? r.name;
    const name = r.name ?? r.title ?? r.id;
    if ((typeof id === "string" || typeof id === "number") && typeof name === "string") {
      out.push({ id: String(id).slice(0, 80), name: name.slice(0, 80) });
    }
    if (out.length >= 40) break;
  }
  return out;
}

export class McpDiscovery implements LookDiscovery {
  constructor(private readonly key: string) {}

  private async call(
    server: keyof typeof MCP_SERVERS,
    kind: "templates" | "backgrounds",
    args: Record<string, string>,
  ): Promise<Discovery> {
    const client = new Client({ name: "mira-agent", version: "0.0.0" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(MCP_SERVERS[server]), {
          requestInit: { headers: { Authorization: `Bearer ${this.key}` } },
        }),
      );
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => isDiscoveryTool(t.name, kind));
      if (!tool) return { ok: false, reason: "no_tool" };
      const result = await client.callTool({ name: tool.name, arguments: args });
      const content = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((c: { type?: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : ""))
        .join("");
      return { ok: true, items: parseListed(text) };
    } catch {
      return { ok: false, reason: "unavailable" };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  templates(category: string): Promise<Discovery> {
    const server = category === "clothing" ? "fashion" : "beauty";
    return this.call(server, "templates", { category });
  }

  backgrounds(venue: string): Promise<Discovery> {
    return this.call("creators", "backgrounds", { venue });
  }
}

/** Mock mode: a short, invented list, so the tool runs with no network. Names say they are samples. */
export class MockDiscovery implements LookDiscovery {
  templates(category: string): Promise<Discovery> {
    return Promise.resolve({
      ok: true,
      items: [
        { id: `sample-${category}-1`, name: `Sample ${category} template A` },
        { id: `sample-${category}-2`, name: `Sample ${category} template B` },
      ],
    });
  }
  backgrounds(venue: string): Promise<Discovery> {
    return Promise.resolve({
      ok: true,
      items: [{ id: `sample-${venue}-1`, name: `Sample ${venue} background` }],
    });
  }
}
