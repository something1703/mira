"use client";

import type { GarmentItem, GarmentKind, LookSuggestion } from "@mira/schemas";
import type { z } from "zod";
import {
  Banner,
  Button,
  ErrorPanel,
  Plate,
  QuoteSheet,
  Swatch,
  SwatchList,
  Toggle,
} from "@mira/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { discardPhoto } from "../../../src/capture/upload";
import type { Photo } from "../../../src/capture/flow";
import { findFunction, loadEvent } from "../../../src/event/store";
import {
  DRAFT_KEY,
  DraftStore,
  LookQuoteReply,
  SuggestReply,
  VenuesReply,
  emptyDraft,
  type Draft,
} from "../../../src/look/api";
import {
  BLUSH_WHY,
  HAIR_COLOURS,
  LIP_WHY,
  LOOK_REASONS,
  QUOTE_WORDS,
  SLOT_NAMES,
  VENUE_PROMPTS,
} from "../../../src/look/copy";
import { PhotoStep } from "../capture/photo-step";
import { GarmentAdder } from "./garment-adder";

type QuoteReply = z.infer<typeof LookQuoteReply>;

type View = { v: "slots" } | { v: "add"; kind: GarmentKind } | { v: "photo" } | { v: "quote" };

type Suggest =
  | { s: "idle" }
  | { s: "loading" }
  | { s: "ok"; value: LookSuggestion }
  | { s: "error"; message: string };

type Quoting =
  | { s: "quoting" }
  | { s: "ready"; q: QuoteReply }
  | { s: "starting"; q: QuoteReply }
  | { s: "failed"; message: string };

const VENUE_TYPES = [
  ["hall", "Hall"],
  ["garden", "Garden"],
  ["outdoor", "Outdoors"],
  ["indoor", "Indoors"],
  ["temple", "Temple"],
  ["beach", "Beach"],
] as const;

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw === null) return emptyDraft();
    const parsed = DraftStore.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyDraft();
  } catch {
    return emptyDraft();
  }
}

const post = async (path: string, body: unknown) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => undefined)) as unknown };
};

const reasonOf = (json: unknown): string => {
  const code = (json as { error?: unknown } | undefined)?.error;
  return typeof code === "string"
    ? (LOOK_REASONS[code] ?? "That did not work. Nothing was charged.")
    : "That did not work. Nothing was charged.";
};

export function LookStudio({ functionId }: { functionId?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ v: "slots" });
  const [photo, setPhoto] = useState<Photo | undefined>();
  const [suggest, setSuggest] = useState<Suggest>({ s: "idle" });
  const [quoting, setQuoting] = useState<Quoting>({ s: "quoting" });
  const [removed, setRemoved] = useState<string[]>([]);
  const [fnName, setFnName] = useState<string | undefined>();
  const [venueType, setVenueType] = useState<string>("hall");
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);

  // Reading browser storage happens after mount, so the server and browser agree on first paint.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser state after hydration */
    setDraft(loadDraft());
    const fn = findFunction(loadEvent(), functionId);
    if (fn) {
      setFnName(fn.name);
      setVenueType(fn.venue);
    }
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [functionId]);

  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Storage blocked: the draft lasts until the page is left.
    }
  }, [draft, loaded]);

  // A held photo is deleted if the person leaves with it unused.
  useEffect(
    () => () => {
      if (photo) void discardPhoto(photo.key);
    },
    // Only the last photo held when the screen unmounts matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // The suggestion follows the outfit: its hue is part of the rule (docs/ENGINES.md §5).
  const outfitId = draft.outfit?.id;
  useEffect(() => {
    if (outfitId === undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no outfit, so no suggestion
      setSuggest({ s: "idle" });
      return;
    }
    let alive = true;

    setSuggest({ s: "loading" });
    void post("/api/look/suggest", { outfitId }).then((res) => {
      if (!alive) return;
      const parsed = SuggestReply.safeParse(res.json);
      setSuggest(
        res.status === 200 && parsed.success
          ? { s: "ok", value: parsed.data.suggestion }
          : { s: "error", message: reasonOf(res.json) },
      );
    });
    return () => {
      alive = false;
    };
  }, [outfitId]);

  // Venue presets the assistant's discovery finds; the written ones below are always offered.
  useEffect(() => {
    let alive = true;
    void fetch(`/api/look/venues?type=${venueType}`)
      .then(async (r) => (r.ok ? VenuesReply.safeParse(await r.json()) : undefined))
      .then((p) => {
        if (alive) setTemplates(p?.success ? p.data.items : []);
      })
      .catch(() => {
        if (alive) setTemplates([]);
      });
    return () => {
      alive = false;
    };
  }, [venueType]);

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const makeup = draft.makeup && suggest.s === "ok" && suggest.value.lip !== undefined;
  const request = useMemo(
    () => ({
      photo: photo?.key,
      outfitId: draft.outfit?.id ?? "",
      ...(draft.shoes ? { shoesId: draft.shoes.id } : {}),
      ...(draft.bag ? { bagId: draft.bag.id, bagGender: draft.bagGender } : {}),
      ...(makeup ? { makeup: true } : {}),
      ...(draft.hairHex ? { hairHex: draft.hairHex } : {}),
      ...(draft.venue ? { venue: draft.venue.choice } : {}),
      ...(draft.video ? { video: true } : {}),
      ...(removed.length > 0 ? { removedSteps: removed } : {}),
    }),
    [photo?.key, draft, makeup, removed],
  );

  const getQuote = useCallback(async () => {
    setQuoting({ s: "quoting" });
    const res = await post("/api/look/quote", request);
    const parsed = LookQuoteReply.safeParse(res.json);
    setQuoting(
      res.status === 200 && parsed.success
        ? { s: "ready", q: parsed.data }
        : { s: "failed", message: reasonOf(res.json) },
    );
  }, [request]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a price is asked for when this screen opens
    if (view.v === "quote") void getQuote();
  }, [view.v, getQuote]);

  const start = async (q: Extract<Quoting, { s: "ready" }>["q"]) => {
    setQuoting({ s: "starting", q });
    const res = await post("/api/look/build", { ...request, confirmedTotal: q.quote.total });
    const parsed = LookQuoteReply.safeParse(res.json);
    if (res.status === 201 && parsed.success && parsed.data.runId) {
      // The run owns the photo from here; it is deleted when the run ends.
      setPhoto(undefined);
      router.push(`/look?run=${parsed.data.runId}${functionId ? `&fn=${functionId}` : ""}`);
      return;
    }
    setQuoting({ s: "failed", message: reasonOf(res.json) });
  };

  const pick = (kind: GarmentKind, g: GarmentItem) => {
    update(kind === "outfit" ? { outfit: g } : kind === "shoes" ? { shoes: g } : { bag: g });
    setView({ v: "slots" });
  };

  if (!loaded) return <p role="status">Opening Look Studio</p>;

  if (view.v === "add") {
    return (
      <div className="look">
        <h1 className="mira-display-l">
          Pick {view.kind === "outfit" ? "an outfit" : `your ${view.kind}`}
        </h1>
        <GarmentAdder
          kind={view.kind}
          onPicked={(g) => {
            pick(view.kind, g);
          }}
          onCancel={() => {
            setView({ v: "slots" });
          }}
        />
      </div>
    );
  }

  if (view.v === "photo") {
    return (
      <div className="look">
        <h1 className="mira-display-l">Add a full-length photo</h1>
        <p className="lead">
          Stand in a plain, light top so the new outfit shows. Your whole body and your face should
          be in the photo. It is deleted when the look finishes.
        </p>
        <PhotoStep
          label="Full-length photo for your look"
          engine="plain"
          kinds={["body"]}
          hd={false}
          onStandardDetail={() => undefined}
          review
          autoStart={false}
          onAccept={(photos) => {
            const [p] = photos;
            if (p) {
              setPhoto(p);
              setView({ v: "slots" });
            }
          }}
          onSkip={() => {
            setView({ v: "slots" });
          }}
        />
      </div>
    );
  }

  if (view.v === "quote") {
    const lines = new Map<string, number>();
    if (quoting.s === "ready" || quoting.s === "starting") {
      for (const l of quoting.q.quote.lines) {
        const label = QUOTE_WORDS[l.label] ?? l.label;
        lines.set(label, (lines.get(label) ?? 0) + l.units);
      }
    }
    const q = quoting.s === "ready" || quoting.s === "starting" ? quoting.q : undefined;
    const hasVideo = q?.steps.includes("video") ?? false;
    const videoUnits = q?.quote.lines.find((l) => l.nodeId === "video")?.units ?? 0;
    const biggest = [...lines].sort((a, b) => b[1] - a[1])[0];
    return (
      <div className="look">
        {q?.synthetic ? <SampleBanner /> : null}
        {quoting.s === "failed" ? (
          <ErrorPanel
            title="This look could not be quoted."
            why={quoting.message}
            actions={
              <Button
                onClick={() => {
                  setView({ v: "slots" });
                }}
              >
                Change the look
              </Button>
            }
          />
        ) : (
          <QuoteSheet
            state={
              quoting.s === "quoting"
                ? "quoting"
                : quoting.s === "starting"
                  ? "confirmed"
                  : quoting.q.quote.overCap
                    ? "over_cap"
                    : "ready"
            }
            title="Build this look?"
            lines={[...lines].map(([label, units]) => ({ label, units }))}
            {...(q ? { unitsLeft: q.quote.sessionUnitsLeft } : {})}
            confirmLabel="Build this look"
            onConfirm={() => {
              if (quoting.s === "ready") void start(quoting.q);
            }}
            onCancel={() => {
              setView({ v: "slots" });
            }}
            extraActions={
              hasVideo ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRemoved((r) => [...r, "video"]);
                  }}
                >
                  Remove video
                </Button>
              ) : null
            }
          />
        )}
        {hasVideo && biggest ? (
          <p className="mira-small">
            The video is the costliest step at {String(videoUnits)} units, and it is made only if
            every check passes.
          </p>
        ) : null}
      </div>
    );
  }

  const ready = draft.outfit !== undefined && photo !== undefined;
  const venueList = VENUE_PROMPTS[venueType] ?? VENUE_PROMPTS.other ?? [];
  return (
    <div className="look">
      <header>
        <h1 className="mira-display-l">{fnName ? `A look for ${fnName}` : "Build a look"}</h1>
        <p className="lead">
          Clothes, accessories, makeup and hair on you, each step checked. Nothing is rendered until
          you have seen the units.
        </p>
      </header>
      <div className="look__grid">
        <ul className="look__slots" aria-label="Look slots">
          <Slot name={SLOT_NAMES.outfit}>
            {draft.outfit ? (
              <GarmentValue g={draft.outfit} />
            ) : (
              <p>Pick an outfit to build your first look.</p>
            )}
            <Button
              onClick={() => {
                setView({ v: "add", kind: "outfit" });
              }}
            >
              {draft.outfit ? "Change outfit" : "Pick an outfit"}
            </Button>
          </Slot>
          <Slot name={SLOT_NAMES.shoes}>
            {draft.shoes ? <GarmentValue g={draft.shoes} /> : <p>Optional.</p>}
            <Button
              variant="secondary"
              onClick={() => {
                setView({ v: "add", kind: "shoes" });
              }}
            >
              {draft.shoes ? "Change shoes" : "Add shoes"}
            </Button>
            {draft.shoes ? (
              <Button
                variant="quiet"
                onClick={() => {
                  update({ shoes: undefined });
                }}
              >
                Remove shoes
              </Button>
            ) : null}
          </Slot>
          <Slot name={SLOT_NAMES.bag}>
            {draft.bag ? <GarmentValue g={draft.bag} /> : <p>Optional.</p>}
            <Button
              variant="secondary"
              onClick={() => {
                setView({ v: "add", kind: "bag" });
              }}
            >
              {draft.bag ? "Change bag" : "Add a bag"}
            </Button>
            {draft.bag ? (
              <>
                <label className="look__select">
                  <span>Who is wearing it?</span>
                  <select
                    value={draft.bagGender}
                    onChange={(e) => {
                      update({ bagGender: e.target.value === "male" ? "male" : "female" });
                    }}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </select>
                </label>
                <Button
                  variant="quiet"
                  onClick={() => {
                    update({ bag: undefined });
                  }}
                >
                  Remove bag
                </Button>
              </>
            ) : null}
          </Slot>
          <Slot name="Jewellery">
            <p>
              Not available yet. Jewellery try-on needs a mask of your ears and neck, which MIRA
              cannot make.
            </p>
          </Slot>
          <Slot name={SLOT_NAMES.makeup}>
            {draft.outfit === undefined ? (
              <p>Pick an outfit first: the suggestion follows its colour.</p>
            ) : suggest.s === "loading" ? (
              <p role="status">Working out a suggestion</p>
            ) : suggest.s === "error" ? (
              <p>{suggest.message}</p>
            ) : suggest.s === "ok" && suggest.value.lip ? (
              <>
                <Toggle
                  label="Use MIRA's suggestion"
                  description="A documented heuristic, shown as a suggestion."
                  checked={draft.makeup}
                  onCheckedChange={(checked) => {
                    update({ makeup: checked });
                  }}
                />
                <SwatchList label="Suggested makeup">
                  <Swatch colour={suggest.value.lip.hex} name={`Lip: ${suggest.value.lip.name}`} />
                  {suggest.value.blush ? (
                    <Swatch
                      colour={suggest.value.blush.hex}
                      name={`Blush: ${suggest.value.blush.name}`}
                    />
                  ) : null}
                </SwatchList>
                <p className="mira-small">
                  {LIP_WHY[suggest.value.lip.reason] ?? "Chosen from your colouring."}{" "}
                  {suggest.value.blush
                    ? (BLUSH_WHY[suggest.value.blush.reason] ?? "")
                    : "No blush was suggested."}
                </p>
              </>
            ) : (
              <p>No lip colour could be suggested.</p>
            )}
          </Slot>
          <Slot name={SLOT_NAMES.hair}>
            <div role="group" aria-label="Hair colour" className="look__choices">
              <Button
                variant={draft.hairHex === undefined ? "primary" : "secondary"}
                aria-pressed={draft.hairHex === undefined}
                onClick={() => {
                  update({ hairHex: undefined });
                }}
              >
                Keep mine
              </Button>
              {HAIR_COLOURS.map((c) => (
                <Button
                  key={c.hex}
                  variant={draft.hairHex === c.hex ? "primary" : "secondary"}
                  aria-pressed={draft.hairHex === c.hex}
                  onClick={() => {
                    update({ hairHex: c.hex });
                  }}
                >
                  {c.name}
                </Button>
              ))}
            </div>
            <p className="mira-small">
              Hair colour is your choice; MIRA has no hair suggestion yet.
            </p>
          </Slot>
          <Slot name={SLOT_NAMES.venue}>
            <label className="look__select">
              <span>Kind of venue</span>
              <select
                value={venueType}
                onChange={(e) => {
                  setVenueType(e.target.value);
                  update({ venue: undefined });
                }}
              >
                {VENUE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div role="group" aria-label="Venue" className="look__choices">
              <Button
                variant={draft.venue === undefined ? "primary" : "secondary"}
                aria-pressed={draft.venue === undefined}
                onClick={() => {
                  update({ venue: undefined });
                }}
              >
                No venue
              </Button>
              {templates.map((t) => (
                <Button
                  key={t.id}
                  variant={
                    draft.venue?.choice.type === "template" &&
                    draft.venue.choice.templateId === t.id
                      ? "primary"
                      : "secondary"
                  }
                  onClick={() => {
                    update({
                      venue: { name: t.name, choice: { type: "template", templateId: t.id } },
                    });
                  }}
                >
                  {t.name}
                </Button>
              ))}
              {venueList.map((v) => (
                <Button
                  key={v.name}
                  variant={draft.venue?.name === v.name ? "primary" : "secondary"}
                  aria-pressed={draft.venue?.name === v.name}
                  onClick={() => {
                    update({
                      venue: { name: v.name, choice: { type: "prompt", prompt: v.prompt } },
                    });
                  }}
                >
                  {v.name}
                </Button>
              ))}
            </div>
          </Slot>
          <Slot name={SLOT_NAMES.video}>
            <Toggle
              label="Make a short video"
              description="The costliest step. It is made only if every check passes."
              checked={draft.video}
              onCheckedChange={(checked) => {
                update({ video: checked });
                if (checked) setRemoved((r) => r.filter((x) => x !== "video"));
              }}
            />
          </Slot>
        </ul>
        <div className="look__stage">
          <Plate state="ready" alt="Your look appears here once it is built." aspect="4 / 5" />
          {photo ? (
            <p role="status">Full-length photo added.</p>
          ) : (
            <p>Add a full-length photo to build the look on.</p>
          )}
          <div className="mira-row">
            <Button
              variant={photo ? "secondary" : "primary"}
              onClick={() => {
                if (photo) {
                  void discardPhoto(photo.key);
                  setPhoto(undefined);
                }
                setView({ v: "photo" });
              }}
            >
              {photo ? "Take it again" : "Add a photo"}
            </Button>
            <Button
              disabled={!ready}
              onClick={() => {
                setRemoved([]);
                setView({ v: "quote" });
              }}
            >
              Build this look
            </Button>
          </div>
          {!ready ? (
            <p className="mira-small">
              {draft.outfit === undefined ? "Pick an outfit" : "Add a photo"} to build.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Slot({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="look__slot">
      <h2 className="mira-title">{name}</h2>
      <div className="look__slot-body">{children}</div>
    </li>
  );
}

function GarmentValue({ g }: { g: GarmentItem }) {
  return (
    <p className="look__garment">
      <span className="look__chip" style={{ background: g.colour.hex }} aria-hidden="true" />
      <span>
        {g.name}
        {g.sample ? " (sample)" : ""}
        {g.colour.multicolour ? ", more than one colour" : ""}
      </span>
    </p>
  );
}

export function SampleBanner() {
  return (
    <Banner kind="info">
      Sample results. The pictures are drawn stand-ins and the measurements are invented, so nothing
      here describes you.
    </Banner>
  );
}
