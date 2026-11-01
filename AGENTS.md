# AGENTS.md

Rules for every coding agent (Claude Code, Codex, Cursor, any other) and every human working in this repository. If a rule here conflicts with a phase file, this file wins. If something is not covered, follow "When you are unsure" at the bottom.

## 1. What you are building

MIRA measures a person once with Perfect Corp's YouCam API, then helps them match foundation, compose a complete look, and check whether skincare is working. Every image MIRA generates is re-measured before a person sees it. The product promise is **trust**: nothing is airbrushed, guessed or silently wrong.

Read in this order before writing code:

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. The phase file you are working on in `phases/`
4. The docs that phase links to

## 2. Non-negotiable rules

Breaking any of these is a failed task, even if tests pass.

1. **One YouCam client.** Every YouCam path, payload and version lives in `packages/youcam-client`. No other package calls YouCam directly.
2. **Every YouCam call goes through the node lifecycle** (`docs/ARCHITECTURE.md`, "The node lifecycle"): cache check, quote and reserve, upload once, submit and persist `task_id` before waiting, settle, audit. No shortcuts, including in scripts.
3. **Never resubmit a running task.** A crashed worker resumes by polling the stored `task_id`. Resubmitting charges units again.
4. **Never hard-code unit costs.** Read them from the feature-cost endpoint through the ledger.
5. **Unretouched by default.** Every `makeup-vto` request sends `skin_smooth` at 0 unless the user explicitly opted in, and opt-in renders are labelled.
6. **No face or skin image ever goes to a language model.** Faces go only to YouCam. Models read text, product images and packaging.
7. **The model never types a number.** Agent output cites metric IDs; the renderer injects values. The linter rejects digits in model free text.
8. **Cosmetic language only.** No medical, diagnostic or treatment claims in UI copy, agent output, the README or the submission. The banned list and its scope are in `docs/COPY.md` §3, enforced by the claim linter in CI and at runtime.
9. **Images are temporary.** Delete every uploaded and generated image at the end of its run (Cloud Storage and YouCam delete-with-resources), unless the user saved that specific look.
10. **No silent states.** Every async action shows progress, every failure explains what happened and what to do next, every empty screen invites an action. See `docs/UX_FLOWS.md`.
11. **Mock mode always works.** `pnpm dev:mock` must run the whole product with zero credentials. A change that breaks mock mode is not done.
12. **Claims need evidence.** Any number or capability stated in the UI, README or demo must have a line in `docs/FACTS.md` pointing to the code or measurement behind it.

## 3. Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Web | Next.js (App Router), React, TypeScript strict, Tailwind CSS with design tokens as CSS variables, Radix primitives for accessible components |
| Agent and workflows | TypeScript on Node, Vercel AI SDK with Vertex providers, Zod for every schema |
| Engines | Python 3.12, FastAPI, numpy, colour-science, Pillow, MediaPipe (face box only), managed with uv |
| Cloud | Cloud Run, Cloud Tasks, Firestore, Cloud Storage, Pub/Sub, BigQuery, Cloud Scheduler, Secret Manager |
| Infra | Terraform in `infra/` |
| Tests | Vitest, Playwright, pytest, Hypothesis |

Versions: use the current stable release of each at setup and pin exact versions in lockfiles. Do not upgrade major versions mid-build without an entry in `docs/DECISIONS.md`. Verify package names and exports at install time; do not assume an API from memory.

## 4. Repository layout

```text
apps/web/              Next.js UI, JS Camera Kit capture, brand console
apps/agent/            Agent loop, tools, output schema, renderer, linter
apps/workflows/        Graph runner, node lifecycle, ledger, cache
apps/webhook/          YouCam callback receiver
services/engines/      Python measurement engines
packages/youcam-client/  Typed YouCam client (generated + hand-written lifecycle helpers)
packages/schemas/      Shared Zod schemas and TS types; JSON Schema exported for Python
packages/ui/           Design-system components and tokens
packages/fixtures/     Recorded real YouCam responses
packages/mira-mcp/     MIRA's own MCP server
skills/measured-shade-match/  Published YouCam-format Skill
infra/                 Terraform
docs/ phases/ assets/  Documentation and brand
```

## 5. Commands

| Command | Does |
| --- | --- |
| `pnpm dev:mock` | Whole product, recorded data, no credentials |
| `pnpm dev` | Whole product against live YouCam and Vertex (needs `.env.local`) |
| `pnpm test` | All unit tests (TS + Python) |
| `pnpm test:e2e` | Playwright against mock mode |
| `pnpm lint` | ESLint, Prettier check, ruff, mypy, claim linter |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm fixtures:record <feature>` | Records a real YouCam response into `packages/fixtures` (costs units; asks first) |
| `pnpm check` | lint + typecheck + test + e2e; must pass before any phase is marked done |

## 6. How to work

Work phase by phase, in order. Inside a phase, for each task:

1. Read the task, its acceptance criteria and the docs it links.
2. Write or update the schema in `packages/schemas` first if data shapes change.
3. Write the failing test.
4. Implement the smallest change that passes it.
5. Run `pnpm check`.
6. Update `docs/FACTS.md` if you added a claim, and `docs/DECISIONS.md` if you made a choice someone could question.
7. Tick the task's checkbox in the phase file.

Keep pull requests to one task or one tight group of tasks. Never mix a refactor with a feature.

## 7. Code conventions

**TypeScript**
- `strict: true`, no `any`, no non-null assertions except in tests.
- Validate every external input (HTTP, YouCam, model output, Firestore reads) with Zod at the boundary.
- Errors are typed results (`{ ok: true, value } | { ok: false, error }`) inside the workflow engine; throw only at process edges.
- File names in kebab-case; React components in PascalCase files.

**Python**
- Type hints everywhere, `mypy --strict` clean, ruff formatted.
- Engines are pure functions over arrays and numbers; I/O lives only in the FastAPI layer.
- Every formula has a docstring citing its source and a unit test with published reference values where they exist.

**Both**
- No magic numbers: thresholds live in `services/engines/mira_engines/config.py` or `packages/schemas/src/config.ts`, each with a comment saying where it came from and whether it is calibrated.
- Log with structured fields and the run's trace ID; never log images, image URLs, API keys or raw model prompts containing user data.

## 8. UI rules

- Use tokens from `packages/ui/tokens` only. No raw hex in components.
- Images of people and products always sit on the neutral mat (`--mira-mat`) defined in `docs/DESIGN_SYSTEM.md`. Never place a skin-tone image on a coloured background.
- Every screen implements all states listed for it in `docs/UX_FLOWS.md`. A screen missing a state is not done.
- Keyboard reachable, visible focus, `prefers-reduced-motion` respected, WCAG 2.2 AA contrast, screen-reader labels on every control.
- Copy comes from `docs/COPY.md` patterns. Sentence case. No apologies in errors.

## 9. Model rules

- Model IDs come from env vars only. Code must work with any provider set in `MIRA_MODEL_PROVIDER`.
- Every model call has a Zod output schema; invalid output gets one retry, then a templated fallback.
- Prompts live in `apps/agent/src/prompts/` as versioned files, not inline strings.
- The agent never calls YouCam MCP for multi-step work; it starts MIRA workflows.

## 10. Testing requirements

- Every engine function: unit tests plus property tests where a property exists (symmetry of ΔE, monotonicity, bounds).
- Every workflow: a test that runs it end to end on fixtures, including one failure path.
- Every screen: a Playwright test per state listed in `docs/UX_FLOWS.md`.
- Claim linter runs on UI copy files, the README and the Devpost description, with the scope rules in `docs/COPY.md` §3; agent answers are linted at runtime.

## 11. Git

- Branch: `phase-NN/short-task-name`.
- Commits: Conventional Commits (`feat(engines): add CIEDE2000`).
- Never commit `.env*` except `.env.example`, fixtures containing faces, or API responses containing signed URLs (scrub them; `pnpm fixtures:record` does this).

## 12. When you are unsure

1. Check `docs/YOUCAM_API.md` and the OpenAPI bundles before guessing any endpoint, field or version.
2. If the docs are silent, write a tiny probe script, run it once against the live API, record the response as a fixture, and add a line to `docs/FACTS.md`.
3. If a choice is a judgement call, pick the option that is more honest to the user, write it in `docs/DECISIONS.md`, and move on.
4. Never invent an API field, a unit cost, a statistic or a research claim.
