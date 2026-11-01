# Phase 7 — Agent runtime ("Ask MIRA")

**Goal:** a conversational layer that plans, quotes, waits for confirmation, starts workflows and narrates results, and is structurally unable to invent a number or confirm on the user's behalf.

**Depends on:** Phases 3, 5, 6. **Read first:** `docs/AGENT_RUNTIME.md`, `docs/COPY.md`, `docs/UX_FLOWS.md` §9.

## Deliverables

| Path | What |
| --- | --- |
| `apps/agent/src/providers/` | `vertex-anthropic`, `vertex-google`, `anthropic-direct`, `mock` adapters |
| `apps/agent/src/tools/` | Every tool in AGENT_RUNTIME §3 |
| `apps/agent/src/mcp/youcam.ts` | MCP client with discovery-only tool filter |
| `apps/agent/src/render/` | Answer schema validation, metric injection, linter, fallbacks |
| `apps/agent/src/prompts/system.v1.md` | System prompt per AGENT_RUNTIME §6 |
| `apps/agent/evals/` | 40+ scripted conversations |
| `apps/web/src/ask-mira/` | Panel UI with every state |

## Tasks

- [ ] Provider adapter interface (messages, tools, structured output, streaming); implement Vertex adapters through the Vercel AI SDK providers (verify package names and exports at install); mock adapter replays recorded outputs.
- [ ] Read tools (`get_twin_summary`, `read_product_page`, `search_catalog`, `explain_metric`) with Zod I/O.
- [ ] `read_product_page`: fetch with SSRF guards (http/https only, no private IPs, size and time limits); strip scripts; small model extracts to schema; page text marked as untrusted data in the prompt.
- [ ] Plan tools return a plan document and a quote from the ledger; `start_run` requires a UI-recorded confirmation for that plan ID.
  *Accept:* eval where the model tries to call `start_run` without confirmation fails safely.
- [ ] MCP client to the YouCam servers; expose only `list_look_templates` and `list_backgrounds`.
- [ ] Answer schema, digit rejection, placeholder check, metric injection, claim linter, one retry, templated fallback.
- [ ] Out-of-scope handling: medical questions, ethnicity or identity inference, comments on body shape.
- [ ] Ask MIRA panel: every state in UX_FLOWS §9; suggestions per screen; QuoteSheet inline; compact StepRail linking to the full screen.
- [ ] Evals: every module, refusals, confirmation-bypass attempts, prompt injection inside product pages, missing twin, model unavailable.

## Tests

- `pnpm eval:agent` ≥ 95% in mock mode; a live run of the same suite once against Vertex, results in `docs/FACTS.md`.
- Unit tests for renderer, linter and fallbacks.
- Playwright for every panel state.

## Definition of done

- [ ] Switching `MIRA_MODEL_PROVIDER` between the Vertex adapters needs no code change.
- [ ] No digit ever reaches the UI from model free text (fuzz test over 1,000 synthetic outputs).
- [ ] Every panel state implemented and tested.

## Demo moment

"Find my foundation in this brand and then build me a sangeet look": the agent returns two plans with quotes, waits, runs both, and answers with readings it could not have made up.
