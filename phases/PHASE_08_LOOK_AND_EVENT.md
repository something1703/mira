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
- [ ] _(protocol written, not run: `experiments/chain-quality/`)_ **Chain quality:** run clothes → accessories → makeup → hair on 2 consented people; measure garment ΔE and identity drift after each step; decide the maximum chain length shown by default.
- [ ] _(protocol written, not run: `experiments/drape/`)_ **Drape garments:** test `cloth-v4` with sarees and lehengas (different `garment_category` values); record what works. If drape fails, Event Mode offers kurta, lehenga-choli and gown sets that do work, and says so.

### Workflow
- [x] Garment ingest from a product link: image → background removal → garment colour (engine) → catalogue item. _(a quoted run: `sod` then the engines' colour. Built and tested in mock mode; live, the page and picture fetch and the colour read have not been tried, F53. Product links, uploads and samples)_
- [x] Graph order: clothes (with garment audit) → accessories chained on the previous `results.url` (D12) → makeup (`skin_smooth: 0`, shades from look suggestions, lip audit) → hair → identity drift → background → video (only if all audits passed and the user kept video in the quote). _(accessories are shoes and a bag; jewellery needs a mask, F51. Gates: D39)_
- [ ] Withhold renders on identity drift; label drift on garment or lip; partial results with retry per step. _(withholding, labels and partial results are built and tested; retry rebuilds the whole look with a new quote rather than re-running one step, D39 (4))_
- [x] Saved looks copied to `saved/` storage; everything else deleted at run end.

### Look Studio
- [ ] Slots: Outfit, Shoes, Bag, Jewellery, Makeup, Hair, Venue, Motion; makeup and hair suggestions with "why" text rendered from engine reason codes. _(open: Jewellery is shown unavailable (F51), and there is a makeup suggestion with its reason but no hair suggestion, which the engines do not make)_
- [x] Every state in UX_FLOWS §6; plate updates after each verified step; per-element fidelity labels on the final plate. _(empty, slots filled, quote ready, building, garment drift, identity drift, video generating, done, saved; plus partial, failed and expired)_
- [x] Venue presets discovered through the agent's `list_backgrounds` tool. _(the same discovery path; no live MCP call yet, F47. Written venues are always offered)_

### Event Mode
- [x] Event setup with editable functions (default suggestions for a wedding: haldi, mehendi, sangeet, wedding, reception), time of day and venue type per function.
- [x] Each function opens Look Studio pre-filled; overview board on the mat with every look; download board as an image. _(pre-filled with its name and venue type; the "skin-prep Proof timeline aligned to the event date" of UX_FLOWS §7 waits for Phase 9)_
- [x] Every state in UX_FLOWS §7. _(setup, planning, partially planned, overview; the Proof timeline in Overview waits for Phase 9)_

## Tests

- Workflow tests on fixtures: full chain, garment drift, identity drift withholding, video skipped when an audit fails, cancellation mid-chain.
- Playwright for every Look Studio and Event Mode state.

## Definition of done

- [ ] Both experiments recorded honestly in `experiments/*/RESULTS.md` and `docs/FACTS.md`. _(protocols and estimates written, 216 and 128 units, F55; not run: they need consenting people and a go-ahead)_
- [ ] A complete sangeet look built live, with every fidelity label shown. _(built end to end in mock mode; live needs the deploy, a consenting person, the face model file (F52) and units)_
- [x] Every state implemented and tested.

## Demo moment

The sangeet look assembling step by step, a drift label catching one step, and the final look turning in its venue.
