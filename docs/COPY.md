# Copy

Words in MIRA have one job each: help a person understand what was measured and what to do next. Sentence case, active voice, no filler, no apologies, no flattery.

## 1. Vocabulary (use these words, consistently)

| Concept | Say | Never say |
| --- | --- | --- |
| The user's profile | your measured profile | your face data, biometrics |
| A YouCam render | preview | photo of you, result image |
| Render was checked | verified | approved, guaranteed |
| Render drifted | colour drifted / changed from the product | glitch, error image |
| Measurement noise | your day-to-day variation | error margin (in UI) |
| No detectable change | no change we can tell apart from day-to-day variation yet | it is not working |
| Skin concern | what the scan measured (e.g. visible pores) | problem area, flaw, imperfection |
| Units | units | credits, tokens, coins |
| Recorded run | recorded run | demo data, fake |

## 2. Patterns

**Buttons** name the action: "Start measuring", "Match my shade", "Build this look", "Check my progress", "Delete my profile". The resulting toast reuses the verb: "Shade matched", "Look built", "Profile deleted".

**Progress** names the current step in plain words: "Measuring your skin", "Trying on the lehenga", "Checking the lip colour matches the product".

**Errors** state what happened, why if known, and what to do. No "Oops", no "Sorry".
- "The photo is too dark to measure. Face a window or a lamp and try again."
- "Your face needs to fill more of the circle. Move a little closer."
- "This preview changed your face shape, so MIRA did not show it. Try again or skip this step."
- "This look would use {units_needed} units and you have {units_left} left in this session. Remove the video or start a new session."

**Empty states** invite one action.
- "No looks yet. Pick an outfit to build your first one."
- "You have not started a progress check. Add a product you are using."

**Verdicts** (Proof) are one sentence, then evidence.
- Detected: "Visible pores changed more than your day-to-day variation."
- Not yet: "No change we can tell apart from your day-to-day variation yet. You are on day {day} of a {window}-day claim."

**Fidelity labels**
- "Verified: lip colour within ΔE {de} of the product."
- "Colour drifted: the garment reads lighter than the product photo. Check before buying."
- "Visualisation of your measured change, rendered on your first photo."

## 3. Banned language (enforced by the claim linter)

The linter (`packages/schemas/src/claim-linter.ts`) fails CI if any of these appear in UI copy, agent output, the README or the Devpost description, and rejects them at runtime in agent answers. Matching is case-insensitive on word stems.

Scope exceptions:
- **The disclaimer.** The exact sentence "MIRA is a cosmetic and appearance tool. It does not diagnose, treat or give medical advice." is allowlisted wherever it appears.
- **Prompts and refusal templates** (`apps/agent/src/prompts/`, `apps/agent/src/fallbacks.ts`) are not linted for these stems, because they must name what to refuse. They are reviewed by hand and covered by the agent evals instead.

**Medical and treatment:** diagnose, diagnosis, treat, treatment, cure, heal, therapy, therapeutic, prescription, prescribe, medical, medicine, clinical, clinically proven, dermatologist-approved, disease, disorder, condition (when describing skin), infection, inflammation, eczema, rosacea, psoriasis, melasma, dermatitis, lesion, symptom.

**Judging bodies:** flaw, flawless, imperfection, problem area, fix your, correct your, anti-ageing, perfect skin, ugly, bad skin, good skin, better-looking, attractive.

**False certainty:** guaranteed, 100%, proven to, always works, scientifically proven.

Allowed cosmetic framing: "appearance of", "visible", "looks", "reads as", "the scan measured".

## 4. Inclusive language

- Skin tone is described by measurement (lightness, undertone, Fitzpatrick type as measured), never by race or ethnicity.
- Never imply a lighter or darker tone is a goal.
- Fitzpatrick type is presented as a measurement band with its limits, never as an identity.

## 5. Numbers in copy

Copy strings use named placeholders (`{units_left}`, `{de}`, `{day}`); the renderer fills them from metrics.


- Numbers in the UI come from the renderer, never typed into copy strings by hand.
- Every number has a unit and, where it is a measurement, its confidence words ("within your day-to-day variation", "above it").
