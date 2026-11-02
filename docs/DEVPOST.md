# MIRA: Devpost description (draft)

Draft only. Nothing here is submitted. Every claim maps to a row in `docs/FACTS.md`; the status of that row decides what may be said. Facts that are **To measure** are described as plans, never as results. Before submitting, replace the mock-mode wording with what a live run has measured.

## The problem

Virtual try-on previews are usually airbrushed, and nobody checks them. A shade that looks right on screen can be the wrong colour on a face, and a product that promises a visible change rarely says how large a change this person's photos can show.

## What MIRA does

MIRA measures its own renders and tells you what it measured, in plain words.

| Module   | What it does                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------- |
| Twin     | Builds a numbers-only profile from a few photos. You can see every value and delete all of it.         |
| Shade    | Renders shades unretouched, re-measures the colour that shows, and ranks the closest blends.          |
| Look     | Composes an outfit, shoes, bag, makeup and hair, then audits the garment, lip and face against the source. |
| Event    | Plans a look for each function of an event on one board.                                              |
| Proof    | Checks whether a product's visible claim shows up in your own photos, against your own photo-to-photo variation. |
| Ask MIRA | An assistant that explains and plans. It never types a number and never starts a paid run unconfirmed. |
| For brands | A console that shows shade coverage gaps from people who opted in, in groups of at least 20.        |

## How YouCam is used

Skin analysis, skin tone analysis, makeup and hair try-on, clothes, shoes and bag try-on, face comparison, background and video features, and the YouCam MCP for discovery. MIRA runs the multi-step work itself through its own workflow graph, so every step, its price in units and its result is visible and a stored task is polled, never resubmitted.

## Why it can be trusted

- Previews are unretouched by default, and the colour that shows is measured again after the render.
- A render that drifts from the person's face withholds every picture and stops the later steps.
- The language model never writes a digit: figures are injected by the renderer from measured values, and anything else is replaced by a fixed sentence.
- The design removes photos at the end of a run and keeps numbers only in the Twin. This is tested against the file-backed mock; the live storage rules are not applied yet (`docs/SECURITY_REVIEW.md` O1).
- Proof reports a change only when it is larger than the smallest change this person's photos can show.

## Honest status

Everything above runs end to end in mock mode with the real analysis engines and drawn stand-in pictures. Mock results show structure, not evidence. At the time of writing no real person has been measured, the shade, chain-quality, drape, noise-floor and phantom experiments are written but not run (`experiments/`), and the brand console is not open to real brands.

## For other agents

`mira-mcp` offers four read-only tools (shade match, measure change, audit a render, explain a metric) behind bearer tokens with daily unit caps, and the Skill `measured-shade-match` wraps them.

## Built with

TypeScript, Next.js, Fastify, Python and FastAPI, the YouCam API, Google Cloud (Cloud Run, Cloud Tasks, Firestore, Pub/Sub, Cloud Storage, BigQuery) and Vertex AI. The Google Cloud pieces are written as infrastructure code and not yet deployed.

## Try it

Live URL: to be added after deploy. Repository: to be added. A fresh clone runs in mock mode with no credentials: `pnpm install && pnpm dev:mock`.
