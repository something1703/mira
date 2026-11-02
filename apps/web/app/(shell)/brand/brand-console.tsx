"use client";

import type { ShadeRange } from "@mira/schemas";
import { Banner, Button, EmptyState, ErrorPanel, Field, StepRail, Tabs, type Step } from "@mira/ui";
import { useCallback, useEffect, useState } from "react";
import { ExtractReply, Summary, toCsv } from "../../../src/brand/api";
import { CLOSED, CSV_PROBLEMS, NO_CATALOGUE, RECORDED, hiddenCell } from "../../../src/brand/copy";
import { GapMap } from "../../../src/brand/GapMap";
import { RangesView } from "../../../src/shade/api";
import { flash } from "../../../src/shell/flash";

type Load = { s: "loading" } | { s: "closed" } | { s: "failed" } | { s: "ready"; summary: Summary };

const send = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(path, init);
  return { status: res.status, json: (await res.json().catch(() => undefined)) as unknown };
};

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * The brand console (docs/UX_FLOWS.md §10). Every cell it shows has already passed the cohort rule
 * on the server; nothing here decides what is small enough to hide.
 */
export function BrandConsole() {
  const [load, setLoad] = useState<Load>({ s: "loading" });
  const [steps, setSteps] = useState<Step[] | undefined>();
  const [problems, setProblems] = useState<string[]>([]);
  const [links, setLinks] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/brand/summary", { cache: "no-store" });
      if (res.status === 403) {
        setLoad({ s: "closed" });
        return;
      }
      const parsed = res.ok ? Summary.safeParse(await res.json()) : undefined;
      setLoad(parsed?.success ? { s: "ready", summary: parsed.data } : { s: "failed" });
    } catch {
      setLoad({ s: "failed" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the console is loaded when it opens
    void refresh();
  }, [refresh]);

  const upload = async (file: File) => {
    setProblems([]);
    const csv = await file.text();
    const res = await send("/api/brand/catalogue/csv", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    if (res.status === 201) {
      flash("Range added");
      await refresh();
      return;
    }
    const list = (res.json as { problems?: { line: number; reason: string }[] } | undefined)
      ?.problems;
    setProblems(
      list?.map((p) =>
        p.line === 0
          ? `The file ${CSV_PROBLEMS[p.reason] ?? "could not be read."}`
          : `Line ${String(p.line)} ${CSV_PROBLEMS[p.reason] ?? "could not be read."}`,
      ) ?? ["That file could not be read."],
    );
  };

  const fromLinks = async () => {
    setProblems([]);
    const urls = links
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 10);
    const state: Step[] = urls.map((u, i) => ({ id: `p${String(i)}`, label: u, state: "queued" }));
    setSteps(state);
    const ranges: ShadeRange[] = [];
    for (const [i, url] of urls.entries()) {
      state[i] = { ...(state[i] as Step), state: "running" };
      setSteps([...state]);
      const res = await send("/api/shade/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const parsed = ExtractReply.safeParse(res.json);
      if (res.status === 200 && parsed.success) {
        ranges.push(parsed.data.range);
        state[i] = { ...state[i], state: "done" };
      } else {
        state[i] = {
          ...state[i],
          state: "failed",
          detail: "No shade colours could be read from this page.",
        };
      }
      setSteps([...state]);
    }
    if (ranges.length === 0) return;
    await send("/api/brand/catalogue/ranges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ranges, source: "links" }),
    });
    setSteps(undefined);
    await refresh();
  };

  const adoptSample = async () => {
    const res = await fetch("/api/shade/ranges", { cache: "no-store" });
    const parsed = res.ok ? RangesView.safeParse(await res.json()) : undefined;
    if (!parsed?.success) return;
    await send("/api/brand/catalogue/ranges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ranges: parsed.data.ranges, source: "sample" }),
    });
    await refresh();
  };

  const replace = async () => {
    await fetch("/api/brand/catalogue/ranges", { method: "DELETE" });
    await refresh();
  };

  if (load.s === "loading") return <p role="status">Opening the console</p>;
  if (load.s === "closed") {
    return (
      <EmptyState
        title={CLOSED}
        description="Brand sign-in has not been built yet, so the console is not open to anyone."
        action={<span />}
      />
    );
  }
  if (load.s === "failed") {
    return (
      <ErrorPanel
        title="The console could not be read."
        next="Nothing was changed. Try again in a moment."
        actions={<Button onClick={() => void refresh()}>Try again</Button>}
      />
    );
  }

  const { summary } = load;
  if (steps) {
    return (
      <div className="brand">
        <h1 className="mira-display-l">Reading your range</h1>
        <StepRail steps={steps} label="Reading each product page" />
        {steps.every((s) => s.state === "failed" || s.state === "done") &&
        steps.every((s) => s.state === "failed") ? (
          <>
            <p role="alert">No range could be read from these pages. Try a spreadsheet instead.</p>
            <Button
              onClick={() => {
                setSteps(undefined);
              }}
            >
              Back
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  if (summary.catalogue === null) {
    return (
      <div className="brand">
        {summary.recorded ? <Banner kind="recorded">{RECORDED}</Banner> : null}
        <EmptyState
          title={NO_CATALOGUE}
          description="Upload a spreadsheet with the columns product, shade and hex, or paste links to your product pages."
          action={<span />}
        />
        <section className="brand__ingest" aria-label="Add your range">
          <Field
            label="Spreadsheet (CSV)"
            hint="Columns: product, shade, hex. Up to 50 products of 200 shades."
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          {problems.length > 0 ? (
            <ul role="alert" className="brand__problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <label className="look__select">
            <span>Product page links, one a line (up to 10)</span>
            <textarea
              rows={4}
              value={links}
              onChange={(e) => {
                setLinks(e.target.value);
              }}
            />
          </label>
          <div className="mira-row">
            <Button disabled={links.trim() === ""} onClick={() => void fromLinks()}>
              Read these pages
            </Button>
            <Button variant="secondary" onClick={() => void adoptSample()}>
              Use the sample range
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const { catalogue, gap, efficacy, attach, k } = summary;
  return (
    <div className="brand">
      <header>
        <h1 className="mira-display-l">{catalogue.name}</h1>
        <p className="lead">
          {String(catalogue.products.length)} product{catalogue.products.length === 1 ? "" : "s"},{" "}
          {String(catalogue.products.reduce((n, p) => n + p.shades.length, 0))} shades
          {catalogue.sample ? " (a sample range)" : ""}.
        </p>
      </header>
      {summary.recorded ? <Banner kind="recorded">{RECORDED}</Banner> : null}
      <Tabs
        label="Brand views"
        items={[
          {
            value: "gap",
            label: "Shade Gap Map",
            content:
              gap.state === "hidden" ? (
                <p role="status">{hiddenCell(k)}</p>
              ) : (
                <div className="brand__view">
                  <p className="lead">
                    {Math.round(gap.unservedShare * 100)}% of shoppers have no shade in your range
                    within ΔE {gap.nearDe} of their skin colour.
                  </p>
                  {!gap.calibrated ? (
                    <p className="mira-small">
                      That distance is a starting value, not a measured cut-off.
                    </p>
                  ) : null}
                  <GapMap view={gap} />
                  {gap.hiddenCells > 0 ? (
                    <p className="mira-small">
                      {String(gap.hiddenCells)} cell{gap.hiddenCells === 1 ? "" : "s"} not shown:{" "}
                      {hiddenCell(k)}
                    </p>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      download(
                        "shade-gap-map.csv",
                        toCsv([
                          [
                            "hue_from",
                            "hue_to",
                            "lightness_from",
                            "lightness_to",
                            "share_of_shoppers",
                            "share_unserved",
                          ],
                          ...gap.cells.map((c) => [
                            c.hueLo,
                            c.hueHi,
                            c.lLo,
                            c.lHi,
                            c.share.toFixed(3),
                            c.unservedShare.toFixed(3),
                          ]),
                        ]),
                      );
                    }}
                  >
                    Export
                  </Button>
                </div>
              ),
          },
          {
            value: "efficacy",
            label: "Efficacy",
            content: (
              <div className="brand__view">
                <table className="brand__table">
                  <caption>Completed progress checks, by measured skin-tone band</caption>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Concern</th>
                      <th scope="col">Group</th>
                      <th scope="col">Completed</th>
                      <th scope="col">Changed more than their own variation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {efficacy.map((c, i) => (
                      <tr key={i} data-hidden={c.hidden}>
                        <th scope="row">{c.product}</th>
                        <td>{c.concern}</td>
                        <td>{c.group}</td>
                        {c.hidden ? (
                          <td colSpan={2}>{hiddenCell(k)}</td>
                        ) : (
                          <>
                            <td>{c.completed}</td>
                            <td>{Math.round((c.detectedShare ?? 0) * 100)}%</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button
                  variant="secondary"
                  onClick={() => {
                    download(
                      "efficacy.csv",
                      toCsv([
                        [
                          "product",
                          "concern",
                          "group",
                          "completed",
                          "share_changed_more_than_variation",
                        ],
                        ...efficacy
                          .filter((c) => !c.hidden)
                          .map((c) => [
                            c.product,
                            c.concern,
                            c.group,
                            c.completed ?? 0,
                            (c.detectedShare ?? 0).toFixed(3),
                          ]),
                      ]),
                    );
                  }}
                >
                  Export
                </Button>
              </div>
            ),
          },
          {
            value: "attach",
            label: "Attach",
            content: (
              <div className="brand__view">
                <table className="brand__table">
                  <caption>Looks that combine apparel and beauty</caption>
                  <thead>
                    <tr>
                      <th scope="col">What the look had</th>
                      <th scope="col">Looks</th>
                      <th scope="col">Saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attach.map((c) => (
                      <tr key={c.pairing} data-hidden={c.hidden}>
                        <th scope="row">{c.pairing}</th>
                        {c.hidden ? (
                          <td colSpan={2}>{hiddenCell(k)}</td>
                        ) : (
                          <>
                            <td>{c.looks}</td>
                            <td>{Math.round((c.savedShare ?? 0) * 100)}%</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button
                  variant="secondary"
                  onClick={() => {
                    download(
                      "attach.csv",
                      toCsv([
                        ["pairing", "looks", "share_saved"],
                        ...attach
                          .filter((c) => !c.hidden)
                          .map((c) => [c.pairing, c.looks ?? 0, (c.savedShare ?? 0).toFixed(3)]),
                      ]),
                    );
                  }}
                >
                  Export
                </Button>
              </div>
            ),
          },
        ]}
      />
      <Button variant="quiet" onClick={() => void replace()}>
        Replace this range
      </Button>
    </div>
  );
}
