# Agent runtime ("Ask MIRA")

This is MIRA's in-product assistant, not the coding agent (that is `AGENTS.md`). It lives in `apps/agent`. It plans, quotes, confirms and narrates. Workflows do the work.

## 1. Loop

```text
user message
  → load context (twin summary as metric IDs, current screen, active runs)
  → model call with tools (Vertex)
  → tool calls (read-only tools run immediately; workflow tools return a plan + quote)
  → if a plan: show QuoteSheet, wait for the user's confirm
  → start workflow, stream StepRail
  → on completion: model call to narrate, output must match the answer schema
  → renderer injects metrics → claim linter → UI
```

Maximum tool-call depth per turn: 6. Context window per turn: system prompt, last 10 messages, twin summary, active run states. Conversation history is kept for the session only.

## 2. Model routing

| Job | Env var | Typical choice |
| --- | --- | --- |
| Main loop | `MIRA_MODEL_MAIN` | `gemini-3-flash-preview` on Vertex (D17); escalate to `gemini-3.5-flash` if the evals fall below 95% |
| Extraction (claims, shades, garment attributes from text) | `MIRA_MODEL_SMALL` | `gemini-3-flash-preview` |
| Catalogue batch extraction | `MIRA_MODEL_SMALL` via Vertex batch prediction | Confirm batch support for the chosen model |
| Fallback | `MIRA_MODEL_PROVIDER=anthropic-direct` | Only if Vertex quota or region blocks |

Provider adapters live in `apps/agent/src/providers/`. Code depends only on the adapter interface. Vertex model IDs carry an `@date` suffix; take them from Model Garden.

## 3. Tools

All tool inputs and outputs are Zod schemas in `packages/schemas/src/agent-tools.ts`.

| Tool | Kind | Input | Output |
| --- | --- | --- | --- |
| `get_twin_summary` | read | — | metric IDs with values and confidence words; which groups are missing |
| `read_product_page` | read (LLM) | URL | category, garment colour hint, shade list or claim, product image ref |
| `search_catalog` | read | query, category | items |
| `explain_metric` | read | metric ID | definition, noise floor, how it was measured |
| `list_look_templates` | read (YouCam MCP) | category | template IDs and names |
| `list_backgrounds` | read (YouCam MCP) | venue type | preset IDs |
| `plan_build_twin` | plan | which captures | plan + quote |
| `plan_match_shade` | plan | range ID or URL | plan + quote |
| `plan_compose_look` | plan | slots | plan + quote |
| `plan_start_proof` / `plan_proof_check_in` | plan | product, claim | plan + quote |
| `start_run` | act | plan ID (only after user confirmation event) | run ID |

`start_run` refuses unless the UI has recorded the user's confirmation for that exact plan ID. The model cannot confirm on the user's behalf.

## 4. Answer schema

```ts
const Answer = z.object({
  segments: z.array(z.object({
    text: z.string().max(400),          // no digits allowed; placeholders like {m_shade_de}
    metric_refs: z.array(MetricId),     // every placeholder must be listed here
  })).min(1).max(8),
  renders: z.array(RenderId).max(6),    // plates to show inline
  next_actions: z.array(z.enum([
    "match_shade", "compose_look", "start_proof", "proof_check_in", "build_twin",
  ])).max(3),
});
```

## 5. Renderer and linter

1. Parse with the schema. Invalid → one retry with the validation error; then fallback.
2. Reject if any `text` contains a digit or a placeholder not in `metric_refs` or not in the run's metric set.
3. Replace each `{metric}` with value + unit + confidence words from the metric store.
4. Run the claim linter (`docs/COPY.md` §3). Reject → one retry; then fallback.
5. **Fallback**: a templated sentence per next action, built only from metrics (`apps/agent/src/fallbacks.ts`).

## 6. System prompt (outline)

Stored at `apps/agent/src/prompts/system.v1.md`. Sections:

1. Role: MIRA describes appearance and helps choose products. It never gives medical advice or judges how someone looks.
2. Tools: when to use each; workflows only through plan tools; never assume a plan is confirmed.
3. Numbers: never write digits; reference metric IDs with placeholders.
4. Language: follow the vocabulary in `docs/COPY.md`; describe, do not grade; no flattery.
5. Uncertainty: if a metric is below the noise floor or unavailable, say so plainly.
6. Out of scope: medical questions, identity or ethnicity inference, comments on body shape or weight → one-sentence redirect.
7. Brevity: at most four short sentences unless the user asks for more.

## 7. YouCam MCP client

`apps/agent/src/mcp/youcam.ts` connects to the beauty, fashion and creators servers with the MCP TypeScript SDK, server-side, with the YouCam key from Secret Manager. Only the discovery tools in §3 are exposed to the model; every other MCP tool is filtered out.

## 8. MIRA's own MCP server (phase 10)

`packages/mira-mcp` exposes `shade_match`, `measure_change`, `audit_render` and `explain_metric` to external agents, backed by the same workflows and engines, with per-token unit caps.

## 9. Evaluation set

`apps/agent/evals/` holds at least 40 scripted conversations with expected tool calls and forbidden outputs, covering every module, medical-question refusals, confirmation bypass attempts, missing-twin cases and prompt-injection text inside product pages. `pnpm eval:agent` runs them in mock mode; CI fails below 95% pass.

## 10. As built (Phase 7)

- The loop is MIRA's own (`apps/agent/src/loop.ts`); the model adapters make one call at a time and never run a tool (D38).
- `start_run` refuses unless the plan was confirmed through `POST /internal/agent/plans/:id/confirm`, which only the web app's Confirm button calls. That route also starts the plan.
- The renderer refuses digits in any script and numbers written out (except "one"), then fills placeholders from the metric store, then runs the claim linter on the rendered text. One retry shows the model what was wrong; then the templated fallback.
- Medical, identity and body questions are refused by `prompts/scope.ts` before any model call and again by the prompt.
- After a run finishes, `POST /internal/agent/narrate` has the model describe it from the run's own readings (`shade.best.blend_de` and so on).
- `plan_compose_look`, `plan_start_proof` and `plan_proof_check_in` say "module unavailable" until Phases 8 and 9.
- `pnpm eval:agent` runs 55 scripted conversations; `--live` runs the same against the configured provider.
