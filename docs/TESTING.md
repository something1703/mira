# Testing

`pnpm check` runs everything below and must pass before a phase is marked done.

| Layer | Tool | What is tested |
| --- | --- | --- |
| Engines | pytest + Hypothesis | ΔE2000 against the 34 Sharma reference pairs; colour conversions against published values; ΔE properties; noise-floor maths on synthetic data with known variance; phantom fit; auditor on synthetic images with known edits |
| Schemas | Vitest | Zod round-trips; JSON Schema export matches Python models |
| YouCam client | Vitest + fixtures | Every request builder against recorded requests; every response parser against recorded responses; error mapping for every documented error code |
| Lifecycle | Vitest with fake clock and fake Firestore | Cache hit, over budget, crash after submit (must poll, never resubmit), webhook vs poll, error releases units, audit runs before emit |
| Workflows | Vitest, end to end on fixtures | Each workflow's happy path and at least one failure path; partial fan-out |
| Agent | `pnpm eval:agent` | Scripted conversations (see `AGENT_RUNTIME.md` §9) |
| Claim linter | Vitest | Banned stems caught; allowed cosmetic phrases pass |
| UI | Playwright against mock mode | One test per state in `docs/UX_FLOWS.md`; axe accessibility scan per screen; keyboard-only path through capture → shade → look |
| Visual | Playwright screenshots | Light and dark themes for each screen; reviewed when changed |
| Contrast | Vitest | Every text/background token pair meets WCAG AA |

## Mock mode

`packages/youcam-client/mock` replays fixtures keyed by feature + params hash, with recorded latencies (scaled down 4× by default) so progress UI is exercised. The agent stub replays recorded model outputs keyed by conversation script.

## Live smoke test

`pnpm smoke:live` runs one tiny job per feature with the lowest-cost parameters, after printing the total unit quote and asking for confirmation. Use it after any client change, never in CI.
