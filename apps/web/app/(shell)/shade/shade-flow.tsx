"use client";

import { Banner, Button, ErrorPanel, Field, QuoteSheet, Swatch, SwatchList } from "@mira/ui";
import type { ShadeRange } from "@mira/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Photo } from "../../../src/capture/flow";
import { discardPhoto } from "../../../src/capture/upload";
import {
  ExtractView,
  CONCEALER_KEY,
  PlanView,
  RANGE_KEY,
  RETRY_KEY,
  RangesView,
  ShadeQuoteView,
} from "../../../src/shade/api";
import { RANGE_ERRORS, coverageWhy, finishWhy, readsLike } from "../../../src/shade/copy";
import { useOnline } from "../../../src/shell/online";
import { PhotoStep } from "../capture/photo-step";

type Stage =
  | { s: "choose" }
  | { s: "reading"; url: string }
  | { s: "unreadable"; message: string }
  | { s: "ranking"; range: ShadeRange }
  | { s: "ranked"; range: ShadeRange; plan: PlanView }
  | { s: "photo"; range: ShadeRange; plan: PlanView }
  | { s: "quote"; range: ShadeRange; plan: PlanView; photo: Photo }
  | { s: "error"; message: string };

type Action = { t: "to"; stage: Stage };

const reduce = (_: Stage, a: Action): Stage => a.stage;

const SHOWN_SWATCHES = 12;

/**
 * The first half of Shade (docs/UX_FLOWS.md §5): choose a range, read it, rank every shade for
 * free, take a photo, see the price. Starting the renders hands over to `ShadeRun`.
 */
export function ShadeFlow({ retry }: { retry: boolean }) {
  const [stage, dispatch] = useReducer(reduce, { s: "choose" });
  // Shades to redo ("Retry missing"): the ones that failed last time, kept in this tab.
  const [only, setOnly] = useState<string[] | undefined>();
  const [concealer, setConcealer] = useState(false);
  const go = (next: Stage) => {
    dispatch({ t: "to", stage: next });
  };
  const abort = useRef<AbortController | null>(null);

  const rank = useCallback(async (range: ShadeRange) => {
    go({ s: "ranking", range });
    try {
      const res = await fetch("/api/shade/prerank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ range }),
      });
      const body: unknown = await res.json();
      const plan = PlanView.safeParse(body);
      if (!res.ok || !plan.success) {
        const code = (body as { error?: string }).error;
        go({
          s: "error",
          message:
            code === "no_profile" || code === "no_skin_colour"
              ? "MIRA needs your skin colour reading to rank these shades. Measure again, then come back."
              : "The shades could not be ranked just now. Nothing was used. Try again in a moment.",
        });
        return;
      }
      try {
        sessionStorage.setItem(RANGE_KEY, JSON.stringify(range));
      } catch {
        // Storage is blocked: "Retry missing" will start from the range choice instead.
      }
      go({ s: "ranked", range, plan: plan.data });
    } catch {
      go({
        s: "error",
        message: "The shades could not be ranked. Check your connection. Nothing was used.",
      });
    }
  }, []);

  const read = useCallback(
    async (url: string) => {
      go({ s: "reading", url });
      abort.current = new AbortController();
      try {
        const res = await fetch("/api/shade/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: abort.current.signal,
        });
        const body: unknown = await res.json();
        const parsed = ExtractView.safeParse(body);
        if (!res.ok || !parsed.success) {
          const code = (body as { error?: string }).error ?? "range_not_readable";
          go({
            s: "unreadable",
            message: RANGE_ERRORS[code] ?? RANGE_ERRORS.range_not_readable ?? "",
          });
          return;
        }
        await rank(parsed.data.range);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        go({ s: "unreadable", message: RANGE_ERRORS.agent_unreachable ?? "" });
      }
    },
    [rank],
  );

  useEffect(() => {
    if (!retry) return;
    try {
      const range = JSON.parse(sessionStorage.getItem(RANGE_KEY) ?? "null") as ShadeRange | null;
      const ids = JSON.parse(sessionStorage.getItem(RETRY_KEY) ?? "null") as string[] | null;
      sessionStorage.removeItem(RETRY_KEY);
      const withConcealer = sessionStorage.getItem(CONCEALER_KEY) === "1";
      sessionStorage.removeItem(CONCEALER_KEY);
      if (range && ids && ids.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- continuing a run from the last screen
        setOnly(ids.slice(0, 5));
        setConcealer(withConcealer);
        void rank(range).then(() => undefined);
      }
    } catch {
      // Nothing usable was kept: the person starts from the range choice.
    }
  }, [retry, rank]);

  switch (stage.s) {
    case "choose":
    case "unreadable":
      return (
        <ChooseRange
          notice={stage.s === "unreadable" ? stage.message : undefined}
          onRange={(r) => void rank(r)}
          onLink={(u) => void read(u)}
        />
      );
    case "reading":
      return (
        <div className="shade" aria-busy="true">
          <h1 className="mira-display-l">Reading the shade range</h1>
          <p role="status" className="lead">
            MIRA is looking for shade names and colours on that page. This costs no units.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              abort.current?.abort();
              go({ s: "choose" });
            }}
          >
            Cancel
          </Button>
        </div>
      );
    case "ranking":
      return (
        <div className="shade" aria-busy="true">
          <h1 className="mira-display-l">Checking every shade</h1>
          <p role="status" className="lead">
            Comparing {stage.range.shades.length} shades with your measured skin colour, for free.
          </p>
        </div>
      );
    case "error":
      return (
        <ErrorPanel
          title={stage.message}
          actions={
            <Button
              onClick={() => {
                go({ s: "choose" });
              }}
            >
              Choose a range
            </Button>
          }
        />
      );
    case "ranked":
      return (
        <Ranked
          range={stage.range}
          plan={stage.plan}
          retrying={only !== undefined}
          onNext={() => {
            go({ s: "photo", range: stage.range, plan: stage.plan });
          }}
          onBack={() => {
            go({ s: "choose" });
          }}
        />
      );
    case "photo":
      return (
        <div className="shade capture">
          <h1 className="mira-display-l">A photo to try the shades on</h1>
          <p className="lead">
            Look straight at the camera in even light, with no makeup on if you can. MIRA renders
            each shade on this photo, unretouched, and deletes the photo when the run ends.
          </p>
          <PhotoStep
            label="Face photo for the shade previews"
            engine="camerakit"
            mode="comprehensive"
            kinds={["face"]}
            hd={false}
            onStandardDetail={() => undefined}
            review
            autoStart={false}
            onAccept={(photos) => {
              const [photo] = photos;
              if (photo) go({ s: "quote", range: stage.range, plan: stage.plan, photo });
            }}
          />
          <Button
            variant="quiet"
            onClick={() => {
              go({ s: "ranked", range: stage.range, plan: stage.plan });
            }}
          >
            Back
          </Button>
        </div>
      );
    case "quote":
      return (
        <QuoteStep
          range={stage.range}
          plan={stage.plan}
          photo={stage.photo}
          only={only}
          concealer={concealer}
          onBack={() => {
            void discardPhoto(stage.photo.key);
            go({ s: "photo", range: stage.range, plan: stage.plan });
          }}
        />
      );
  }
}

// ---------------------------------------------------------------------------------------------

function ChooseRange({
  notice,
  onRange,
  onLink,
}: {
  notice: string | undefined;
  onRange: (r: ShadeRange) => void;
  onLink: (url: string) => void;
}) {
  const [ranges, setRanges] = useState<ShadeRange[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [search, setSearch] = useState("");
  const [link, setLink] = useState("");
  const online = useOnline();

  useEffect(() => {
    let alive = true;
    fetch("/api/shade/ranges", { cache: "no-store" })
      .then(async (res) => RangesView.parse(await res.json()))
      .then((v) => {
        if (alive) setRanges(v.ranges);
      })
      .catch(() => {
        if (alive) setProblem(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const shown = (ranges ?? []).filter((r) =>
    `${r.brand} ${r.product}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="shade">
      <header>
        <h1 className="mira-display-l">Match my shade</h1>
        <p className="lead">
          MIRA checks every shade in a range against your measured skin for free, then renders only
          the closest ones.
        </p>
      </header>
      {notice ? (
        <ErrorPanel title={notice} next="Try another link, or pick a range below." />
      ) : null}

      <section aria-labelledby="sh-paste" className="shade__section">
        <h2 id="sh-paste" className="mira-title">
          Paste a product link
        </h2>
        <form
          className="shade__link"
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim() !== "") onLink(link.trim());
          }}
        >
          <Field
            label="Product page link"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
            }}
          />
          <Button type="submit" disabled={link.trim() === "" || !online}>
            Read the range
          </Button>
        </form>
        {online ? null : (
          <p role="status" className="mira-small">
            You are offline. Reconnect to read a page.
          </p>
        )}
      </section>

      <section aria-labelledby="sh-ranges" className="shade__section">
        <h2 id="sh-ranges" className="mira-title">
          Or choose a range
        </h2>
        <Field
          label="Search ranges"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        {problem ? (
          <p role="alert">The ranges could not be loaded. Paste a product link instead.</p>
        ) : ranges === null ? (
          <p role="status">Loading ranges</p>
        ) : shown.length === 0 ? (
          <p className="mira-muted">No range matches that search. Paste a product link instead.</p>
        ) : (
          <ul className="shade__ranges">
            {shown.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="shade__range"
                  onClick={() => {
                    onRange(r);
                  }}
                >
                  <span className="mira-title">{r.product}</span>
                  <span className="mira-small mira-muted">
                    {r.brand} · {r.shades.length} shades{r.sample ? " · sample range" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Ranked({
  range,
  plan,
  retrying,
  onNext,
  onBack,
}: {
  range: ShadeRange;
  plan: PlanView;
  retrying: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  const top = plan.ranked.slice(0, SHOWN_SWATCHES);
  const closest = plan.ranked[0];
  return (
    <div className="shade">
      <header>
        <h1 className="mira-display-l">{range.product}</h1>
        <p className="lead">
          Checked {plan.checkedFree} shades for free. The closest to your skin are below.
        </p>
      </header>
      {range.sample ? (
        <Banner kind="info">
          Sample range. These shade colours are invented to show how matching works, not a
          brand&apos;s products.
        </Banner>
      ) : null}
      <SwatchList label="Shades closest to your skin, nearest first">
        {top.map((s) => (
          // "Best match" is for a shade that was rendered and measured; this is only a ranking.
          <Swatch
            key={s.id}
            colour={s.hex}
            name={s.name}
            de={s.de.toFixed(1)}
            state={s.label === "blends_closely" || s.label === "close" ? "default" : "out_of_range"}
          />
        ))}
      </SwatchList>
      {closest && closest.label !== "blends_closely" && closest.label !== "close" ? (
        <Banner kind="info">
          No shade in this range is close to your skin colour yet. The nearest, {closest.name},{" "}
          {readsLike(closest.label)} your skin.
        </Banner>
      ) : null}
      <p className="mira-small mira-muted">
        {finishWhy(plan.finishReason)} {coverageWhy(plan.coverageReason)}
      </p>
      <div className="mira-row">
        <Button onClick={onNext}>
          {retrying ? "Retry the shades that did not render" : "Preview the closest shades"}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Choose another range
        </Button>
      </div>
    </div>
  );
}

function QuoteStep({
  range,
  plan,
  photo,
  only,
  concealer,
  onBack,
}: {
  range: ShadeRange;
  plan: PlanView;
  photo: Photo;
  only: string[] | undefined;
  concealer: boolean;
  onBack: () => void;
}) {
  const router = useRouter();
  const online = useOnline();
  const [topN, setTopN] = useState(only?.length ?? 3);
  const [removed, setRemoved] = useState<string[]>([]);
  const [load, setLoad] = useState<
    | { s: "quoting" }
    | { s: "ready"; q: ShadeQuoteView }
    | { s: "starting"; q: ShadeQuoteView }
    | { s: "error"; message: string }
  >({ s: "quoting" });
  const [note, setNote] = useState<string | undefined>();
  const [all, setAll] = useState<string[]>([]);

  const ask = useCallback(
    async (n: number, without: string[]) => {
      setLoad({ s: "quoting" });
      try {
        const res = await fetch("/api/shade/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            range,
            photo: photo.key,
            topN: n,
            removedShadeIds: without,
            ...(only ? { shadeIds: only } : {}),
            ...(concealer ? { concealer: true } : {}),
          }),
        });
        const parsed = ShadeQuoteView.safeParse(await res.json());
        if (!res.ok || !parsed.success) {
          setLoad({ s: "error", message: "The price could not be worked out. Nothing was used." });
          return;
        }
        setAll((prev) => (prev.length >= parsed.data.chosen.length ? prev : parsed.data.chosen));
        setLoad({ s: "ready", q: parsed.data });
      } catch {
        setLoad({
          s: "error",
          message: "The price could not be worked out. Check your connection.",
        });
      }
    },
    [range, photo.key, only, concealer],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a price is asked for when this screen opens
    void ask(only?.length ?? 3, []);
  }, [ask, only]);

  const names = new Map(plan.ranked.map((s) => [s.id, s.name]));

  const start = async (q: ShadeQuoteView) => {
    setLoad({ s: "starting", q });
    try {
      const res = await fetch("/api/shade/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          range,
          photo: photo.key,
          topN,
          removedShadeIds: removed,
          ...(only ? { shadeIds: only } : {}),
          ...(concealer ? { concealer: true } : {}),
          confirmedTotal: q.quote.total,
        }),
      });
      const body = (await res.json()) as { runId?: string; error?: string };
      if (res.status === 201 && body.runId) {
        router.push(`/shade?run=${body.runId}`);
        return;
      }
      if (body.error === "quote_changed" || body.error === "over_cap") {
        setNote(
          body.error === "over_cap"
            ? "This would use more units than this session has left."
            : "The price changed while you were looking. Check the new total and confirm again.",
        );
        await ask(topN, removed);
        return;
      }
      setLoad({ s: "error", message: "Rendering could not start. Nothing was used." });
    } catch {
      setLoad({ s: "error", message: "Rendering could not start. Nothing was used." });
    }
  };

  if (load.s === "error") {
    return (
      <ErrorPanel
        title={load.message}
        actions={
          <>
            <Button onClick={() => void ask(topN, removed)}>Try again</Button>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
          </>
        }
      />
    );
  }
  const q = load.s === "ready" || load.s === "starting" ? load.q : undefined;
  // One line per shade: its render and its re-measure are priced together.
  const lines = q
    ? q.chosen
        .map((id, i) => ({ id, i }))
        .filter(({ id, i }) => i === 0 || !removed.includes(id))
        .map(({ id, i }) => ({
          label: `${names.get(id) ?? id}: render and measure`,
          units: q.quote.lines
            .filter((l) => l.nodeId.endsWith(`-${String(i + 1)}`) && !l.nodeId.startsWith("check"))
            .reduce((n, l) => n + l.units, 0),
        }))
    : [];
  return (
    <div className="shade">
      {note ? <Banner kind="info">{note}</Banner> : null}
      {concealer ? (
        <Banner kind="info">
          This run adds a concealer under the eyes to the shade, on a new photo. It costs the same
          as one shade.
        </Banner>
      ) : null}
      <QuoteSheet
        state={
          load.s === "quoting"
            ? "quoting"
            : load.s === "starting"
              ? "confirmed"
              : q?.quote.overCap
                ? "over_cap"
                : "ready"
        }
        title="Rendering the closest shades"
        lines={lines}
        {...(q ? { unitsLeft: q.quote.sessionUnitsLeft } : {})}
        confirmLabel="Start rendering"
        {...(online
          ? {}
          : { confirmBlockedReason: "You are offline. Reconnect to start rendering." })}
        onConfirm={() => {
          if (q) void start(q);
        }}
        onCancel={() => {
          void discardPhoto(photo.key);
          router.push("/");
        }}
      />
      <fieldset
        className="shade__options"
        disabled={load.s !== "ready"}
        hidden={only !== undefined}
      >
        <legend className="mira-title">How many shades</legend>
        <div className="mira-row">
          <Button
            variant="secondary"
            disabled={topN <= 1}
            onClick={() => {
              setTopN(topN - 1);
              setRemoved([]);
              void ask(topN - 1, []);
            }}
          >
            Fewer
          </Button>
          <span role="status" className="mira-figures">
            {topN}
          </span>
          <Button
            variant="secondary"
            disabled={topN >= 5}
            onClick={() => {
              setTopN(topN + 1);
              setRemoved([]);
              void ask(topN + 1, []);
            }}
          >
            More
          </Button>
        </div>
        {all.slice(1, topN).map((id) => (
          <Field
            key={id}
            type="checkbox"
            label={`Include ${names.get(id) ?? id}`}
            checked={!removed.includes(id)}
            onChange={(e) => {
              const next = e.target.checked ? removed.filter((x) => x !== id) : [...removed, id];
              setRemoved(next);
              void ask(topN, next);
            }}
          />
        ))}
      </fieldset>
      <p className="mira-small mira-muted">
        The photo is deleted when the run ends. A failed render is not charged. Previews stay for a
        few minutes so you can save one.
      </p>
    </div>
  );
}
