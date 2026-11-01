# YouCam API reference for MIRA

This file records what MIRA relies on from Perfect Corp's YouCam API and what earlier projects learned the hard way. **Source of truth: docs.perfectcorp.com and its OpenAPI bundles**, saved unmodified in `packages/youcam-client/openapi/` (docs v1.17, downloaded 2026-11-01; URLs in `SOURCES.md` there). The full research with a source for every line is `docs/research/youcam-api-2026-11-01.md`. Anything marked _confirm_ is still open and must be settled by a live probe recorded in `docs/FACTS.md` before code depends on it.

## 1. Basics

- **Auth:** `Authorization: Bearer <YOUCAM_API_KEY>`, server-side only (MIRA policy; the docs also allow client use). 401 bodies vary by feature: `{"error":"Invalid API key"}` or `error_code` ∈ `InvalidApiKey`, `InactiveApiKey`, `ExpiredApiKey`.
- **Base URL:** `https://yce-api-01.makeupar.com`. The docs list exactly one API server, with no regional hosts. Sample upload and result URLs point at US S3 buckets. The hackathon page's "India link" could not be inspected (Devpost returned 403) and is probably a sign-up link, not an API host _(confirm with the organisers)_.
- **Everything is asynchronous:**
  1. **Register the file.** `POST /s2s/v2.0/file`, the universal file endpoint for images and video, with body `{"files":[{"content_type","file_name","file_size"}]}`. The response is `data.files[0]` = `{file_id, requests:[{method:"PUT", url, headers}]}`.
  2. **Upload the bytes.** `PUT` the raw bytes to `requests[0].url` with **exactly** `requests[0].headers`. Registering alone does not upload; skipping the PUT produces 404 or 500 (`unknown_internal_error`) later.
  3. **Create the task.** `POST /s2s/v{ver}/task/{feature}` with `src_file_id` (or `src_file_url`, a public URL) returns `data.task_id`. **The version is per feature** (skin-analysis and hair-transfer are v2.1; the rest v2.0).
  4. **Wait for the result.** Poll `GET /s2s/v{ver}/task/{feature}/{task_id}` → `data.task_status` ∈ `running | success | error`, or receive a webhook (§1.1).
  5. **On `success`:** `data.results.url` (or `results.output[]` for multi-output and JSON features). **Result URLs are valid for 2 hours.**
- **Chaining:**
  - Prose in four bundles mentions a `dst_id` for chaining without re-upload, but **no schema defines `dst_id` and no request accepts it** _(confirm with a live response)_.
  - Until confirmed, MIRA chains by passing the previous `results.url` as the next task's `src_file_url` while it is still valid. Otherwise it re-uploads the stored copy.
- **Units are consumed only on success.** Polling, failed tasks, pre-process tasks and template listings are free. The units nearest expiry are deducted first.
- **Retention (the official pages conflict):**
  - The File Retention page says `file_id` and `task_id` last 30 days and download URLs 2 hours.
  - The bundles and the Skin Analysis guide say task results are queryable for 24 hours.
  - **MIRA's rule:** download what it needs within 2 h, treat a `task_id` as unusable after 24 h, and delete the task at the end of every run.
- **Delete with resources:**
  - Call `POST /s2s/v2.0/task/delete` with body `{"task_id"}`. It removes the task's input files and generated outputs.
  - It fails with `400 OperationInvalid` while the task is still running, so MIRA deletes only settled tasks and retries the delete for any that were running at cancellation.
- **Credit balance:**
  - `GET /s2s/v1.0/client/credit` returns `results[] = {id, type: ApiSubsToken|ApiPaygToken, amount (deprecated), amount_dec, expiry}`.
  - Use `amount_dec`, summed over unexpired entries.
  - IDs can exceed 2^53; parse them as strings.
- **Feature cost:** `GET /s2s/v2.0/credit/feature-cost?page_size≤20&starting_token=` (free, paged) returns `result.skus[] = {description, amount, unit: result_image|second, proc_unit, run_task_url}`. Map an SKU to a feature by the path after `/task/` in `run_task_url`. **This endpoint is the only price source** (AGENTS.md §2.4); the unit numbers below are for planning only.
- **Rate limit:**
  - 250 requests per 300 s per IP **and** per API key (about 0.83 rps sustained, 5 QPS bursts); over that returns `429 {"error":"Too many requests"}`.
  - **Every poll counts**, so the Cloud Tasks queues share one budget below this.
  - No concurrency limit on running tasks is documented _(confirm)_.

### 1.1 Webhooks

- **Configured once in the API console** (up to 10 HTTPS endpoints), not per request. No request field takes a callback URL.
- **Standard Webhooks signing:**
  - Headers: `webhook-id` (stable across retries, used for idempotency), `webhook-timestamp` (Unix seconds), `webhook-signature: v1,<base64>`.
  - The secret is `whsec_<base64 key>`.
  - Signature: HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}`.
  - `mira-webhook` verifies this, rejects stale timestamps, and checks that the `task_id` exists in Firestore before acting.
- **Payload:** `{"created_at", "data": {"task_id", "task_status": "success"|"error"}}`. It contains no result, so the workflow still GETs the task.
- **Not documented:** which features emit webhooks, the retry policy, and the source IPs _(confirm)_. MIRA therefore always schedules a fallback poll, and the webhook only makes it sooner.

## 2. Features MIRA uses

Paths are under `https://yce-api-01.makeupar.com`. "Units" are from each bundle's Unit Consumption table, so live quotes still read §1's feature-cost endpoint.

| Feature | Create path | Key request fields | Units | Result |
| --- | --- | --- | --- | --- |
| AI Skin Analysis | `POST /s2s/v2.1/task/skin-analysis` | `dst_actions[]`, all SD or all HD; `format: "json"` | SD/HD by concern count: 1–4 → 9/12, 5–8 → 12/16, 9–12 → 14/20, 13–16 → 16/22 | `results.output[]`: `{type, region, raw_score, ui_score, mask_urls[]}`, plus `skin_age` and `all` |
| Facial Color Tones Analyzer | `POST /s2s/v2.0/task/skin-tone-analysis` | `face_angle_strictness_level`: strict, **high** (default), medium, low, flexible | 20 | `results.face_quality` and `results.color{skin_color, lip_color, eyebrow_color, eye_color, eye_color_name, hair_color, hair_color_name}`. **Hex only** (MIRA converts to Lab); `hair_color` is one of 7 fixed hexes |
| Fitzpatrick | `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer` | **`version: "1.0"` required**; `index`; optional free pre-process | 10 | `results.fitzpatrick_scale` ∈ I–VI |
| Face Attributes & Ratio | `POST /s2s/v2.0/task/face-attr-analysis` | `features[]` from 31 names (e.g. `faceAspectRatio`, `horizontalThird`, `verticalFifth`, `eyeAspectRatio`, `noseAspectRatio`, `noseWidthToMouthWidth`, `noseToLipToChin`, `upperLipToLowerLip`) | 1–5 features 10; 6–14 20; 15–28 30 | `facialratio{...}`, shapes, colours (hex), `agegender`. Ratios drift slightly between runs (YouCam Skills) |
| Hair type | `POST /s2s/v2.0/task/hair-type-detection` | **3 photos** `src_file_ids[3]`: front, right, left, same size | 2 | `results.hair_type{mapping, term}` |
| Hair density | `POST /s2s/v2.0/task/hair-density-detection` | one photo | 1 | `results.hair_density{mapping 0–3, term}` |
| Hair length | `POST /s2s/v2.0/task/hair-length-detection` | one photo | 2 | `results.hair_length.term` |
| Hair frizziness | `POST /s2s/v2.0/task/hair-frizziness-detection` | **3 photos** front, right, left | 2 | `results.hair_frizziness{mapping 0–3, term}` |
| AI Skin Simulation | `POST /s2s/v2.0/task/skin-simulation` | 0–1 each: `wrinkle, radiance, oiliness, acne, eye_bags, dark_circle, spots, pores, texture, redness` (note the plurals) | 1–4 concerns 4; 5–10 6 | `results.url` |
| AI Makeup VTO | `POST /s2s/v2.0/task/makeup-vto` | `effects[]`; categories `skin_smooth, foundation, concealer, lip_color, blush, bronzer, contour, eyebrows, eye_liner, eye_shadow, eyelashes, highlighter, lip_liner`. Input long side < 1920 | 1 | `results.url` |
| AI Look VTO | `POST /s2s/v2.0/task/look-vto` | `template_id` from `GET /s2s/v2.0/task/template/look-vto` (free) | 2 | `results.url` |
| AI Clothes VTO | `POST /s2s/v2.0/task/cloth-v4` (also `cloth` V2, `cloth-v3` V3, **all under `/s2s/v2.0/`**) | `ref_file_id`; `garment_category` ∈ `upper_body, lower_body, full_body, shoes, auto, outer` (`outer` is v4 only); `change_shoes`; `filter_multi_person` (v4) | V2/V3 2; **V4 not listed** _(confirm with feature-cost)_ | `results.url` |
| Bag, hat, scarf | `POST /s2s/v2.0/task/{bag,hat,scarf}` | ref file + **`gender` required**; hat and scarf `style` also restyles **outfit and background** | 2 | `results.url` |
| Shoes | `POST /s2s/v2.0/task/shoes-transfer` (V3; ref only) or `shoes` (V2; `gender`, `style`) | — | 2 | `results.url` |
| Earrings, necklace, ring, bracelet, watch | `POST /s2s/v2.0/task/2d-vto/{earring,necklace,ring,bracelet,watch}` | `ref_file_ids[]`, `source_info{name, mask_name}`, `object_infos[{name, mask_name, parameter}]` | 1 (2 when stacked) | `results.url`. Errors are UPPER_CASE (`OBJECT_DETECTION_FAIL`, …) |
| AI Fabric VTO | `POST /s2s/v2.0/task/fabric` | `template_id` (`GET /s2s/v2.0/task/template/fabric`); jpg only | 2 | `results.url` |
| Hair colour | `POST /s2s/v2.0/task/hair-color` | `preset` (20 names), or `pattern{full|ombre}` + `palettes[1..2]{color, color_intensity, shine_intensity}`; input < 1920 × 1080 | 1 | `results.url` |
| Hair style | `POST /s2s/v2.1/task/hair-transfer` | exactly one of `ref_file_id` / `template_id` (`GET /s2s/v2.1/task/template/hair-transfer`); `hair_color: ref|src` | 2 | `results.url` |
| Background change | `POST /s2s/v2.0/task/bg-replace` | `type: prompt|template`, `prompt`, `template_id` | 4 | `results.url` |
| Image-to-video | `POST /s2s/v2.0/task/image-to-video/youcam` | `resolution` 480/720/1080, `dst_duration` 5/10, `prompt` (YouCam enhances prompts through Gemini; MIRA sends venue and motion text only) | 1/2/3 units per second at 480/720/1080p → 5–30 per clip | `results.url` (video). **Costliest step; run last** |
| Background removal | `POST /s2s/v2.0/task/sod` | one image, long side ≤ 4096 | 1 | `results.url` |

### 2.1 Makeup VTO effects MIRA sends

- **`skin_smooth`, always:** `{"category":"skin_smooth","skinSmoothStrength":0,"skinSmoothColorIntensity":0}`.
  - With no `skin_smooth` effect, the API applies strength 50 (F1).
  - Opting in sends the person's chosen strength and labels the render.
- **`foundation`:** `palettes:[{color:"#RRGGBB", colorIntensity, glowIntensity, coverageIntensity}]`, each 0–100. Finish maps to `glowIntensity` and coverage to `coverageIntensity` through `services/engines/mira_engines/config.py`.
- **`concealer`:** `palettes:[{color, colorIntensity, colorUnderEyeIntensity, coverageLevel}]`.
- **`lip_color`:** requires `shape{name}` (from `lipshape.json`) and `style{type: full|ombre|twoTone}`, plus `palettes:[{color, texture, colorIntensity, …}]`.
- **`blush`:** `pattern{name}` and `palettes[]{color, texture: matte|satin|shimmer, colorIntensity}`.
- **Pattern catalogues:** `https://plugins-media.makeupar.com/wcm-saas/patterns/<category>.json`.

## 3. Skin Analysis details

- **Input:** jpg/jpeg/png under 10 MB.
  - SD needs a short side ≥ 480 px; HD needs a short side ≥ 1080 px.
  - A long side above 2560 px is resized automatically.
  - Portrait orientation is recommended.
- **Face width:** the face must be wider than 60% of the image width (the docs suggest 60–80%). Raising the resolution does not help; crop to the face.
- **Concerns:**
  - SD concerns: `wrinkle, pore, texture, acne, oiliness, radiance, eye_bag, age_spot, dark_circle_v2, droopy_upper_eyelid, droopy_lower_eyelid, firmness, moisture, redness, tear_trough, skin_type`.
  - HD concerns: the same with an `hd_` prefix (with `hd_dark_circle`), plus sub-regions. `hd_pore` has forehead, nose, cheek and whole; `hd_wrinkle` has forehead, glabellar, crowfeet, periocular, nasolabial, marionette and whole; `hd_skin_type` has whole, t_zone and u_zone.
- **Skin type values:** Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness.
- **Scores:**
  - `raw_score` is a float from 1 to 100; higher means healthier-looking.
  - `ui_score` is an integer from 1 to 100, deliberately adjusted upwards "as a psychological motivator".
  - **MIRA's statistics use `raw_score` only** (D6).
- **Masks:** PNG masks by default (`miniserver_args.enable_mask_overlay: false`). MIRA tints them in the accent colour itself.
- **Units (V2.1, same for V2.0):**

| Concerns per request | SD | HD |
| --- | --- | --- |
| 1–4 | 9 | 12 |
| 5–8 | 12 | 16 |
| 9–12 | 14 | 20 |
| 13–16 | 16 | 22 |

- **Error codes to map to guidance:** `error_below_min_image_size`, `error_exceed_max_image_size`, `error_src_face_too_small`, `error_src_face_out_of_bound`, `error_lighting_dark`.
- **Mixing SD and HD** returns `400 {"error":"cannot mix HD and SD dst_actions","error_code":"InvalidParameters"}`.
- **Unconfirmed:** the undocumented `pf_camera_kit` flag and the "Advanced Skin Report" (`llm_results`). MIRA uses neither.

## 4. Errors

- **Synchronous 4xx:** `{"status", "error", "error_code"}`, where `error_code` ∈ `InvalidParameters, CreditInsufficiency, BadRequest, InvalidTaskId, …`. Since docs v1.9, `InvalidParameters` names the offending fields.
- **Engine failures:** HTTP 200 with `data.task_status:"error"`, `data.error:"<code>"` and `data.error_message`.
- **Timeouts:** `500 TaskTimeout`.
- **Feature-specific codes** appear only in each bundle's prose tables, not in the schema enum. **The client accepts any error string** and maps known ones; unknown ones become a generic "could not be measured" with the code kept for the run viewer.
- **Codes MIRA maps to guidance:**
  - Skin analysis and simulation: see §3.
  - Skin tone, face attributes, Fitzpatrick and hair: `error_face_position_{invalid,too_small,out_of_boundary}`, `error_face_not_forward_facing`, `error_face_angle_*`, `error_insufficient_lighting`, and `error_mismatch_image_size` (hair, when the three photos differ in size).
  - Clothes: `error_pose`, `error_invalid_ref`, `error_apply_region_mismatch`, `error_multi_person`, and `error_editing_failed` ("result too similar to the source", the documented form of ShadeSpan's lesson 2).
  - General: `error_no_face`, `error_nsfw_content_detected`, `error_multiple_people`, `error_large_face_angle`.

## 5. JS Camera Kit

- **Loading:**
  - Script: `https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js`.
  - Define `window.YMKAsyncInit` before it loads; the mount point `<div id="YMK-module">` is mandatory.
  - Lifecycle: `YMK.init(args)` → `YMK.openCameraKit()` → `YMK.close()`. Also `addEventListener`/`removeEventListener`, `pause`/`resume`, `isLoaded` and `getInfo`.
  - HTTPS is required except on localhost.
- **`init` arguments:**
  - `faceDetectionMode` (default `skincare`). MIRA uses `comprehensive` (one photo for makeup, skin analysis and face attributes), `hdskincare` (needs a webcam with a 2560 px long side), `shadefinder` (the skin-tone capture mode), `hairtype` and `hairfrizziness` (three phases: front, right, left), `hairlength` and `hairdensity`.
  - `imageFormat`: `base64` or `blob`.
  - `qualityLevel`: `relaxed | moderate | strict`, with `qualityOverrides` for face ratio, boundaries, pitch/yaw/roll and lighting. Overrides cannot be looser than relaxed.
  - `videoQuality`: `720p | 1080p | 1920p`. **Applies only to `skincare` and `hdskincare` and is ignored in `comprehensive`**, so the HD skin capture is a separate `hdskincare` capture. Whether a `comprehensive` photo meets the HD 1080 px minimum is _(confirm with a real capture)_.
  - Also `width`/`height` 300–1920, `language`, `countingDuration` (ms, default 800), and `disableCameraResolutionCheck`.
- **Events:**
  - **`faceQualityChanged`:** `{hasFace, position, frontal, lighting}`, and the SDK also sends `pose` and `size`.
    - `position` ∈ `good | notgood | toosmall | outofboundary`; `frontal` ∈ `good | notgood`; `lighting` ∈ `good | ok | notgood`.
    - The docs' "minimum quality" snippet calls `position` "area"; the event key is `position`.
    - **Ring mapping:** lighting → `lighting`; distance → `position`; angle → `frontal`; steadiness → MIRA's own check that all three held `good` for `countingDuration`.
  - **`faceDetectionCaptured`:** `{mode, images:[{phase, image, width, height}]}`.
  - **Camera failures:** `cameraFailed` (`error_resolution_unsupported`, `error_permission_denied`, `error_access_failed`) and `unsupportedResolution`. These drive the Capture screen's permission and low-resolution states.
  - **Lifecycle:** `opened`, `loading` (0–100), `loaded`, `closed`.

## 6. Agent surfaces

- **YouCam MCP:**
  - Three servers at `https://mcp-api-01.makeupar.com/mcp/{beauty,fashion,creators}`, with `Authorization: Bearer <key>`.
  - MIRA uses them only for single-shot discovery. The same template lists are also available over REST (`GET /s2s/v2.0/task/template/{feature}`, free), which the client uses as a fallback.
- **YouCam Skills:**
  - The open-source repo `YouCam-API/skills` has six Skills, installed with `npx skills add YouCam-API/skills`.
  - Its `api-fallback.yaml` files contain request schemas, including the `makeup-vto` default above.
  - MIRA publishes `skills/measured-shade-match` in the same format.
- **YouCam CLI:**
  - Install `@youcam_cli/youcam-cli`; it offers `run`, `status`, `template`, `client credit` and `client feature-cost`.
  - MIRA uses it for catalogue ingest.

## 7. Lessons from earlier winners

1. **ShadeSpan: use the bundle's API versions.** ShadeSpan found that `v1.0/task/cloth` accepts tasks then fails them with `invalid_garment_category`. Use the versions in the bundle: all clothes paths are `/s2s/v2.0/task/cloth*`.
2. **ShadeSpan: try-on can return the original clothing.** This happens especially when the person's own top is dark or structured. YouCam documents `error_editing_failed` for results too similar to the source, but MIRA still audits every render, because a silent return is possible. Capture guidance asks for plain, light tops.
3. **CASTING: try-ons are slow.** One try-on took 16.5–28.0 s in their measurements, and YouCam publishes no latency figures. Run fan-outs in parallel within the rate limit and stream results.
4. **CASTING and ShadeSpan: clothes try-on cost 2 units.** The bundle confirms this for V2 and V3. V4's cost comes from feature-cost.
5. **Aloud: pin response shapes with fixtures from real runs.** Aloud reported errors arriving as stringified tuples; the docs don't mention it, and MIRA keeps defensive parsing.
6. **New for MIRA: patch the bundles before generating types.** Many bundles mis-nest `results` (shown as `null` with the `$ref` hoisted), and `FileResponseV2` has the same bug. MIRA writes Zod schemas per feature from the bundles rather than generating types (D10).

## 8. Recording fixtures

`pnpm fixtures:record <feature> --input <file> --params <json>`:

1. Runs one live task through the lifecycle, after confirming the unit quote.
2. Saves the response to `packages/fixtures/recorded/<feature>/<name>.json`.
3. Replaces signed URLs with local file references.
4. Stores result images, but never input faces unless the person consented in writing and the file is listed in `packages/fixtures/CONSENT.md`.
