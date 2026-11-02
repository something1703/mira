# Measurement engines

All maths lives in `services/engines` (Python). Engines are pure functions; FastAPI only adapts them to HTTP. Every threshold is in `mira_engines/config.py` with its source and a `calibrated: bool` flag. Uncalibrated thresholds are starting values, and the UI never presents them as scientific cut-offs.

## 1. Colour pipeline

1. Input: sRGB hex or 8-bit RGB pixels.
2. sRGB → linear RGB (IEC 61966-2-1 transfer function).
3. Linear RGB → CIE XYZ (D65).
4. XYZ → CIELAB (D65, 2° observer). Derived: chroma C*ab = √(a*² + b*²), hue angle h_ab = atan2(b*, a*) in degrees, 0–360.

Use `colour-science` for the conversions; tests compare against published reference values.

## 2. ΔE2000

CIEDE2000 with kL = kC = kH = 1, implemented per Sharma, Wu and Dalal (2005), "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations".

Tests:
- All 34 reference pairs from that paper's supplementary data, to 4 decimal places.
- Properties (Hypothesis): ΔE(a, a) = 0; ΔE(a, b) = ΔE(b, a); ΔE ≥ 0.
- Vectorised version for per-pixel use; must equal the scalar version on random samples.

## 3. Skin-colour descriptors

- **ITA°** (individual typology angle) = arctan((L* − 50) / b*) × 180 / π. Reported as a number with the Chardon et al. (1991) band names (very light > 55°, light 41–55°, intermediate 28–41°, tan 10–28°, brown −30–10°, dark < −30°). ITA is a colour metric, never an identity.
- **Relative undertone** is only ever reported relative to something ("this shade reads warmer than your skin"), from the difference in h_ab. MIRA does not assign absolute "warm/cool/neutral" labels; that classification is not standardised.

## 4. Shade matching

### 4.1 Pre-rank (zero units)

For each catalogue shade s with Lab_s, and measured skin Lab_k (from `skin-tone-analysis`):

- score(s) = ΔE00(Lab_s, Lab_k)
- tie-break by |Δh_ab|, then by |ΔL*|
- render only the top `SHADE_RENDER_TOP_N` (default 3, max 5)

Labels (starting values, `calibrated: False` until Phase 6's experiment):

| ΔE00 | Label |
| --- | --- |
| ≤ `MATCH_DE` (2.0) | blends closely |
| ≤ `CLOSE_DE` (3.5) | close |
| above | reads lighter / darker / warmer / cooler (from the signed differences) |

### 4.2 Closed-loop check

After `makeup-vto` renders shade s with `skin_smooth: 0`:

1. Re-measure the render with `skin-tone-analysis` → Lab_r.
2. **Blend** = ΔE00(Lab_r, Lab_k): how much the foundation changed the skin's colour. Lower is a closer match. This, not the catalogue hex, ranks the final results.
3. **Direction check**: the signs of ΔL* and Δb* between Lab_r and Lab_k should agree with the signs between Lab_s and Lab_k. If not, the render is labelled "not checked".
4. The engine labels the blend on the same lines as the pre-rank (`blends_closely` at or below `MATCH_DE`, `close` at or below `CLOSE_DE`, else `not_close`), so callers never compare against a threshold of their own.

### 4.3 Finish and coverage

| Measured input | Rule |
| --- | --- |
| `hd_skin_type.whole` oily | finish: matte or satin |
| dry | finish: dewy |
| combination | finish: satin; note T-zone vs U-zone |
| Lowest raw_score among acne, age_spot, redness below `COVERAGE_RAISE` | coverage: medium |
| otherwise | coverage: light |

These are style rules, shown as "why MIRA suggested this", never as skin advice. Map to `makeup-vto` foundation parameters after confirming their ranges in the schema.

## 5. Look colour suggestions

Inputs: garment Lab_g, skin Lab_k, lip Lab_l, hair Lab_h. Personal contrast = |L*_h − L*_k|.

- **Lip**: candidates from the product catalogue; prefer hue within ±30° of either the garment hue or the natural lip hue; prefer lightness contrast against skin that matches personal contrast (high contrast → deeper lip allowed).
- **Blush**: hue within ±20° of the chosen lip; chroma below the lip's.
- Output includes the rule that fired, rendered as the "why" text.

These are documented heuristics, labelled "suggestion" in the UI.

## 6. Garment colour from a product image

1. Background removed (YouCam) → RGBA.
2. Keep pixels with alpha > 0.9; convert to Lab.
3. k-means with k = 3 in Lab (fixed seed).
4. Garment colour = centroid of the largest cluster. If that cluster holds < 50% of pixels, mark the garment "multicolour" and audit against the top two clusters.

## 7. Render Auditor

### 7.1 Garment colour

1. Face box from MediaPipe face detection on the source image (no model sees the face beyond this local detector).
2. Torso region: x from face centre ± 1.2 × face width; y from chin + 0.4 × face height to chin + 2.0 × face height; clipped to the image.
3. Changed mask: per-pixel ΔE00(source, render) > `CHANGED_PX_DE` (8).
4. If the changed share of the torso region < `MIN_CHANGED_SHARE` (0.15) → label "not checked: the preview may still show the original clothing" (the failure ShadeSpan documented).
5. Else garment_render = median Lab of changed torso pixels; ΔE00(garment_render, garment_catalogue):
   - ≤ `GARMENT_VERIFY_DE` (6.0) → verified
   - above → drift, with the direction ("reads lighter")

Thresholds are deliberately loose because try-on applies scene lighting; tighten after Phase 8's measurements.

### 7.2 Lip and foundation

Re-run `skin-tone-analysis` on the render. Lip: ΔE00(lip_render, lip_intended) ≤ `LIP_VERIFY_DE` (3.0) → verified. Foundation: §4.2.

### 7.3 Identity drift

Face Attributes ratio vector r (source) and r′ (final). drift = maxᵢ |rᵢ − r′ᵢ| / rᵢ. Above `IDENTITY_DRIFT_MAX` (0.08) → withhold the render. Calibrate the threshold from repeated analyses of the same unedited photo (ratios drift slightly between runs).

## 8. Noise floor and change detection (Proof)

Data: sessions j = 1…n, each with k captures (default 3) of concern c, using `raw_score`.

- Session mean mⱼ; within-session variance s_w² = pooled variance of captures around their session means.
- Between-day variance s_d² = max(0, var(mⱼ) − s_w² / k), estimated once n ≥ 3; before that, s_d = `PRIOR_SD_DAY[c]` (from the team's pilot captures, documented in FACTS.md).
- Error of one session mean: SE = √(s_d² + s_w² / k).
- **Minimal detectable change** (95%): MDC = 1.96 × √2 × SE.
- Change Δ = m_now − m_baseline (baseline = mean of the first three sessions).

| Result | Words shown |
| --- | --- |
| \|Δ\| < MDC | within your day-to-day variation |
| MDC ≤ \|Δ\| < 2 × MDC | a small change above your day-to-day variation |
| \|Δ\| ≥ 2 × MDC | a clear change |
| direction opposite to the claim | changed, but not in the direction the product claims |

Per-band reliability: MDC is also aggregated (anonymised) by measured Fitzpatrick band. Where a band's typical MDC is larger, confidence words are lowered and the UI says why.

## 9. Calibration phantom (Proof)

1. Source: the person's day-0 photo. Concern c.
2. Skin Simulation at intensities [0, 0.25, 0.5, 0.75, 1.0] for c only.
3. Skin Analysis on each output → raw scores y₀…y₄.
4. Spearman ρ between intensity and y. Usable if ρ ≥ `PHANTOM_MIN_RHO` (0.9) and (max y − min y) > MDC.
5. Fit isotonic regression intensity → Δscore.
6. Uses: (a) "the claim on your face": invert the curve at the claim's stated improvement, render, label as visualisation; (b) "your progress": invert at the measured Δ, render on the day-0 photo.
7. If not usable: numbers only, with the reason.

## 10. Engine API

| Endpoint | Input | Output |
| --- | --- | --- |
| `POST /colour/lab` | hex list | Lab, LCh, ITA |
| `POST /colour/de2000` | pairs of Lab | ΔE list |
| `POST /shade/prerank` | skin Lab, catalogue | ranked list with labels |
| `POST /shade/closed-loop` | skin Lab, shade Lab, render Lab | blend ΔE, direction check |
| `POST /look/suggest` | twin colours, garment Lab, catalogue | lip, blush with reasons |
| `POST /garment/colour` | RGBA image ref | Lab, multicolour flag |
| `POST /audit/garment` | source ref, render ref, garment Lab | label, ΔE, direction, changed share |
| `POST /audit/identity` | ratio vectors | drift, pass |
| `POST /stats/noise-floor` | sessions | s_w, s_d, SE, MDC |
| `POST /stats/change` | baseline, now, MDC, claim direction | Δ, words |
| `POST /phantom/fit` | intensities, scores, MDC | usable, ρ, curve |

Every response includes `engine_version` and the config values used, so results are reproducible.
