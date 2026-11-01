# Build phases

Ten phases, each independently demoable. Work in order; Phases 2–4 can run in parallel once Phase 1 is done.

| Phase | File | Builds | Depends on |
| --- | --- | --- | --- |
| 1 | `PHASE_01_FOUNDATION.md` | Monorepo, CI, Google Cloud infra, mock mode, claim linter | — |
| 2 | `PHASE_02_DESIGN_SYSTEM.md` | Tokens, every component and state, the Ring, Welcome and Consent | 1 |
| 3 | `PHASE_03_YOUCAM_CLIENT_AND_LIFECYCLE.md` | Typed YouCam client, node lifecycle, ledger, cache, runner, run viewer | 1 |
| 4 | `PHASE_04_ENGINES.md` | Colour, ΔE2000, shade, look, garment, audit, statistics, phantom | 1 |
| 5 | `PHASE_05_CAPTURE_AND_TWIN.md` | Ring-guided capture, Build Twin, profile, privacy | 2, 3, 4 |
| 6 | `PHASE_06_SHADE.md` | Closed-loop foundation matching | 5 |
| 7 | `PHASE_07_AGENT.md` | Ask MIRA: plan, quote, confirm, narrate | 3, 5, 6 |
| 8 | `PHASE_08_LOOK_AND_EVENT.md` | Complete Look, Event Mode | 5, 6, 7 |
| 9 | `PHASE_09_PROOF.md` | Noise floor, phantom, check-ins, verdicts | 5, 7 |
| 10 | `PHASE_10_BRAND_PLATFORM_AND_LAUNCH.md` | Brand console, MIRA MCP, Skill, hardening, submission | 6, 8, 9 |

Every phase file has: goal, dependencies, docs to read, deliverables, tasks with acceptance criteria, tests, definition of done, and the demo moment to show when it is finished. A phase is done only when `pnpm check` passes and every checkbox in its definition of done is ticked.
