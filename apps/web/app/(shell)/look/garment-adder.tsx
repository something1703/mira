"use client";

import {
  GarmentItem,
  type GarmentCategory,
  type GarmentKind,
  type Quote,
  type RunNode,
} from "@mira/schemas";
import type { z } from "zod";
import { Banner, Button, ErrorPanel, Field, QuoteSheet, Tabs } from "@mira/ui";
import { useEffect, useState } from "react";
import { discardPhoto, uploadPhoto } from "../../../src/capture/upload";
import { UPLOAD_MESSAGES } from "../../../src/capture/copy";
import {
  CatalogueReply,
  ExtractReply,
  GarmentQuoteReply,
  GarmentReply,
} from "../../../src/look/api";
import { LOOK_REASONS, OUTFIT_CATEGORIES, QUOTE_WORDS } from "../../../src/look/copy";
import { RunView } from "../../../src/runs/api";

/**
 * Adding a garment (docs/UX_FLOWS.md §6, Empty): paste a product link, browse samples, or upload a
 * photo. A link or a photo is read for its colour by YouCam and the engines, which is quoted first
 * like any spend. A sample is free and says it is a sample.
 */
type Stage =
  | { s: "choose" }
  | { s: "working"; what: string }
  | { s: "quote"; photo: string; name: string; source: GarmentSource; q: Quote }
  | { s: "reading"; photo: string }
  | { s: "failed"; message: string };

type GarmentSource = { kind: "link"; url: string } | { kind: "upload" };

const KIND_WORD: Record<GarmentKind, string> = {
  outfit: "outfit",
  shoes: "shoes",
  bag: "bag",
};

const post = async (path: string, body: unknown): Promise<{ status: number; json: unknown }> => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
};

const reasonOf = (json: unknown): string => {
  const code = (json as { error?: unknown } | undefined)?.error;
  return typeof code === "string"
    ? (LOOK_REASONS[code] ?? "That did not work. Nothing was charged.")
    : "That did not work. Nothing was charged.";
};

export function GarmentAdder({
  kind,
  onPicked,
  onCancel,
}: {
  kind: GarmentKind;
  onPicked: (g: GarmentItem) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ s: "choose" });
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<GarmentCategory>(
    kind === "shoes" ? "shoes" : kind === "bag" ? "auto" : "full_body",
  );
  const [samples, setSamples] = useState<CatalogueReply["garments"]>([]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/look/catalogue")
      .then(async (r) => (r.ok ? CatalogueReply.safeParse(await r.json()) : undefined))
      .then((p) => {
        if (alive && p?.success) setSamples(p.data.garments.filter((g) => g.kind === kind));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kind]);

  const toQuote = async (photo: string, garmentName: string, source: GarmentSource) => {
    setStage({ s: "working", what: "Working out the units" });
    const res = await post("/api/look/garments/quote", {
      photo,
      name: garmentName,
      kind,
      category,
      source,
    });
    const parsed = GarmentQuoteReply.safeParse(res.json);
    if (res.status !== 200 || !parsed.success) {
      void discardPhoto(photo);
      setStage({ s: "failed", message: reasonOf(res.json) });
      return;
    }
    setStage({ s: "quote", photo, name: garmentName, source, q: parsed.data.quote });
  };

  const fromLink = async () => {
    setStage({ s: "working", what: "Reading the page" });
    const res = await post("/api/look/garments/extract", { url: link.trim() });
    const parsed = ExtractReply.safeParse(res.json);
    if (res.status !== 200 || !parsed.success) {
      setStage({
        s: "failed",
        message:
          (res.json as { error?: string } | undefined)?.error === "garment_not_readable"
            ? "No garment picture could be read from that page. Upload a photo of the garment instead."
            : reasonOf(res.json),
      });
      return;
    }
    await toQuote(parsed.data.photo, parsed.data.name, { kind: "link", url: link.trim() });
  };

  const fromFile = async (file: File) => {
    setStage({ s: "working", what: "Uploading the photo" });
    const out = await uploadPhoto(file, "garment", () => undefined);
    if (!out.ok) {
      setStage({ s: "failed", message: UPLOAD_MESSAGES[out.code] });
      return;
    }
    await toQuote(out.value.key, name.trim() === "" ? "My garment" : name.trim(), {
      kind: "upload",
    });
  };

  const sample = async (id: string) => {
    setStage({ s: "working", what: "Adding the sample" });
    const res = await post("/api/look/garments/sample", { sampleId: id });
    const parsed = GarmentReply.safeParse(res.json);
    if (res.status !== 201 || !parsed.success) {
      setStage({ s: "failed", message: reasonOf(res.json) });
      return;
    }
    onPicked(parsed.data.garment);
  };

  const confirm = async (s: Extract<Stage, { s: "quote" }>) => {
    setStage({ s: "reading", photo: s.photo });
    const res = await post("/api/look/garments/ingest", {
      photo: s.photo,
      name: s.name,
      kind,
      category,
      source: s.source,
      confirmedTotal: s.q.total,
    });
    const parsed = GarmentQuoteReply.safeParse(res.json);
    if (res.status !== 201 || !parsed.success || parsed.data.runId === undefined) {
      setStage({
        s: "failed",
        message:
          (res.json as { error?: string } | undefined)?.error === "quote_changed"
            ? (LOOK_REASONS.quote_changed ?? "")
            : reasonOf(res.json),
      });
      return;
    }
    const runId = parsed.data.runId;
    // The run is two short steps; poll until it is over.
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 1_000));
      const view = await fetch(`/api/runs/${runId}`, { cache: "no-store" })
        .then(async (r) => (r.ok ? RunView.safeParse(await r.json()) : undefined))
        .catch(() => undefined);
      if (!view?.success) continue;
      const status = view.data.run.status;
      if (status === "queued" || status === "running") continue;
      const node = view.data.nodes.find((n: RunNode) => n.id === "garment");
      const garment = GarmentItem.safeParse(node?.output);
      if (garment.success) {
        onPicked(garment.data);
        return;
      }
      const failure = view.data.nodes.find((n: RunNode) => n.error)?.error?.code;
      setStage({
        s: "failed",
        message:
          failure === "error_no_face" || failure === undefined
            ? "MIRA could not read a garment colour from that picture. No units were used."
            : (LOOK_REASONS[failure] ?? "MIRA could not read a garment colour from that picture."),
      });
      return;
    }
    setStage({ s: "failed", message: "Reading the garment is taking too long. Try again." });
  };

  if (stage.s === "working" || stage.s === "reading") {
    return (
      <p role="status">{stage.s === "working" ? stage.what : "Reading the garment's colour"}</p>
    );
  }
  if (stage.s === "quote") {
    return (
      <QuoteSheet
        state={stage.q.overCap ? "over_cap" : "ready"}
        title={`Read the colour of ${stage.name}?`}
        lines={stage.q.lines.map((l) => ({
          label: QUOTE_WORDS[l.label] ?? l.label,
          units: l.units,
        }))}
        unitsLeft={stage.q.sessionUnitsLeft}
        confirmLabel="Read the colour"
        onConfirm={() => void confirm(stage)}
        onCancel={() => {
          void discardPhoto(stage.photo);
          onCancel();
        }}
      />
    );
  }
  if (stage.s === "failed") {
    return (
      <ErrorPanel
        title="That garment could not be added."
        why={stage.message}
        actions={
          <Button
            onClick={() => {
              setStage({ s: "choose" });
            }}
          >
            Try another way
          </Button>
        }
      />
    );
  }

  return (
    <div className="look__adder">
      {kind === "outfit" ? (
        <label className="look__select">
          <span>What kind of outfit is it?</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as GarmentCategory);
            }}
          >
            {OUTFIT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <Tabs
        label={`Add ${KIND_WORD[kind]}`}
        items={[
          {
            value: "link",
            label: "Paste a link",
            content: (
              <form
                className="look__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void fromLink();
                }}
              >
                <Field
                  label="Product page address"
                  hint="MIRA reads the page's picture and title. Nothing else on the page is used."
                  inputMode="url"
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                  }}
                />
                <Button type="submit" disabled={link.trim() === ""}>
                  Read this page
                </Button>
              </form>
            ),
          },
          {
            value: "browse",
            label: "Browse samples",
            content:
              samples.length === 0 ? (
                <p>
                  There are no sample {KIND_WORD[kind]}s to browse. Paste a product link or upload a
                  photo.
                </p>
              ) : (
                <>
                  <Banner kind="info">
                    Sample garments are drawn shapes in invented colours, not products.
                  </Banner>
                  <ul className="look__samples" aria-label={`Sample ${KIND_WORD[kind]}s`}>
                    {samples.map((g) => (
                      <li key={g.id}>
                        <button type="button" onClick={() => void sample(g.id)}>
                          <span
                            className="look__chip"
                            style={{ background: g.hex }}
                            aria-hidden="true"
                          />
                          {g.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ),
          },
          {
            value: "upload",
            label: "Upload a photo",
            content: (
              <div className="look__form">
                <Field
                  label="Name this garment"
                  value={name}
                  maxLength={120}
                  onChange={(e) => {
                    setName(e.target.value);
                  }}
                />
                <Field
                  label="Photo of the garment"
                  hint="A clear photo of the garment on its own, as JPEG or PNG."
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void fromFile(file);
                  }}
                />
              </div>
            ),
          },
        ]}
      />
      <Button variant="quiet" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

type CatalogueReply = z.infer<typeof CatalogueReply>;
