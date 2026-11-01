"use client";

import { EventPlan, TimeOfDay, VenueType, type EventFunction } from "@mira/schemas";
import { Banner, Button, EmptyState, Field, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  clearEvent,
  defaultEvent,
  loadEvent,
  newFunctionId,
  saveEvent,
} from "../../../src/event/store";
import { flash } from "../../../src/shell/flash";

const TIMES: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};
const VENUES: Record<string, string> = {
  indoor: "Indoors",
  outdoor: "Outdoors",
  garden: "Garden",
  hall: "Hall",
  beach: "Beach",
  temple: "Temple",
};

/**
 * Event Mode. One board with the states the screen lists: setup (editable functions), planning (a
 * card per function, each built in Look Studio), partially planned ("Not planned yet" on the ones
 * not built) and the overview (every look side by side on the mat). The plan lives in this
 * browser; the looks are the person's saved looks.
 */
export function EventBoard() {
  const [plan, setPlan] = useState<EventPlan | undefined>();
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storeBlocked, setStoreBlocked] = useState(false);

  useEffect(() => {
    // The plan is in this browser's storage, so it can only be read after hydration.
    const stored = loadEvent();
    /* eslint-disable react-hooks/set-state-in-effect -- reading browser state after hydration */
    setPlan(stored ?? defaultEvent());
    setEditing(stored === undefined);
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  if (!loaded || !plan) return <p role="status">Opening your event</p>;

  const built = plan.functions.filter((f) => f.lookId !== undefined).length;
  const state = built === 0 ? "planning" : built === plan.functions.length ? "overview" : "partial";

  const commit = (next: EventPlan) => {
    setPlan(next);
    if (!saveEvent(next)) setStoreBlocked(true);
  };

  if (editing) {
    return (
      <Setup
        plan={plan}
        storeBlocked={storeBlocked}
        onDone={(next) => {
          commit(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="event">
      <header>
        <h1 className="mira-display-l">{plan.name}</h1>
        <p className="lead">
          {state === "planning"
            ? "Plan a look for each function. Each one opens in Look Studio, ready for its venue."
            : state === "partial"
              ? "Some functions have a look. Build the rest to complete the board."
              : "Every function has a look. Download the board or change any one of them."}
        </p>
      </header>
      {storeBlocked ? (
        <Banner kind="info">
          This browser is not keeping your plan. It will be lost when you leave this page.
        </Banner>
      ) : null}
      <ul className="event__board" aria-label="Looks by function" data-state={state}>
        {plan.functions.map((f) => (
          <li key={f.id} className="event__card">
            {f.lookId ? (
              // A saved look of the person's own, served only to them.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/looks/${f.lookId}/image`} alt={`Look for ${f.name}`} />
            ) : (
              <div className="event__empty">Not planned yet</div>
            )}
            <div className="event__foot">
              <p>
                {f.name}, {TIMES[f.timeOfDay]?.toLowerCase()}, {VENUES[f.venue]?.toLowerCase()}
              </p>
              <Link
                href={`/look?fn=${f.id}`}
                className={buttonClass(f.lookId ? "secondary" : "primary")}
              >
                {f.lookId ? `Change the look for ${f.name}` : `Build a look for ${f.name}`}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="mira-row">
        <Button disabled={built === 0} onClick={() => void downloadBoard(plan, "download")}>
          Download board
        </Button>
        <Button
          variant="secondary"
          disabled={built === 0}
          onClick={() => void downloadBoard(plan, "share")}
        >
          Share
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit functions
        </Button>
        <Button
          variant="quiet"
          onClick={() => {
            clearEvent();
            setPlan(defaultEvent());
            setEditing(true);
            flash("Event plan cleared");
          }}
        >
          Clear this plan
        </Button>
      </div>
    </div>
  );
}

function Setup({
  plan,
  storeBlocked,
  onDone,
}: {
  plan: EventPlan;
  storeBlocked: boolean;
  onDone: (plan: EventPlan) => void;
}) {
  const [name, setName] = useState(plan.name);
  const [functions, setFunctions] = useState<EventFunction[]>(plan.functions);
  const change = (id: string, patch: Partial<EventFunction>) => {
    setFunctions((all) => all.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const parsed = EventPlan.safeParse({
    name: name.trim(),
    functions: functions.map((f) => ({ ...f, name: f.name.trim() })),
  });
  return (
    <div className="event">
      <header>
        <h1 className="mira-display-l">Plan an event</h1>
        <p className="lead">
          Name the event and its functions. These are the usual ones for a wedding; change, remove
          or add any. Your plan stays in this browser.
        </p>
      </header>
      {storeBlocked ? (
        <Banner kind="info">This browser is not keeping plans. It will be lost on leaving.</Banner>
      ) : null}
      <Field
        label="Event name"
        value={name}
        maxLength={80}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <ul className="event__functions" aria-label="Functions">
        {functions.map((f) => (
          <li key={f.id} className="event__function">
            <Field
              label="Function"
              value={f.name}
              maxLength={60}
              onChange={(e) => {
                change(f.id, { name: e.target.value });
              }}
            />
            <label className="look__select">
              <span>Time of day</span>
              <select
                value={f.timeOfDay}
                onChange={(e) => {
                  const t = TimeOfDay.safeParse(e.target.value);
                  if (t.success) change(f.id, { timeOfDay: t.data });
                }}
              >
                {TimeOfDay.options.map((t) => (
                  <option key={t} value={t}>
                    {TIMES[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="look__select">
              <span>Venue type</span>
              <select
                value={f.venue}
                onChange={(e) => {
                  const v = VenueType.safeParse(e.target.value);
                  if (v.success) change(f.id, { venue: v.data });
                }}
              >
                {VenueType.options.map((v) => (
                  <option key={v} value={v}>
                    {VENUES[v]}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="quiet"
              disabled={functions.length === 1}
              onClick={() => {
                setFunctions((all) => all.filter((x) => x.id !== f.id));
              }}
            >
              Remove {f.name || "function"}
            </Button>
          </li>
        ))}
      </ul>
      <div className="mira-row">
        <Button
          variant="secondary"
          disabled={functions.length >= 12}
          onClick={() => {
            setFunctions((all) => [
              ...all,
              { id: newFunctionId(), name: "", timeOfDay: "evening", venue: "hall" },
            ]);
          }}
        >
          Add function
        </Button>
        <Button
          disabled={!parsed.success}
          onClick={() => {
            if (parsed.success) onDone(parsed.data);
          }}
        >
          Plan looks
        </Button>
      </div>
      {!parsed.success ? (
        <p className="mira-small" role="status">
          Give the event and every function a name.
        </p>
      ) : null}
    </div>
  );
}

/** Draws the board on the neutral mat and downloads it, or hands it to the share sheet. */
async function downloadBoard(plan: EventPlan, mode: "download" | "share"): Promise<void> {
  const tile = { w: 360, h: 450, gap: 24, cap: 56 };
  const cols = Math.min(3, plan.functions.length);
  const rows = Math.ceil(plan.functions.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * tile.w + (cols + 1) * tile.gap;
  canvas.height = rows * (tile.h + tile.cap) + (rows + 1) * tile.gap;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#777777";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, f] of plan.functions.entries()) {
    const x = tile.gap + (i % cols) * (tile.w + tile.gap);
    const y = tile.gap + Math.floor(i / cols) * (tile.h + tile.cap + tile.gap);
    const bitmap = f.lookId
      ? await fetch(`/api/looks/${f.lookId}/image`)
          .then(async (r) => (r.ok ? await createImageBitmap(await r.blob()) : undefined))
          .catch(() => undefined)
      : undefined;
    if (bitmap) {
      ctx.drawImage(bitmap, x, y, tile.w, tile.h);
    } else {
      ctx.fillStyle = "#EDEDED";
      ctx.fillRect(x, y, tile.w, tile.h);
      ctx.fillStyle = "#1A1A1A";
      ctx.font = "20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.lookId ? "Look deleted" : "Not planned yet", x + tile.w / 2, y + tile.h / 2);
    }
    ctx.fillStyle = "#EDEDED";
    ctx.fillRect(x, y + tile.h, tile.w, tile.cap);
    ctx.fillStyle = "#1A1A1A";
    ctx.font = "bold 22px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(f.name, x + 14, y + tile.h + 34);
  }
  const blob = await new Promise<Blob | null>((r) => {
    canvas.toBlob(r, "image/png");
  });
  if (!blob) return;
  const file = new File([blob], `${plan.name}.png`, { type: "image/png" });
  // Not every browser has a share sheet, so these may be missing at run time.
  const nav = navigator as Partial<Pick<Navigator, "canShare" | "share">>;
  if (mode === "share" && nav.canShare?.({ files: [file] })) {
    await nav.share?.({ files: [file], title: plan.name }).catch(() => undefined);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${plan.name}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export { EmptyState };
