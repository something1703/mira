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

- [x] Provider adapter interface (messages, tools, structured output, streaming); implement Vertex adapters through the Vercel AI SDK providers (verify package names and exports at install); mock adapter replays recorded outputs. _(package names and exports verified at install, F48. Streaming is not built: answers are short and are validated whole before they are shown, so there is nothing to stream. The mock replays scripts, since no recorded model outputs exist)_
- [x] Read tools (`get_twin_summary`, `read_product_page`, `search_catalog`, `explain_metric`) with Zod I/O.
- [x] `read_product_page`: fetch with SSRF guards (http/https only, no private IPs, size and time limits); strip scripts; small model extracts to schema; page text marked as untrusted data in the prompt. _(https only, D38)_
- [x] Plan tools return a plan document and a quote from the ledger; `start_run` requires a UI-recorded confirmation for that plan ID. _(build twin and match shade; the look and proof plans answer "module unavailable" until Phases 8 and 9, D38)_
  *Accept:* eval where the model tries to call `start_run` without confirmation fails safely.
- [x] MCP client to the YouCam servers; expose only `list_look_templates` and `list_backgrounds`. _(built and tested for the filter; no live call yet, tool names unconfirmed, F47)_
- [x] Answer schema, digit rejection, placeholder check, metric injection, claim linter, one retry, templated fallback.
- [x] Out-of-scope handling: medical questions, ethnicity or identity inference, comments on body shape.
- [x] Ask MIRA panel: every state in UX_FLOWS §9; suggestions per screen; QuoteSheet inline; compact StepRail linking to the full screen. _(see D38 (5) on when a quote can appear in the panel)_
- [x] Evals: every module, refusals, confirmation-bypass attempts, prompt injection inside product pages, missing twin, model unavailable. _(55 cases)_

## Tests

- `pnpm eval:agent` ≥ 95% in mock mode (100%, F49); a live run of the same suite once against Vertex, results in `docs/FACTS.md`. **Open: the live run needs a Google Cloud project, which waits for the deploy approval.**
- Unit tests for renderer, linter and fallbacks.
- Playwright for every panel state.

## Definition of done

- [x] Switching `MIRA_MODEL_PROVIDER` between the Vertex adapters needs no code change. _(one adapter class; `selectProvider` builds each from env alone, tested. Not yet run against Vertex)_
- [x] No digit ever reaches the UI from model free text (fuzz test over 1,000 synthetic outputs). _(F50)_
- [x] Every panel state implemented and tested. _(Playwright: idle, thinking, plan and quote, over cap, running, answer, fallback, unavailable, out of scope, needs a photo, refused start)_

## Demo moment

"Find my foundation in this brand and then build me a sangeet look": the agent returns two plans with quotes, waits, runs both, and answers with readings it could not have made up.
