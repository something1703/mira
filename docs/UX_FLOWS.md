# UX flows: every screen, every state

A screen is done only when every state listed here is implemented and has a Playwright test. Copy follows `docs/COPY.md`; components follow `docs/DESIGN_SYSTEM.md`.

## 0. Global states (apply on every screen)

| State | Trigger | What the person sees | Actions |
| --- | --- | --- | --- |
| Recorded run | `MIRA_MODE=mock` or budget fallback | Banner: "You are viewing a recorded run. Results are real YouCam outputs captured earlier." | Dismiss for this session |
| Offline | Browser offline | Banner: "You are offline. Measurements will resume when you reconnect." Actions that need the network are disabled with that reason | — |
| Session budget low | Under 20% of session cap | Banner: "Units left in this session: N." | See what uses units |
| Session budget reached | Cap reached | QuoteSheet "over cap" state on the next action | Use a recorded run, start new session |
| Background run finished | A run completes while on another screen | Toast with the action's verb + link to the result | Open |
| Unexpected error | Unhandled exception | ErrorPanel with trace ID: "Something failed on our side. The run was stopped and no units were charged for unfinished steps." | Retry, go home |

## 1. Welcome

Purpose: say what MIRA does in one screen and start measuring.

Layout: the Ring at rest, display line "Look, measured.", one paragraph, primary "Start measuring", secondary "See a recorded run".

| State | What the person sees |
| --- | --- |
| First visit | As above |
| Returning, profile exists | "Welcome back." Shortcuts: Match my shade, Build a look, Check my progress |
| Returning, profile deleted | First-visit layout |

## 2. Consent and privacy

Purpose: explain exactly what is captured, kept and deleted before the camera opens.

Content: what is measured, that images are deleted after measuring, what is kept (numbers only), that nothing is medical, how to delete everything. Checkbox "I understand and want to continue" enables "Open the camera".

| State | What the person sees |
| --- | --- |
| Default | Consent text, unchecked box, disabled button with reason "Tick the box to continue" |
| Ticked | Button enabled |
| Declined | "You can still try MIRA with a recorded run." Button: See a recorded run |

## 3. Capture (face, body, hand, hair)

Purpose: get images good enough to measure, guided entirely by the Ring.

Sequence: face (comprehensive + HD skincare) → repeat face captures for the noise floor (2 more, a few seconds apart) → full body → hand (optional) → hair angles (optional). A step rail shows where the person is; optional steps can be skipped.

| State | Trigger | What the person sees | Actions |
| --- | --- | --- | --- |
| Permission prompt | Camera not yet allowed | "MIRA needs your camera to measure. Nothing is recorded until you capture." | Allow camera, Upload a photo instead |
| Permission denied | Browser denied | "Camera access is off. Turn it on in your browser settings, or upload a photo." | How to turn it on, Upload a photo |
| Unsupported | No `getUserMedia` or no HTTPS | "This browser cannot open the camera. Upload a photo instead." | Upload |
| Low camera resolution | Camera below HD requirement | "This camera cannot capture the detail HD measuring needs. MIRA will measure in standard detail." | Continue in standard, Upload a sharper photo |
| Checking | Live preview | Ring ticks light as each check passes; one instruction names the failing check | — |
| Lighting failing | Camera Kit lighting check | "Face a window or a lamp so your face is evenly lit." | — |
| Distance failing | Face too small/large | "Move a little closer" / "Move back a little" | — |
| Angle failing | Head turned/tilted | "Look straight at the camera." | — |
| Glasses or fringe | Detected obstruction | "Take off glasses and move hair off your forehead if you can." | Continue anyway |
| Ready | All checks pass | Ring complete; countdown | Cancel |
| Captured | Auto-capture | Freeze-frame on the mat, "Use this photo" | Use this photo, Retake |
| Uploading | File API + PUT | Ring progress, "Uploading securely" | Cancel |
| YouCam quality error | e.g. face too small, too dark, out of bound | Specific guidance from `docs/COPY.md`; "No units were used." | Retake |
| Upload path | Person chose upload | File picker, then the same quality messages after the check | Choose another photo |

## 4. Measured profile (Twin)

Purpose: show what was measured, plainly, and let the person correct or delete it.

Layout: a list of readings grouped as Skin, Colouring, Face, Hair. Each reading shows value, unit and confidence words. Colouring shows swatches of measured skin, lip, hair, eye colour on the mat.

| State | What the person sees | Actions |
| --- | --- | --- |
| Building | StepRail with each analyser; Ring progress | Cancel (stops unstarted steps) |
| Ready | All readings | Match my shade, Build a look, Check my progress |
| Partial | Some analysers failed | Failed groups show "Not measured" + reason | Retry that group |
| Noise floor missing | Repeat captures skipped | Proof shows "Needs 2 more captures to know your day-to-day variation" | Add captures |
| Deleted | After delete | Returns to Welcome, toast "Profile deleted" | — |

## 5. Shade

Purpose: find the foundation (and concealer) shade that measurably disappears on the person's skin.

Flow: choose a brand range (search or paste a product link) → MIRA pre-ranks every shade with free maths → QuoteSheet for rendering the top shades → results.

| State | What the person sees | Actions |
| --- | --- | --- |
| Choose range | Search field, recent ranges | Paste link, search |
| Reading the page | "Reading the shade range" | Cancel |
| Range not readable | "MIRA could not find shade colours on this page. Try the brand's shade-finder page or another product." | Try another link |
| Pre-ranked | Swatches ordered by ΔE, "Checked N shades for free" | Preview the closest shades |
| Quoting / quote ready | QuoteSheet: shades to render, units | Confirm, Cancel |
| Rendering | StepRail per shade, plates fill as they finish | Cancel remaining |
| Results | Best match plate, label "Verified: blends within ΔE x", runner-ups, finish and coverage reasoning | Choose, Build a look with this |
| No match in range | "No shade in this range blends closely. The closest is shown; it reads lighter and cooler than your skin." | Try another brand |
| Drift on a render | Plate with drift label; excluded from "best match" | — |
| Partial | "4 of 5 shades rendered" | Retry missing |

## 6. Look Studio (Complete Look)

Purpose: one coherent look across clothes, accessories, jewellery, makeup and hair, in context, in motion.

Layout: left, the look's slots (Outfit, Shoes, Bag, Jewellery, Makeup, Hair, Venue, Motion); right, the plate. Makeup and hair slots show MIRA's suggestion with "why" (garment colour + measured colouring).

| State | What the person sees | Actions |
| --- | --- | --- |
| Empty | "Pick an outfit to build your first look." | Paste product link, browse catalogue |
| Slots filled | Summary of choices, makeup suggestion | Build this look |
| Quote ready | QuoteSheet with per-step units; video shown as the costliest step | Confirm, Remove video, Cancel |
| Building | StepRail: clothes → accessories → makeup → hair → checks → venue → video; plate updates after each verified step | Cancel remaining |
| Garment drift | Plate shown with "Colour drifted" label | Retry this step, Keep |
| Identity drift | "This preview changed your face, so MIRA did not show it." | Retry, Skip step |
| Video generating | Still plate shown, progress for video | Watch when ready |
| Done | Final plate + video, fidelity labels per element | Save look, Share, Change one item |
| Saved | Toast "Look saved" | — |

## 7. Event Mode

Purpose: plan several looks for one multi-day event (e.g. haldi, mehendi, sangeet, wedding, reception).

| State | What the person sees | Actions |
| --- | --- | --- |
| Setup | Event name, functions list (editable), each with time of day and venue type | Add function, Plan looks |
| Planning | Per-function cards in the plate layout, each built through Look Studio | Open function |
| Overview | All looks side by side on the mat, with any skin-prep Proof timeline aligned to the event date | Download board, Share |
| Partially planned | Unbuilt functions show "Not planned yet" | Build look |

## 8. Proof

Purpose: tell the person whether a skincare product is visibly working, above their own day-to-day variation.

| State | What the person sees | Actions |
| --- | --- | --- |
| Add product | Paste link or type name | Continue |
| Claim extracted | "This product claims: visible pores, over 4 weeks." Editable | Confirm claim, Edit |
| No claim found | "No measurable claim found on this page. Choose what you want to track." | Pick concern + timeframe |
| Baseline needed | "MIRA needs 3 captures on different days to learn your day-to-day variation." Progress 0/3 | Capture now |
| Calibrating | StepRail for the phantom (simulation + re-measure) | — |
| Calibration not usable | "MIRA cannot visualise changes for this concern reliably, so it will report numbers only." | Continue |
| Claim preview | Plate: "What the stated claim would look like on you" labelled as visualisation | Continue |
| Check-in due | Reminder; Ring capture × 3 | Check in now, Remind me tomorrow |
| Verdict: detected | Display sentence, Reading with noise band, timeline chart, progress visualisation plate | Keep going, Stop tracking |
| Verdict: not yet | Display sentence with day count of claim window | Keep going |
| Window ended, no change | "No change MIRA can tell apart from your day-to-day variation over the claimed period." | Stop tracking, Leave a measured review |
| Confound warning | Person reports starting another product | "Two new products at once means MIRA cannot tell which one changed things." | Keep tracking anyway, Pause |

## 9. Ask MIRA (agent panel)

Purpose: conversational entry to every module; available on every screen as a side panel (sheet on mobile).

| State | What the person sees | Actions |
| --- | --- | --- |
| Idle | Three suggestions relevant to the current screen | Type, pick a suggestion |
| Thinking | "Working out a plan" | Stop |
| Plan + quote | QuoteSheet inside the panel | Confirm, Change, Cancel |
| Running | Compact StepRail linked to the full screen | Open full view |
| Answer | Sentences with readings rendered from metric IDs; links to plates | Follow-up |
| Fallback answer | Linter rejected the model twice; templated sentence | — |
| Model unavailable | "The assistant is unavailable right now. Every tool still works from its own screen." | Go to the tool |
| Out of scope | Medical question asked | "MIRA describes appearance only and cannot help with medical questions. A dermatologist can." | — |

## 10. Brand console

Purpose: show a brand what MIRA's anonymised measurements say about its range.

| State | What the brand sees | Actions |
| --- | --- | --- |
| No catalogue | "Add your range to see who it serves." | Upload CSV, paste product links |
| Ingesting | StepRail per product | — |
| Shade Gap Map | Chart (see Design System §10), share of shoppers without a match | Export |
| Efficacy | Completed Proofs per product, by measured skin type and band | Export |
| Attach | Looks combining apparel and beauty | Export |
| Cohort too small | Cell hidden: "Fewer than N shoppers; hidden to protect privacy." | — |
| Recorded data | Banner as global state | — |

## 11. Settings and privacy

| State | What the person sees | Actions |
| --- | --- | --- |
| Default | Every stored number, grouped; what was deleted and when | Download my data, Delete my profile |
| Confirm delete | Dialog: what will be deleted; critical button "Delete my profile" | Delete, Cancel |
| Deleting | Progress | — |
| Deleted | Toast "Profile deleted"; back to Welcome | — |

## 12. Run viewer (developer and demo)

Shows a run's graph with nodes lighting up, per-node units, cache hits, audit outcomes, and the ledger. Hidden behind `?dev=1`. Used in the demo video to show orchestration.
