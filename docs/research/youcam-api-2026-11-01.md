# YouCam API research for MIRA (2026-11-01)

Sources were checked on 2026-11-01. The docs are at version **v1.17** (release notes dated 2026-10-29).

Unless noted, every fact comes from one of these:
- **[B:name]**: the OpenAPI bundle `https://docs.perfectcorp.com/_bundle/reference/<name>.yaml?download`. Each one is saved unmodified in `packages/youcam-client/openapi/<name>.yaml`, and `SOURCES.md` there lists them all. Citations to a bundle's prose sections, such as "Integration Guide", "Inputs & Outputs", "File Specs & Errors" and "Unit Consumption", point at the same bundle's `info.description`. That prose is also rendered at `https://docs.perfectcorp.com/reference/<name>`.
- **[D:page]**: `https://docs.perfectcorp.com/develop/<page>` (Markdown copy at `<page>.md`).
- **[CL]**: release notes, https://docs.perfectcorp.com/release/changelog
- **[SK]**: GitHub `YouCam-API/skills`, commit `1ab10ffd15a396dbdc783c2b95c50b65ec54d8e4` (2026-10-14). The `api-fallback.yaml` files carry `snapshot_date: 2026-10-01 16:39`.
- **[SDK]**: `https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js`. The file is gzip-served, so I decompressed it and **only grepped** it. I did not execute it.
- **[CK]**: the JS Camera Kit section rendered on https://docs.perfectcorp.com/reference/ai_skin_analysis. It is a docs partial and does not appear in any bundle.

---

## 1. Auth, base URL, regional servers

- **Auth.** Every request carries the header `Authorization: Bearer YOUR_API_KEY`, with a single space after `Bearer` and no `<>` around the key. Keys come from https://yce.makeupar.com/api-console/en/api-keys/. Sources: [D:quick_start_guide](https://docs.perfectcorp.com/develop/quick_start_guide), [D:debugging_guide](https://docs.perfectcorp.com/develop/debugging_guide), and the `BearerAuthenticationV2` security scheme in every bundle.
  - A secret key is shown only once, when it is created ([D:faq](https://docs.perfectcorp.com/develop/faq)).
  - The 401 responses come in two forms: `{status:401, error:"Invalid API key"}` or `error_code ∈ {InvalidApiKey, InactiveApiKey, ExpiredApiKey}`. Which one you get depends on the bundle (for example [B:makeup_vto], [B:ai_hair_type_detection]).
- **Base URL.** The only host listed is `https://yce-api-01.makeupar.com` ([D:api_server](https://docs.perfectcorp.com/develop/api_server), page "updated 2 days ago"). Every bundle sets `servers: [https://yce-api-01.makeupar.com]`.
- **Regional or India server: unconfirmed, and none is documented.** The API Server page lists exactly one server. What I tried:
  - The API Server page in HTML and `.md` forms.
  - All 67 bundles' `servers` blocks.
  - A web search for an India or regional server.
  - Perfect Corp's hackathon press pages (https://www.perfectcorp.com/business/news/YouCam-API-Hackthon-eCommerce and https://www.perfectcorp.com/business/news/hackathon-2026-perfect-corp). The only India item on them is a **press** contact, `contact_pr_in@perfectcorp.com`.
  - The Devpost page https://youcam-api-skin-ai-ecommerce.devpost.com/, which returned 403, so I could not see its "India link". **Ask the organisers what that link points to.** It may be a sign-up or console link rather than an API host.
- **Data-residency hint.** This is an observation, not a documented guarantee. Presigned upload URLs and result URLs in the official examples point to US S3 buckets: `yce-us.s3-accelerate.amazonaws.com/...ttl30/...` ([B:ai_skin_analysis] Integration Guide, [D:cli](https://docs.perfectcorp.com/develop/cli)) and `s3-us-west-2.amazonaws.com/yce-us/...` ([B:ai_skin_analysis] JSON example).
- **Other hosts in the docs.** The console and sign-up pages also appear under `yce.perfectcorp.com` ([D:mcp](https://docs.perfectcorp.com/develop/mcp), [SK] SKILL.md). The MCP host is `mcp-api-01.makeupar.com`.

## 2. File flow

- **There is one universal File API: `POST /s2s/v2.0/file`.** It covers both images and videos; the v1.14 release notes ([CL]) call it "Universal File Upload". Sources: [B:file] and [D:cli] "Uploading files", which says the CLI "always" uses this endpoint, as does [SK] `youcam_api.upload_file`.
  - Two bundles still list per-feature legacy paths: `POST /s2s/v2.0/file/2d-vto/ring` (tagged V1.0) in [B:ring_vto], and `POST /s2s/v2.0/file/obj-rem-vid` in [B:ai_video_object_removal].
- **Request.** `{"files":[{"content_type":"image/jpg","file_name":"x.jpg","file_size":50000}]}`. All three fields are required.
  - The size limit is 10 MB for images and 100 MB for video ([B:file] schema `FileV1.1`).
  - The ring endpoint's schema lists only `content_type` and `file_name` ([B:ring_vto]).
- **Response.** The shape is:
  ```json
  {"status":200,"data":{"files":[{"content_type":"image/png","file_name":"...","file_id":"...",
    "requests":[{"method":"PUT","url":"https://yce-us.s3-accelerate.amazonaws.com/...","headers":{"Content-Length":"547541","Content-Type":"image/png"}}]}]}}
  ```
  Sources: [B:file] `FileResponseV2`/`BasicFileResponse`, and the worked example in [B:ai_skin_analysis] Integration Guide step 3.
  - In the bundle, `FileResponseV2` declares `data: null` alongside a `$ref`, which is the bundling quirk described below. The prose example and [SK] code (`meta.json()["data"]["files"][0]`) both show the `data.files[]` wrapper.
- **The PUT.** Send `PUT` to `requests[0].url` with exactly `requests[0].headers` and the raw bytes as the body. The FAQ's curl recipe is `curl --request PUT '{url}' --header 'Content-Type: image/jpg' --header 'Content-Length: 50000' --data-binary @file` ([D:faq]).
  - Skipping the PUT produces **"500 Server Error / unknown_internal_error or 404 Not Found"** ([B:ai_skin_analysis] Integration Guide warning, and [D:debugging_guide]). MIRA's claim about this is confirmed.
- **Alternative to uploading.** Most tasks also accept `src_file_url`, a publicly accessible URL, in place of `src_file_id` ([B:*] `BasicRunTaskV2`).
- **Allowed upload types.** The CLI and Skills accept `.jpg .jpeg .png .mp4` and do not convert files ([D:cli], [D:agent_skills](https://docs.perfectcorp.com/develop/agent_skills)). Some features list extra formats; for example, bag, hat and shoes list `heic` ([B:ai_bag], [B:ai_hat], [B:ai_shoes] File Specs).

## 3. Task create, poll and delete; status values; chaining; retention

- **Create.** `POST /s2s/v{ver}/task/{feature}` returns `{"status":200,"data":{"task_id":"..."}}` (`BasicRunTaskResponseV2` in every bundle).
- **Poll.** `GET /s2s/v{ver}/task/{feature}/{task_id}` returns `{"status":200,"data":{"task_status":"running|success|error","error":<code|null>,"error_message":"...","results":{...}}}` (`TaskStatusResponseV2`).
  - `task_status` is one of exactly three values: **`running`, `success`, `error`**.
  - For image features `results` is `{ "url": "..." }`, a URL that is "valid for 2 hours". Multi-output features return `results.output[].url`: avatar, studio, headshot, colorize and color-correct ([D:cli], `TaskStatusResponseBodyMultiUrlResultsV2`).
- **Pre-process endpoints.** These exist for features that may see several people: `.../{feature}/pre-process` and `.../pre-process/{task_id}`. They are used by body-reshape, face-lift, face-reshape, fitzpatrick-scale-analyzer, teeth-whiten, face-swap and retake. Pre-process tasks and template listings **use no units** ([D:cli] "Pre-process", "Units and feature cost").
- **Templates.** `GET /s2s/v2.0/task/template/{feature}?page_size=1..20&starting_token=` returns `{data:{templates:[{id,thumb,title,category_name}],next_token}}`. Examples are [B:ai_look_vto] and [B:ai_clothes].
- **Delete with resources.** `POST /s2s/v2.0/task/delete` with JSON body `{"task_id":"..."}` ([B:task_management]).
  - It deletes "a finished task ... including all associated input files and generated outputs".
  - Success returns `200 {status:200}`.
  - A 400 returns `error_code ∈ {OperationNotSupport, OperationInvalid (task not finished yet), InvalidTaskId, InvalidParameters}`.
  - The release notes add the feature in v1.13 ([CL]). **Note:** this is a POST, not a DELETE, and it fails on a task that is still `running`.
- **Units are charged only on success.** "Until the engine completes the task, the status will remain 'running', and no units will be consumed... If the engine fails ... no unit will be consumed." Units nearest expiry are deducted first ([B:ai_skin_analysis] Integration Guide step 6, and [B:ai_fitzpatrick_skin_type]). Confirmed.
- **`dst_id` and chaining: unconfirmed, and no schema exists.** The phrase "You will get an url of the processed image and a dst_id that allow you to chain another AI task without re-upload" appears only in prose, in [B:ai_skin_analysis], [B:ai_skin_tone_analysis], [B:ai_face_analyzer] and [B:ai_background_removal].
  - **No response schema in any of the 67 bundles defines a `dst_id` field.**
  - **No request schema accepts one.**
  - The documented way to feed one task's output into another is to pass `results.url` as the next task's `src_file_url`. That works because the URL is public for 2 hours; this is an inference from `src_file_url` being "publicly accessible". **Verify `dst_id` against a live response before relying on it.**
- **Retention. The official pages conflict:**
  - [D:file_retention_period](https://docs.perfectcorp.com/develop/file_retention_period), "updated 1 day ago", says: uploaded files and `file_id` are kept **30 days**; `task_id` stays valid **30 days**; the result download URL is valid **2 hours**, after which you can re-query the `task_id` for a fresh link; everything is removed after **30 days**.
  - Every bundle's run response says "Task result is valid to query by this ID for **24 hours**". [B:ai_skin_analysis] prose says "Processed results are retained for **24 hours** after completion". [SK] SKILL.md also says "stays valid for 24 hours".
  - Result URLs carry `X-Amz-Expires=7200`, which is 2 h, and keys contain `ttl30` ([D:cli] Quick start).
  - **Safe design for MIRA:** download results within 2 h, treat `task_id` as dead after 24 h, and still call delete-with-resources.
- **Polling cadence.** No official interval is documented. [SK] `constants.py` uses `DEFAULT_POLL_INTERVAL = 5.0` s and `DEFAULT_MAX_POLLS = 20`. Polling a `task_id` after it expires returns `InvalidTaskId` ([D:debugging_guide], [D:faq]).
- **Large IDs.** Some numeric IDs exceed 2^53, so JSON parsers lose precision. The docs recommend a big-integer-safe parser such as json-bigint ([D:debugging_guide]). This applies to, for example, the `id` fields in the credit and history responses.

## 4. Webhooks

Source: [D:webhook](https://docs.perfectcorp.com/develop/webhook).

- **Supported:** yes, added in v1.6 ([CL]). A notification fires when a task ends in `success` or `error`, and it follows the **Standard Webhooks** spec.
- **Configured in the console, not per request.** Webhooks are set up at https://yce.makeupar.com/api-console/en/webhook/, with **up to 10 endpoints** at once. The endpoint must accept POST over HTTPS. **No request-body field for a callback URL exists in any bundle.** I grepped all 67 bundles; there is no OpenAPI `webhooks` section and no callback property.
- **Signing.** The secret is HMAC-SHA256, base64-encoded with a `whsec_` prefix. To verify:
  1. Strip `whsec_` and base64-decode the rest to get the key bytes.
  2. Sign the string `{webhook-id}.{webhook-timestamp}.{raw-minified-json-body}`.
  3. Compare with the header `webhook-signature: v1,<base64 sig>`. `v1` is the only version.
- **Headers:** `webhook-id`, which stays the same across retries so you can use it for idempotency; `webhook-timestamp` in Unix seconds; `webhook-signature`.
- **Payload:** `{"created_at":1761112848,"data":{"task_id":"...","task_status":"success"}}`. `task_status` is `success` or `error`, and the payload contains **no result**, so you still GET the task.
- **Per-feature support.** The bundles say "Prefer webhook-based completion handling **when the feature supports webhooks**" (for example [B:ai_clothes]). No list of supported features is published, so per-feature support is **unconfirmed**.
- Retry policy and source IPs: **unconfirmed**, not documented.

## 5. Credit balance and feature cost

Source: [B:unit_system]. The paths below also appear in the [D:cli] mapping table and the [SK] `api-fallback.yaml` `credit:` block.

- **Balance: `GET /s2s/v1.0/client/credit`.** Returns `{"status":200,"results":[{"id":<int64>,"type":"ApiSubsToken|ApiPaygToken","amount":<int, deprecated>,"amount_dec":10.04,"expiry":<ms>}]}`.
  - Use `amount_dec`.
  - The bundle's security scheme for this v1.0 path is the older `BearerAuthentication` ("access_token"). However, the official CLI and Skills call it with the API key as the Bearer token (`youcam client credit`, [SK] `get_credits`).
  - The CLI prints its sample result without a separate key, so the API key works there in practice.
- **History: `GET /s2s/v1.0/client/credit/history?page_size=1..30&starting_token=`.**
- **Feature cost: `GET /s2s/v2.0/credit/feature-cost?page_size=1..20&starting_token=`.** Returns `{status, result:{next_token, skus:[{description, amount, unit:"result_image"|"second", proc_unit, run_task_url}]}}`.
  - The docs say it matches https://yce.perfectcorp.com/ai-api/api-pricing.
  - It is free: "Both commands are free" ([D:agent_skills], [D:cli]).
  - Map an SKU to a feature by taking the path segment of `run_task_url` after `/task/` ([SK] `slug_of`).
  - **Discrepancy:** the bundle's example SKU reads "AI Skin Analysis for SD 5~7 concerns" = 12, while the unit table says 5–8. Trust the live endpoint.

## 6. Features

Every path below is under `https://yce-api-01.makeupar.com`. The slug is the path segment before `{task_id}`. All features take `src_file_url` **or** `src_file_id` unless noted, and all return `results.url` (valid 2 h) unless noted. "Current" means the newest version in the bundle; the CLI always calls that version ([D:cli] "rules of thumb").

| Feature (bundle) | Create path (current) | Required / key params | Units (bundle "Unit Consumption") | Result |
| --- | --- | --- | --- | --- |
| AI Skin Analysis [B:ai_skin_analysis] | `POST /s2s/v2.1/task/skin-analysis` (v2.0 still documented) | `dst_actions[]` required, all SD or all HD. Optional: `format`: `zip` (default) or `json`; `miniserver_args`. v2.1 also has `pf_camera_kit: boolean` (undocumented) | 1–4 concerns SD 9 / HD 12; 5–8: 12 / 16; 9–12: 14 / 20; 13–16: 16 / 22 (same for v2.0 and v2.1) | zip: `results.url`. json: `results.output[]` = `{type, region, raw_score, ui_score, mask_urls[]}` plus `{type:"skin_age",score}`, `{type:"all",score}`, `{type:"resize_image",mask_urls}` |
| Facial Color Tones Analyzer [B:ai_skin_tone_analysis] | `POST /s2s/v2.0/task/skin-tone-analysis` | Optional `face_angle_strictness_level`: strict (pitch≤4°, yaw≤6°, roll≤4°), **high** (default, ≤10°), medium (≤15°), low (≤20°), flexible (≤30°) | 20 | `results.face_quality{has_face, area, frontal, lighting, faceangle}` and `results.color{skin_color, lip_color, eyebrow_color, eye_color (hex), eye_color_name ∈ Amber/Brown/Green/Blue/Gray/Other, hair_color ∈ 7 fixed hexes, hair_color_name ∈ Auburn/Black/Blonde/Brown/Grey/White/Red}`. **Hex only: no Lab, no undertone, no hair Lab.** `hair_color` is quantised to 7 values (`#a0a0a0 #722626 #000000 #FAF0BE #42280E #808080 #B56637`) |
| Fitzpatrick [B:ai_fitzpatrick_skin_type] | `POST /s2s/v2.0/task/fitzpatrick-scale-analyzer` (optional pre-process at `.../pre-process`) | **`version: "1.0"` required**; `index` (default 0) | 10 (pre-process free) | `results{fitzpatrick_scale ∈ I..VI, timed}`. Pre-process: `results{timed, result[{left,top,width,height}]}` |
| Face Attributes & Ratio Analyzer [B:ai_face_analyzer] | `POST /s2s/v2.0/task/face-attr-analysis` | `features[]` required, from 31 values: eyeShape, eyeSize, eyeAngle, eyeDistance, eyelid, eyebrowShape, eyebrowThickness, eyebrowDistance, eyebrowShortness, cheekbones, faceShape, lipShape, noseWidth, noseLength, age, gender, eyeColor, lipColor, eyebrowColor, hairColor, horizontalThird, verticalFifth, faceAspectRatio, eyeAspectRatio, eyebrowPosition, eyebrowArch, eyeHeightToEyebrowDistance, noseAspectRatio, noseWidthToMouthWidth, noseToLipToChin, upperLipToLowerLip. Optional `face_angle_strictness_level` | 1–5 features 10; 6–14: 20; 15–28: 30 | `face_quality`, `facialratio{horizontal_third[3], vertical_fifth[5], face_aspect_ratio[1,r], ...}`, `cheekbone`, `eyelid`, `eyebrow`, `faceshape`, `lipshape[]`, `nose`, `color` (hex), `agegender{age,gender}` |
| Hair Type [B:ai_hair_type_detection] | `POST /s2s/v2.0/task/hair-type-detection` | **`src_file_urls[3]` or `src_file_ids[3]`** in the order front, right, left | 2 | `results.hair_type{mapping ∈ "1 to 2a".."4b to 4c", term}` |
| Hair Density [B:ai_hair_density_detection] | `POST /s2s/v2.0/task/hair-density-detection` | single src | 1 | `results{timed, hair_density{mapping: float-as-string 0–3, term ∈ Extremely Low/Low/Medium/High Density}}` |
| Hair Length [B:ai_hair_length_detection] | `POST /s2s/v2.0/task/hair-length-detection` | single src | 2 | `results.hair_length.term` ∈ above the ears / ear length / ear length or longer / short hair / short hair or longer / above chest / above chest or longer / long hair |
| Hair Frizziness [B:ai_hair_frizziness_detection] | `POST /s2s/v2.0/task/hair-frizziness-detection` | `src_file_urls[3]` or `src_file_ids[3]` (front, right, left) | 2 | `results.hair_frizziness{mapping 0–3, term ∈ Not Frizzy/Slightly Frizzy/Frizzy/Extreme Frizzy}` |
| Skin Simulation [B:ai_skin_simulation] | `POST /s2s/v2.0/task/skin-simulation` | 10 optional numbers, each 0–1: `wrinkle, radiance, oiliness, acne, eye_bags, dark_circle, spots, pores, texture, redness` (note the plurals `eye_bags`, `spots`, `pores`) | 1–4 concerns 4; 5–10: 6 | `results.url`. Note: `oiliness` prose contradicts itself ("control excess shine" vs "1.0 for maximum oil/shine added") |
| Makeup VTO [B:makeup_vto] | `POST /s2s/v2.0/task/makeup-vto` | `effects[]` required; optional `version` (default "1.0"). Categories: `skin_smooth, blush, bronzer, concealer, contour, eyebrows, eye_liner, eye_shadow, eyelashes, foundation, highlighter, lip_color, lip_liner` (schema below) | 1 | `results.url` |
| Look VTO [B:ai_look_vto] | `POST /s2s/v2.0/task/look-vto` | `template_id` required, from `GET /s2s/v2.0/task/template/look-vto`. No intensity parameter | 2 | `results.url` |
| Clothes [B:ai_clothes] | `POST /s2s/v2.0/task/cloth-v4` (also `cloth` = V2.0, `cloth-v3` = V3.0, all under `/s2s/v2.0/`) | `ref_file_url`/`ref_file_id` and `garment_category` required. **v4:** `full_body, lower_body, upper_body, shoes, auto, outer`. `cloth` and `cloth-v3` lack `outer`. `change_shoes` (default true; applies to full_body/lower_body); v4 adds `filter_multi_person: off(default)/normal/strict`. Only `cloth` (V2.0) also takes `template_id` | V2.0: 2; V3.0: 2; **V4 not listed (unconfirmed)** | `results.url` |
| Bag [B:ai_bag] | `POST /s2s/v2.0/task/bag` | ref file and **`gender` (female/male) required** | 2 | `results.url`. Output 1104×1472 |
| Hat [B:ai_hat] | `POST /s2s/v2.0/task/hat` | ref and `gender` required; `style` ∈ random (default), style_sporty_casual, style_urban_fashion, style_vacation_casual, style_warm_cozy, style_bohemian, which "control[s] outfit and background style" | 2 | `results.url`. Output 896×1152 |
| Scarf [B:ai_scarf] | `POST /s2s/v2.0/task/scarf` | ref and `gender`; `style` ∈ random, style_french_elegance, style_light_luxury, style_cottagecore, style_modern_chic, style_bohemian | 2 | `results.url` |
| Shoes [B:ai_shoes] | `POST /s2s/v2.0/task/shoes` (V2.0); `POST /s2s/v2.0/task/shoes-transfer` (V3.0, the CLI's current) | shoes: ref, `gender`, `style` ∈ random, style_minimalist, style_bohemian, style_cottagecore, style_french_elegance, style_retro_fashion. shoes-transfer: ref only | V2.0: 2; V3.0: 2 | `results.url`. Output 1008×1344 |
| Earrings, Necklace, Ring, Bracelet, Watch [B:ai_earrings], [B:ai_necklace], [B:ring_vto], [B:ai_bracelet], [B:ai_watch] | `POST /s2s/v2.0/task/2d-vto/{earring,necklace,ring,bracelet,watch}` | `ref_file_urls[]` or `ref_file_ids[]` required; optional `srcmsk_file_*`, `refmsk_file_*`; **`source_info{name, mask_name}` and `object_infos[{name, mask_name, parameter{...}}]` required**. Parameters, prefixed by item: `*_need_remove_background` (default true), `*_anchor_point`, `*_wearing_location`, `*_shadow_intensity` 0–1, `*_ambient_light_intensity` 0–1. Earring also has `earring_scale` (cm), `earring_is_right_ear`, `earring_occluded_type` 0/1/2. Ring also has `ring_wearing_finger` 0–4 | earring, ring, bracelet: 1 single / 2 stacked; necklace, watch: 1 single | `results.url` |
| Fabric [B:ai_fabric] | `POST /s2s/v2.0/task/fabric` | `template_id` required (`GET /s2s/v2.0/task/template/fabric`); jpg/jpeg only | 2 | `results.url` |
| Hair Color [B:ai_hair_color] | `POST /s2s/v2.0/task/hair-color` | Either `preset` (one of 20 named presets, such as "Honey Blonde") or `pattern{name: full/ombre, blend_strength 0–100, line_offset −0.99..0.99, coloring_section: top}` plus `palettes[1..2]{color hex, color_intensity 0–100, shine_intensity 0–100}` | 1 (full or ombre) | `results.url` |
| Hair Style [B:ai_hairstyle] | `POST /s2s/v2.1/task/hair-transfer` (current); also v2.0 `hair-style` (template) and v2.0 `hair-transfer` (reference) | v2.1: exactly one of `ref_file_url`, `ref_file_id` or `template_id` (from `GET /s2s/v2.1/task/template/hair-transfer`); `hair_color: ref (default) / src` | V2.0: 1 preset / 2 custom; V2.1: 2 / 2 | `results.url` |
| Background Change [B:ai_photo_background_change] | `POST /s2s/v2.0/task/bg-replace` | `type: prompt (default) / template`; `prompt`; `template_id` (`GET /s2s/v2.0/task/template/bg-replace`) | 4 | `results.url` |
| Image-to-Video [B:ai_video_generator] | `POST /s2s/v2.0/task/image-to-video/youcam` (V2.0, current; the CLI's `image-to-video`); legacy V1 is `POST /s2s/v2.0/task/image-to-video` (`template_id`, `dst_duration` 5/10, `mode` std/pro) | V2: `resolution` "480"/"720"/"1080" and `dst_duration` 5/10 required; `prompt` (1–1500 chars, "automatically enhanced ... using Gemini API"); `negative_prompt`; `model: youcam-video-v2` | V2: 1 / 2 / 3 units per second at 480p / 720p / 1080p, rounded up (5 s at 720p = 10). V1 std 3/s, pro 6/s | `results.url` (video) |
| Background Removal [B:ai_background_removal] | `POST /s2s/v2.0/task/sod` | src only; long side ≤ 4096; JPG/PNG < 10 MB | 1 | `results.url` |

### Skin Analysis details ([B:ai_skin_analysis])

- **Input.** jpg/jpeg/png under 10 MB.
  - SD: short side ≥ 480 px. HD: short side ≥ 1080 px.
  - A long side above 2560 is resized to 2560, and output images are capped at a 2560 long side.
  - "The width of the face needs to be greater than 60% of the width of the image". The photo-requirement text says the face should occupy about 60–80% of the width.
  - The docs strongly recommend portrait orientation.
- **SD vs HD.** SD `dst_actions` are `wrinkle, pore, texture, acne, oiliness, radiance, eye_bag, age_spot, dark_circle_v2, droopy_upper_eyelid, droopy_lower_eyelid, firmness, moisture, redness, tear_trough, skin_type`. HD uses the same 16 concepts with an `hd_` prefix, except that SD has `dark_circle_v2` where HD has `hd_dark_circle`.
  - HD sub-regions: `hd_pore` (forehead, nose, cheek, whole); `hd_wrinkle` (forehead, glabellar, crowfeet, periocular, nasolabial, marionette, whole); `hd_texture` and `hd_acne` (whole); `hd_skin_type` (whole, t_zone, u_zone).
  - SD has no sub-regions, except `skin_type` (whole, t_zone, u_zone).
- **Skin type values:** Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness.
- **`raw_score`:** a float from 1 to 100; higher means healthier.
- **`ui_score`:** an integer from 1 to 100, "adjusted ... to produce more favorable results ... psychological motivator". Confirmed: MIRA should use `raw_score`.
- **Overall scores:** `all.score` and `skin_age`.
- **Masks:**
  - `miniserver_args.enable_mask_overlay` defaults to false, which returns raw PNG masks. With true, the API returns the mask blended onto the photo as JPG.
  - Mask files are named like `hd_pore_output_cheek.png`.
  - Optional dark-background settings for pores and wrinkles: `enable_dark_background_hd_pore|hd_wrinkle`, `color_*` (hex), `opacity_*` (0–1).
- **Optional LLM report.** When "Advanced Skin Report or Product Recommendation is requested", the output includes `type:"llm_results"`. No request field for this exists in the schema, so it is **unconfirmed** how to request it.
- **Mixing SD and HD** returns `400 {"status":400,"error":"cannot mix HD and SD dst_actions","error_code":"InvalidParameters"}`.
- **An unknown action** returns `"error":"Not available dst_action abc123"`.

### Makeup VTO effect schema ([B:makeup_vto]; also [SK] `beauty-advisor/scripts/api-fallback.yaml`)

All intensities are integers from 0 to 100 unless noted. Pattern names are the `label` values in the public catalogs at `https://plugins-media.makeupar.com/wcm-saas/patterns/{blush,bronzer,contour,eyebrows,eyeliner,eyeshadow,eyelashes,highlighter,lipliner}.json` and `.../wcm-saas/shapes/lipshape.json`. `youcam template makeup-vto <cats>` lists them free of charge.

- **`skin_smooth`:** `{category, skinSmoothStrength (default 50), skinSmoothColorIntensity (default 50)}`. The bundle says: "**If no skin_smooth effect is provided, the system will automatically apply a smoothing strength of 50**". Confirmed in the bundle and in [SK]. To disable smoothing, send `{"category":"skin_smooth","skinSmoothStrength":0,"skinSmoothColorIntensity":0}`. The bundle does not say whether `skinSmoothColorIntensity` must also be 0 to disable smoothing, so that part is unconfirmed; send both as 0.
- **`foundation`:** no pattern. `palettes[≥1]{color #RRGGBB, colorIntensity, glowIntensity, coverageIntensity}`, all required.
- **`concealer`:** no pattern. `palettes[≥1]{color, colorIntensity, colorUnderEyeIntensity, coverageLevel}`, all required.
- **`blush`:** `pattern{name}`; `palettes[colorNum]{color, texture: matte/satin/shimmer, colorIntensity, glowStrength (satin, shimmer), shimmerColor, shimmerDensity (shimmer)}`.
- **`lip_color`:**
  - `shape{name}` (lipshape.json) is required. Optional `morphology{fullness, wrinkless}`, defaults 0; note that `wrinkless` is the API's own spelling.
  - `palettes[≥1]{color, texture: matte/gloss/holographic/metallic/satin/sheer/shimmer, colorIntensity, gloss, shimmerColor, shimmerIntensity, shimmerDensity, shimmerSize, transparencyIntensity}`.
  - `style{type: full/ombre/twoTone, innerColorRatio, blendStrength}` is required.
- **Others:**
  - `bronzer{pattern, palettes{color, colorIntensity}}`
  - `contour{pattern, palettes{color, colorIntensity}}`
  - `eyebrows{pattern: {type:"shape", name, curvature −100..100, thickness −100..100, definition} | {type:"color"}, palettes{color, colorIntensity, texture: matte/shimmer, shimmer*}}`
  - `eye_liner{pattern, palettes{color, texture: matte/shimmer/metallic, colorIntensity, shimmerColor, shimmerIntensity, metallicIntensity}}`
  - `eye_shadow` (same fields as `eye_liner`, with palettes = `colorNum`)
  - `eyelashes{pattern, palettes{color, colorIntensity}}`
  - `highlighter{pattern, palettes{color, glowIntensity, shimmerIntensity, shimmerDensity, shimmerSize, colorIntensity}}`
  - `lip_liner{pattern, palettes{color, texture: matte/satin, colorIntensity, thickness, smoothness}}`
- **Input:** long side < 1920 and face width ≥ 100. The error table says `error_exceed_max_image_size` triggers when the image is not "width < 1920px, height < 1080px".

### JS Camera Kit ([CK], confirmed against [SDK])

- **Loading.** Use `<script src="https://plugins-media.makeupar.com/v2.5-camera-kit/sdk.js">` (docs version v2.5). `window.YMKAsyncInit` must be defined before the SDK loads, `<div id="YMK-module">` is a mandatory mount point, and HTTPS is required except on localhost.
- **Call order:** `YMK.init(args)`, then `YMK.openCameraKit()`, then `YMK.close()`.
- **Other methods:** `addEventListener(event, cb)` returns an id; `removeEventListener(id)`; `isLoaded()`; `pause()`; `resume(restartWebcam)`; `getInfo()`.
- **`YMK.init` arguments:**

  | Argument | Values | Default |
  | --- | --- | --- |
  | `faceDetectionMode` | see below | `"skincare"` |
  | `width`, `height` | 300–1920 | — |
  | `language` | chs, cht, deu, enu, esp, fra, jpn, kor, ptb, ita, mon | enu |
  | `imageFormat` | `base64`, or `blob` (the SDK maps any other value to base64) | `base64` |
  | `disableCameraResolutionCheck` | boolean | false |
  | `hideFlipCameraButton` | boolean | false |
  | `countingDuration` | ms | 800 |
  | `qualityLevel` | relaxed, moderate, strict | relaxed |
  | `qualityOverrides` | object | — |
  | `videoQuality` | 720p (1280×720), 1080p (1920×1080), 1920p (2560×1920) | 720p |

  - **`videoQuality` only applies to `skincare` and `hdskincare`.** The SDK checks this explicitly (`isSkincareCheckerMode() || isHdSkincareCheckerMode()`), so it is **ignored in `comprehensive` mode**.
- **`faceDetectionMode` values** (the SDK enum matches the docs): `makeup, skincare, hdskincare, shadefinder, facereshape, hairlength, hairfrizziness, hairtype, hairdensity, ring, wrist, necklace, earring, teethwhiten, nail, comprehensive`.
  - `comprehensive` provides one photo for Makeup, Skin Analysis and Face Attributes.
  - `hdskincare` needs a webcam with a 2560 px long side.
  - `shadefinder` is the capture mode for Skin Tone Analysis.
- **`qualityOverrides` keys and allowed ranges.** Overrides cannot be looser than the RELAXED preset.

  | Key | Allowed range | Preset defaults |
  | --- | --- | --- |
  | `face_ratio_lower_threshold` | 0.55–1 | strict 0.75, moderate 0.65, relaxed 0.55 |
  | `face_ratio_upper_threshold` | 1 | — |
  | `face_{left,right,top,bottom}_boundary_{lower,upper}_threshold` | 0–1 | — |
  | `pitch_*` | −20..10 | — |
  | `yaw_*`, `roll_*` | −15..15 | — |
  | `lighting_lower_threshold` | 0.55–1 | strict 0.8, moderate 0.7, relaxed 0.55 |
  | `lighting_upper_threshold` | 0.8–1 | — |
  | `lighting_uneven_threshold` | 0–0.2 | — |

  Quality configuration applies to skincare and hdskincare.
- **`faceQualityChanged` payload.** The SDK builds it as `{hasFace, position, frontal, lighting, pose, size}`, where `position` comes from the internal `area` value. Values:
  - `position` ∈ good / notgood / toosmall / outofboundary
  - `frontal` ∈ good / notgood
  - `lighting` ∈ good / ok / notgood
  - Docs example: `{"hasFace":true,"position":"good","frontal":"good","lighting":"ok"}`.
  - In `teethwhiten` mode the payload is `{hasFace, hasTeeth, position, frontal, lighting}`; in `nail` mode it is `{hasNail, size}`.
  - **Docs inconsistency:** the "Minimum Recommended Quality" snippet uses the key `area`, but the event delivers that value as **`position`**.
- **`faceDetectionCaptured` payload:** `{mode, images:[{phase (0-based), image (base64 string or Blob), width, height}]}`. Multi-phase modes such as `hairtype` and `hairfrizziness` deliver several images, in the order front, right, left.
- **Other events:**
  - Lifecycle: `opened`, `loading` (0–100), `loaded`, `closed`, `faceDetectionStarted`.
  - Camera: `cameraOpened`, `cameraClosed`, `cameraFailed` (`error_resolution_unsupported`, `error_permission_denied`, `error_access_failed`), `unsupportedResolution`.

### Agent surfaces

- **MCP.** Three servers: `https://mcp-api-01.makeupar.com/mcp/beauty`, `https://mcp-api-01.makeupar.com/mcp/fashion` and `https://mcp-api-01.makeupar.com/mcp/creators`. Auth is the header `Authorization: Bearer YOUR_API_KEY`. Each server includes the tools `File_Upload`, `Get_Running_Task_Status`, `Get_Upload_API_Info` and `Get_Feature_Cost`, plus `*_Templates` ([D:mcp]). Confirmed.
  - **Template discovery is also available directly over REST** at `GET /s2s/v2.0/task/template/{feature}`, so MCP is not required for it.
- **Skills.** `YouCam-API/skills` has six skills: skin-analysis-expert, facial-consultant, beauty-advisor, hair-color-style-advisor, hair-diagnostics and clothes-tryon-studio. Install with `npx skills add YouCam-API/skills` ([D:agent_skills], [SK]).
  - The "ratios drift" claim is confirmed: `skills/facial-consultant/SKILL.md:73` says "Ratios drift slightly between runs and `faceShape` may not be returned". `references/guide.md:16` says "Values drift slightly between runs, so label them as approximate".
  - The Skills send an extra header, `X-Pxy-Src: skill` ([SK] `youcam_api.headers`).
- **CLI.** Install with `npm i -g @youcam_cli/youcam-cli` (needs Node ≥ 18). Log in with `youcam auth login <key>`; this saves `~/.youcam-cli/credentials.json`, and the `YOUCAM_CLI_API_KEY` environment variable overrides it ([D:cli]).
  - Commands: `run <feature>`, `status <feature> <task_id>`, `run pre-process`, `template`, `client credit|credit-history|feature-cost`.
  - Output is JSON on stdout; the command exits 1 on failure; values are validated against the schema before a request is sent.
  - Local files are uploaded automatically, using a presigned PUT.

## 7. Error codes and error format

- **Format.**
  - Synchronous 4xx: `{"status":400,"error":"<message>","error_code":"InvalidParameters|CreditInsufficiency|BadRequest|InvalidStyleGroup|InvalidStyle"}` (`RunError` in all bundles). Since v1.9, `InvalidParameters` messages name the offending parameters ([CL]).
  - 401: see section 1.
  - 429: `{"status":429,"error":"Too many requests"}`.
  - Polling a bad or expired ID: `400 InvalidTaskId`, or `{"error":"Invalid task ID"}`.
  - Engine timeout: `500 {"error_code":"TaskTimeout"}`, or `"Task execution timed out"`.
  - **Asynchronous engine failure:** HTTP 200 with `data.task_status:"error"`, `data.error:"<code>"` and `data.error_message`.
- **The `data.error` enum** in the bundles is the generic `EngineErrorCode`: `error_exceed_max_image_size, exceed_max_filesize, invalid_parameter, error_download_image, error_download_mask, error_decode_image, error_decode_mask, error_nsfw_content_detected, error_no_face, error_pose, error_face_parsing, error_inference, exceed_nsfw_retry_limits, error_upload, unknown_internal_error`.
  - The general list adds `error_download_video, error_decode_video, error_multiple_people, error_no_shoulder, error_large_face_angle, error_hair_too_short, error_unexpected_video_duration, error_bald_image, error_unsupport_ratio` ([D:error_codes](https://docs.perfectcorp.com/develop/error_codes)).
  - **Feature-specific codes appear only in each bundle's prose "File Specs & Errors" table and not in the enum**, so the client must accept any string.
- **Feature-specific codes:**
  - **Skin Analysis:** `error_below_min_image_size, error_exceed_max_image_size, error_src_face_too_small` (face width ≤ 60% of the image), `error_src_face_out_of_bound, error_lighting_dark`. Confirmed.
  - **Skin Simulation:** the same codes, plus `error_invalid_params`.
  - **Skin Tone and Face Attributes:** `error_below_min_image_size` (< 320 px), `error_face_position_invalid, error_face_position_too_small, error_face_position_out_of_boundary, error_face_not_forward_facing, error_face_angle_{upward,downward,leftward,rightward,left_tilt,right_tilt}`.
  - **Fitzpatrick and hair detections:** `error_below_min_image_size` (320 px; 100 px for density), `error_face_position_{invalid,too_small,out_of_boundary}, error_insufficient_lighting, error_face_angle_invalid`. Hair type and frizziness add `error_mismatch_image_size`, raised when the three photos are not the same size.
  - **Makeup and Look VTO:** `error_below_min_image_size` (< 100 px), `error_exceed_max_image_size`, `error_face_position_{invalid,too_small,out_of_boundary}`, `error_face_angle_invalid`.
  - **Clothes:**
    - Preprocess: `exceed_max_filesize` (> 4096 px long side), `error_below_min_image_size` (< 128 px long side), `error_pose, error_invalid_ref, error_apply_region_mismatch, error_invalid_src`.
    - Engine: `invalid_parameter` (bad `garment_category`, etc.), `error_download_image, exceed_max_filesize` (10 MB), `error_nsfw_content_detected, error_editing_failed` ("result image is too similar to the source", relevant to ShadeSpan lesson 2), `unknown_internal_error, error_multi_person`.
  - **Bag, hat, scarf, shoes:** `error_download_image, error_inference, error_no_face, error_nsfw_content_detected, exceed_max_filesize, invalid_parameter` (gender or style), `unknown_internal_error`.
  - **2D jewelry:** `RUNTIME_ERROR, PHOTO_DETECTION_FAIL, OBJECT_DETECTION_FAIL, PHOTO_CHECK_INVALID, INPUT_ERROR, INPUT_MAIN_IMAGE_EMPTY`. These are upper-case, a different style from the other codes.
  - **Fabric:** `error_apply_region_not_detected`.
  - **Hairstyle:** `error_no_shoulder, error_large_face_angle, error_insufficient_landmarks, error_hair_too_short, error_face_pose`.
  - **Hair color:** min 320 px; max width < 1920 and height < 1080.
  - **Background change:** `exceed_max_filesize, size_mismatch_on_input_image_and_mask, invalid_parameter`.
  - **Video generator:** categories only, no codes: invalid parameters, policy or content-security triggers, rate or concurrency/QPS quota exceeded, internal errors.
- **"Errors arrive as stringified tuples" (Aloud): unconfirmed.** Nothing in the docs mentions it. Keep the defensive parsing and capture fixtures.

## 8. Rate limits and concurrency

- **Rate limit:** 250 requests per 300 s **per IP** and 250 per 300 s **per access token**. Both limits apply, and exceeding either returns HTTP 429. The recommended pace is about 5 QPS. Back off and retry ([D:rate_limit](https://docs.perfectcorp.com/develop/rate_limit)).
- Every poll counts toward this budget. At about 0.83 requests per second on average, polling 10 tasks every 5 s uses 2 requests per second.
- **Concurrency limit (simultaneous running tasks): unconfirmed.** No page documents one. The video-generator error table mentions "Concurrency or QPS exceeds quota" with no numbers. I checked the rate-limit page, the FAQ and all bundles.

---

## Doc claim in YOUCAM_API.md → status

| Claim (docs/YOUCAM_API.md) | Status | Fact and source |
| --- | --- | --- |
| Auth `Authorization: Bearer <key>`, server-side only | **Confirmed** (auth). "Server-side only" is MIRA policy; the docs allow browser and mobile use | [D:quick_start_guide], [D:faq] |
| Base URL `https://yce-api-01.makeupar.com` | **Confirmed** | [D:api_server]; all bundles |
| Regional servers listed; India link | **Corrected / unconfirmed.** The docs list **one** server and no regional ones. The hackathon India link could not be checked (Devpost returned 403) | [D:api_server] |
| Register → file_id plus presigned request; PUT with the exact headers; skipping the PUT gives 404/500 | **Confirmed**. The path is `POST /s2s/v2.0/file` (universal) and the response is `data.files[].{file_id, requests[].{method,url,headers}}` | [B:file], [B:ai_skin_analysis], [D:debugging_guide] |
| Create with `src_file_id` or a public URL → task_id | **Confirmed** (`src_file_url`) | all bundles |
| Poll `GET /s2s/v2.0/task/{feature}/{task_id}` | **Corrected**: the version is per feature, `/s2s/v{ver}/...`; skin-analysis and hair-transfer use v2.1. Status values are `running`/`success`/`error` | [B:*], [D:cli] |
| Or receive a webhook | **Confirmed**, configured in the console with no per-request field. Standard Webhooks HMAC; the payload is only `{created_at, data:{task_id, task_status}}` | [D:webhook] |
| On success: result URL(s) plus `dst_id` for chaining | **URL confirmed** (valid 2 h). **`dst_id` unconfirmed**: prose only, in no schema, with no request field to accept it | [B:ai_skin_analysis] prose; schema search |
| Units consumed only on success; polling and failed tasks free | **Confirmed**. Pre-process and template listing are also free | [B:ai_skin_analysis], [D:cli] |
| Results retained for 24 hours | **Corrected / conflicting.** The retention page says file_id and task_id last **30 days** and download URLs **2 hours**; the bundles and skin prose say 24 h. Download within 2 h | [D:file_retention_period] vs bundles |
| Task delete with resources removes inputs and outputs | **Confirmed**: `POST /s2s/v2.0/task/delete {task_id}`, which fails with `OperationInvalid` if the task is unfinished | [B:task_management] |
| Credit balance `GET /s2s/v1.0/client/credit` _(confirm)_ | **Confirmed**. Response `results[]{id,type,amount(deprecated),amount_dec,expiry}`; use `amount_dec` | [B:unit_system], [D:cli], [SK] |
| Feature cost: free endpoint _(confirm path)_ | **Confirmed**: `GET /s2s/v2.0/credit/feature-cost` (paged, page_size ≤ 20) → `result.skus[]{description,amount,unit,proc_unit,run_task_url}` | [B:unit_system] |
| skin-analysis: `POST /s2s/v2.1/task/skin-analysis`; v2.0 documented; HD and SD can't mix | **Confirmed** | [B:ai_skin_analysis] |
| skin-tone-analysis slug | **Confirmed**: `/s2s/v2.0/task/skin-tone-analysis`, 20 units, hex colours only | [B:ai_skin_tone_analysis] |
| fitzpatrick-scale-analyzer slug | **Confirmed**. Add: `version:"1.0"` is **required**, `index`, optional pre-process; 10 units | [B:ai_fitzpatrick_skin_type] |
| Face Attributes slug _(confirm)_; ratios drift | **Slug resolved:** `face-attr-analysis` (v2.0). **Drift confirmed** in the Skills | [B:ai_face_analyzer], [SK] facial-consultant |
| Hair detection slugs _(confirm)_ | **Resolved:** `hair-type-detection`, `hair-density-detection`, `hair-length-detection`, `hair-frizziness-detection` (type and frizz need 3 photos) | bundles |
| skin-simulation `POST /s2s/v2.0/task/skin-simulation`; each concern 0–1 | **Confirmed**: 10 concerns; 4 units for 1–4, 6 for 5–10 | [B:ai_skin_simulation] |
| makeup-vto categories incl. foundation, concealer, lip, blush; no skin_smooth → 50 | **Confirmed**; send `skin_smooth` at 0. Lip is `lip_color` | [B:makeup_vto], [SK] |
| look-vto: template-based, discovery via MCP | **Confirmed** template-based. **Corrected**: discovery is also available over REST (`GET /s2s/v2.0/task/template/look-vto`) | [B:ai_look_vto] |
| cloth (v2.0) and cloth-v4; `garment_category` upper_body, lower_body, full_body, auto | **Corrected**: all paths are under `/s2s/v2.0/` (`cloth`, `cloth-v3`, `cloth-v4`). The values also include **`shoes`**, and v4 adds **`outer`**. V2/V3 cost 2 units; **V4 cost unconfirmed** | [B:ai_clothes] |
| Bag, shoes, hat, scarf slugs _(confirm)_ | **Resolved:** `bag`, `shoes` (V2), `shoes-transfer` (V3), `hat`, `scarf`; `gender` required; 2 units each; hat, scarf and shoes `style` also changes outfit and background | bundles |
| Jewellery slugs _(confirm)_ | **Resolved:** `2d-vto/earring`, `2d-vto/necklace`, `2d-vto/ring`, `2d-vto/bracelet`, `2d-vto/watch`; 1 unit (2 when stacked) | bundles |
| Fabric slug _(confirm)_ | **Resolved:** `fabric` (template_id required, 2 units) | [B:ai_fabric] |
| hair-color; hair style slug _(confirm)_ | **Confirmed** `hair-color` (1 unit). Style: **`/s2s/v2.1/task/hair-transfer`** (current; also v2.0 `hair-style`/`hair-transfer`), 2 units | [B:ai_hair_color], [B:ai_hairstyle] |
| Background change slug _(confirm)_ | **Resolved:** `bg-replace` (prompt or template), 4 units | [B:ai_photo_background_change] |
| Image-to-video slug _(confirm)_; costliest | **Resolved:** `/s2s/v2.0/task/image-to-video/youcam` (V2). 1/2/3 units per second at 480/720/1080p, so 5–30 units per clip. The prompt passes through the Gemini API | [B:ai_video_generator] |
| Photo background removal slug _(confirm)_ | **Resolved:** `sod`, 1 unit | [B:ai_background_removal] |
| Skin input: jpg/jpeg/png < 10 MB; SD ≥ 480, HD ≥ 1080 short side; > 2560 resized | **Confirmed** | [B:ai_skin_analysis] File Specs |
| Face > 60% of image width; crop to face | **Confirmed** (60%; prose also says 60–80%) | same |
| raw_score 1–100 healthier-higher; ui_score adjusted "as a psychological motivator"; masks; all.score and skin_age | **Confirmed** | same |
| HD concern list | **Confirmed** | same |
| Units table (V2.1) | **Confirmed** (identical for V2.0) | same |
| Skin error codes; mix error `InvalidParameters: cannot mix HD and SD dst_actions` | **Confirmed**: exact body `{"status":400,"error":"cannot mix HD and SD dst_actions","error_code":"InvalidParameters"}` | same |
| Camera Kit script URL; `YMKAsyncInit` before load; `#YMK-module` mandatory | **Confirmed** | [CK] |
| `YMK.init({faceDetectionMode,imageFormat,language,qualityLevel,videoQuality,...})`; modes comprehensive, hdskincare, makeup | **Confirmed** | [CK], [SDK] |
| Events faceQualityChanged, faceDetectionCaptured (base64 or blob), loaded | **Confirmed**. Payload keys: `{hasFace, position, frontal, lighting}` (the SDK also sends `pose`, `size`); the docs' `area` key in "minimum quality" is wrong | [CK], [SDK] |
| HTTPS required except localhost | **Confirmed** | [CK] |
| `videoQuality` 720p/1080p/1920p applies to skincare modes; HD needs ≥ 1080 short side | **Confirmed**; ignored in `comprehensive` (SDK). Whether a `comprehensive` capture meets the HD 1080 short-side minimum is **unconfirmed** | [CK], [SDK] |
| MCP: three servers; base URL and auth _(confirm)_ | **Confirmed**: `https://mcp-api-01.makeupar.com/mcp/{beauty,fashion,creators}`, `Authorization: Bearer <key>` | [D:mcp] |
| Skills repo, six Skills; api-fallback.yaml has makeup-vto defaults | **Confirmed** | [SK], [D:agent_skills] |
| CLI for batch and scripted calls | **Confirmed**: `@youcam_cli/youcam-cli` | [D:cli] |
| Lesson 1: `v1.0/task/cloth` fails; use the bundle versions | **Consistent**: no v1.0 cloth path exists in the bundle; use `/s2s/v2.0/task/cloth-v4` | [B:ai_clothes] |
| Lesson 2: try-on may return the original clothing | **Partly documented**: the engine error `error_editing_failed` exists for "result too similar to source"; a silent return is not documented | [B:ai_clothes] |
| Lesson 3: 16.5–28 s per try-on | **Unconfirmed** (no latency figures published) | — |
| Lesson 4: a clothes try-on costs 2 units | **Confirmed** for V2/V3; V4 is not listed | [B:ai_clothes] |
| Lesson 5: errors as stringified tuples | **Unconfirmed** | — |

### Still unconfirmed (and what I tried)

1. **India or regional server.** I checked the API Server page (HTML and .md), the `servers` block of all 67 bundles, a web search and the press pages. Devpost returned 403. Ask the organisers.
2. **`dst_id` field and its chaining input.** I searched all bundles' schemas and found it in prose only. Capture a live response to settle it.
3. **cloth-v4 unit cost.** It is absent from the bundle table, and the pricing page is JS-rendered with no table in its HTML. Call `GET /s2s/v2.0/credit/feature-cost`; it is free.
4. **Which features send webhooks, plus retry policy and source IPs.** None of these is documented.
5. **Concurrency limit.** Not documented.
6. **Task/result retention, 24 h vs 30 d.** The two official pages conflict.
7. **How to request the Skin Analysis "Advanced Skin Report" (`llm_results`).** No request field exists for it, and the meaning of `pf_camera_kit` is also undocumented.
8. **Camera Kit `comprehensive` output resolution relative to the HD 1080 px minimum.**
9. **Latency figures, and the "stringified tuple" error shape.**

### Bundle quirks to know before generating a client

- Many `GET` status schemas show `data.results: null` with the `$ref` to `TaskStatusResponseBodySingleUrlResultsV2` (`{url}`) hoisted to the wrong level. `FileResponseV2` has the same problem with `data: null`. Generated types will be wrong unless you patch them.
- The credit v1.0 endpoints declare an "access_token" security scheme, while the official tooling uses the API key.
- The feature-cost example says "SD 5~7 concerns", but the table says 5–8.
