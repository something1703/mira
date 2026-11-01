# Facts ledger

Every number or capability claimed in the UI, README, Devpost description or demo video has a row here. If a claim has no row, remove the claim. `R` = `docs/research/youcam-api-2026-11-01.md` (sources per line there); `B:<name>` = `packages/youcam-client/openapi/<name>.yaml`.

| # | Claim | Evidence (code path, fixture, measurement or source URL) | Date checked | Status |
| --- | --- | --- | --- | --- |
| F1 | `makeup-vto` applies skin smoothing 50 when no `skin_smooth` effect is sent | B:makeup_vto; YouCam Skills `beauty-advisor/scripts/api-fallback.yaml`; R §6 | 2026-11-01 | Source read; confirm with a live render in Phase 6 |
| F2 | Skin Analysis HD with 5–8 concerns costs 16 units | B:ai_skin_analysis, Unit Consumption (V2.0 and V2.1) | 2026-11-01 | Source read; live quotes read feature-cost |
| F3 | Units are consumed only on task success | B:ai_skin_analysis Integration Guide step 6; R §3 | 2026-11-01 | Source read |
| F4 | Result download URLs last 2 hours; task results are queryable for at least 24 hours (docs conflict: 24 h vs 30 days) | docs.perfectcorp.com/develop/file_retention_period vs every bundle's run response; R §3 | 2026-11-01 | Source read (corrected from "retained for 24 hours") |
| F5 | `ui_score` is adjusted upwards for positivity; `raw_score` is not | B:ai_skin_analysis, Inputs & Outputs | 2026-11-01 | Source read |
| F6 | One clothes try-on costs 2 units (V2, V3); V4 cost not published | B:ai_clothes Unit Consumption; ShadeSpan and CASTING write-ups | 2026-11-01 | Source read for V2/V3; V4 from feature-cost |
| F7 | MIRA re-measures every render before showing it | `apps/workflows/src/lifecycle/audit.ts` | — | To build |
| F8 | Shade match blend accuracy | Phase 6 experiment results | — | To measure |
| F9 | Typical day-to-day variation per concern | Phase 9 pilot captures | — | To measure |
| F10 | Facial Color Tones returns colours as hex only (no Lab); hair colour is one of 7 fixed values; costs 20 units | B:ai_skin_tone_analysis; R §6 | 2026-11-01 | Source read |
| F11 | YouCam rate limit: 250 requests per 300 s per IP and per key | docs.perfectcorp.com/develop/rate_limit; R §8 | 2026-11-01 | Source read |
| F12 | Webhooks are console-configured and signed with Standard Webhooks HMAC-SHA256 | docs.perfectcorp.com/develop/webhook; R §4 | 2026-11-01 | Source read |
| F13 | Camera Kit `videoQuality` is ignored in `comprehensive` mode | Camera Kit sdk.js v2.5 (`isSkincareCheckerMode() \|\| isHdSkincareCheckerMode()`); R §6 | 2026-11-01 | Source read |
| F14 | Delete-with-resources removes a task's inputs and outputs; it fails while the task runs | B:task_management; R §3 | 2026-11-01 | Source read |
| F15 | Image-to-video costs 1/2/3 units per second at 480/720/1080p | B:ai_video_generator Unit Consumption | 2026-11-01 | Source read |
| F16 | YouCam documents a single API server, `yce-api-01.makeupar.com`; no regional or India host | docs.perfectcorp.com/develop/api_server and every bundle's `servers`; R §1 | 2026-11-01 | Source read |
| F17 | CIEDE2000 matches all 34 Sharma, Wu and Dalal (2005) reference pairs to 4 decimals, and an independent `colour-science` implementation | `services/engines/tests/data/sharma_2005.csv`, `tests/test_colour.py` | 2026-11-01 | Built |
| F18 | Noise-floor MDC averages within 10% of the analytic value over 1,000 simulated seeds (12 sessions × 3 captures) | `services/engines/tests/test_stats.py` | 2026-11-01 | Built |
| F19 | Every UI text and non-text colour pair meets WCAG 2.2 AA in both themes; axe finds no violations on Welcome, Consent and the component gallery in light, dark and mobile | `packages/ui/tests/contrast.test.ts`, `apps/web/e2e/*.spec.ts` | 2026-11-01 | Built |
| F20 | Skin-analysis and video prices are selected from feature-cost SKU descriptions ("SD 5~7 concerns", "720") | `packages/youcam-client/src/pricing.ts`; selectors fail closed | 2026-11-01 | To measure: confirm the real descriptions on the first live feature-cost read |
| F21 | A crash after submit resumes polling the stored task and never creates a second task; a failed task releases its reserved units | `apps/workflows/tests/lifecycle.test.ts` ("crash and resume", "errors") | 2026-11-01 | Built (against a test double; confirm with a live probe) |
| F22 | Images and YouCam tasks are deleted at the end of every run, images first | `apps/workflows/src/runner/cleanup.ts`, `tests/lifecycle.test.ts` ("cleanup") | 2026-11-01 | Built (blob store and YouCam double; confirm live) |
| F23 | The webhook receiver verifies Standard Webhooks signatures, including the specification's reference vector | `apps/webhook/tests/webhook.test.ts` | 2026-11-01 | Built (confirm with a real YouCam callback) |

Add rows as you build. Status values: Source read, Measured, Built, To build, To measure, Withdrawn.
