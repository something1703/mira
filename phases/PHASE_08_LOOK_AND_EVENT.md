# Phase 8 — Complete Look and Event Mode

**Goal:** beauty and fashion as one verified look, in context and in motion, and several looks planned for one multi-day event.

**Depends on:** Phases 5, 6, 7. **Read first:** `docs/UX_FLOWS.md` §6–7, `docs/ENGINES.md` §5–7, `docs/ARCHITECTURE.md` §4.3.

## Deliverables

| Path | What |
| --- | --- |
| `apps/workflows/src/graphs/compose-look.ts` | Compose Look graph |
| `apps/workflows/src/graphs/catalogue-ingest-lite.ts` | Garment ingest from product links (background removal + garment colour) |
| `apps/web/app/look/` | Look Studio |
| `apps/web/app/event/` | Event Mode |
| `experiments/chain-quality/`, `experiments/drape/` | Chain-quality and drape-garment experiments |

## Tasks

### Experiments first
- [ ] **Chain quality:** run clothes → accessories → makeup → hair on 2 consented people; measure garment ΔE and identity drift after each step; decide the maximum chain length shown by default.
- [ ] **Drape garments:** test `cloth-v4` with sarees and lehengas (different `garment_category` values); record what works. If drape fails, Event Mode offers kurta, lehenga-choli and gown sets that do work, and says so.

### Workflow
- [ ] Garment ingest from a product link: image → background removal → garment colour (engine) → catalogue item.
- [ ] Graph order: clothes (with garment audit) → accessories chained on the previous `results.url` (D12) → makeup (`skin_smooth: 0`, shades from look suggestions, lip audit) → hair → identity drift → background → video (only if all audits passed and the user kept video in the quote).
- [ ] Withhold renders on identity drift; label drift on garment or lip; partial results with retry per step.
- [ ] Saved looks copied to `saved/` storage; everything else deleted at run end.

### Look Studio
- [ ] Slots: Outfit, Shoes, Bag, Jewellery, Makeup, Hair, Venue, Motion; makeup and hair suggestions with "why" text rendered from engine reason codes.
- [ ] Every state in UX_FLOWS §6; plate updates after each verified step; per-element fidelity labels on the final plate.
- [ ] Venue presets discovered through the agent's `list_backgrounds` tool.

### Event Mode
- [ ] Event setup with editable functions (default suggestions for a wedding: haldi, mehendi, sangeet, wedding, reception), time of day and venue type per function.
- [ ] Each function opens Look Studio pre-filled; overview board on the mat with every look; download board as an image.
- [ ] Every state in UX_FLOWS §7.

## Tests

- Workflow tests on fixtures: full chain, garment drift, identity drift withholding, video skipped when an audit fails, cancellation mid-chain.
- Playwright for every Look Studio and Event Mode state.

## Definition of done

- [ ] Both experiments recorded honestly in `experiments/*/RESULTS.md` and `docs/FACTS.md`.
- [ ] A complete sangeet look built live, with every fidelity label shown.
- [ ] Every state implemented and tested.

## Demo moment

The sangeet look assembling step by step, a drift label catching one step, and the final look turning in its venue.
