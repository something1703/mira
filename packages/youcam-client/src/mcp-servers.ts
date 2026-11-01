/**
 * The YouCam MCP servers (docs/YOUCAM_API.md §6). Like every YouCam address, they are known only
 * here (AGENTS.md §2.1). MIRA uses them for discovery only; apps/agent filters their tools.
 */
export const YOUCAM_MCP_SERVERS = {
  beauty: "https://mcp-api-01.makeupar.com/mcp/beauty",
  fashion: "https://mcp-api-01.makeupar.com/mcp/fashion",
  creators: "https://mcp-api-01.makeupar.com/mcp/creators",
} as const;
