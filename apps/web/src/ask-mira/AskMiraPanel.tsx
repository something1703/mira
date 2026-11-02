"use client";

import { type AskResponse, type ChatMessage, type PlanView, type Screen } from "@mira/schemas";
import { Button, CloseIconButton, QuoteSheet, StepRail, buttonClass, type Step } from "@mira/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { stepLabel, toSteps } from "../runs/steps";
import { ask, confirmPlan, fetchRun, narrate } from "./api";
import { ACTION_LINKS, SUGGESTIONS, screenOf } from "./screens";

/**
 * The Ask MIRA panel (docs/UX_FLOWS.md §9): a side panel on desktop, a sheet on mobile, on every
 * screen. The conversation lives here, in the shell, so it survives moving between screens and is
 * gone when the tab closes. Every number in an answer was filled in by the renderer on the server;
 * this component shows text, it never builds a figure.
 */
const UNAVAILABLE =
  "The assistant is unavailable right now. Every tool still works from its own screen.";

const REFUSALS: Record<string, string> = {
  price_changed: "The price changed since this quote. Ask again to get a new quote.",
  expired: "This quote expired. Ask again to get a new one.",
  unknown_plan: "This quote is no longer available. Ask again to get a new one.",
  not_confirmed: "This plan was not confirmed.",
  failed: "The run could not start. No units were used.",
};

type PlanUi =
  | { s: "ready" }
  | { s: "confirming" }
  | { s: "running"; runId: string; steps: Step[] }
  | { s: "done"; runId: string }
  | { s: "cancelled" }
  | { s: "refused"; message: string };

type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "mira"; resp: AskResponse; runId?: string };

const FULL_VIEW: Record<PlanView["workflow"], (runId: string) => string> = {
  build_twin: (r) => `/profile?run=${r}`,
  match_shade: (r) => `/shade?run=${r}`,
  compose_look: () => "/look",
  proof_setup: () => "/proof",
  proof_check_in: () => "/proof",
};

/** Where a plan is adjusted: its own screen, which has every option (fewer shades, a concealer). */
const CHANGE_AT: Record<PlanView["workflow"], string> = {
  build_twin: "/capture",
  match_shade: "/shade",
  compose_look: "/look",
  proof_setup: "/proof",
  proof_check_in: "/proof",
};

const TERMINAL = new Set(["succeeded", "partial", "failed", "cancelled"]);

const unavailableResponse = (): AskResponse => ({
  state: "unavailable",
  segments: [{ text: UNAVAILABLE, readings: [] }],
  nextActions: [],
  plans: [],
  needs: [],
  renders: [],
  toolCalls: [],
});

export function AskMiraPanel() {
  const pathname = usePathname();
  const screen: Screen = screenOf(pathname);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [plans, setPlans] = useState<Record<string, PlanUi>>({});
  const toggle = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);
  const next = useRef(1);
  const narrated = useRef(new Set<string>());
  const inputId = useId();

  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const push = useCallback((entry: Omit<Extract<Entry, { kind: "mira" }>, "id">) => {
    setEntries((all) => [...all, { ...entry, id: next.current++ }]);
  }, []);

  // ---- asking ----
  const send = async (raw: string) => {
    const message = raw.trim();
    if (message === "" || busy) return;
    const history: ChatMessage[] = [
      ...entries.map((e): ChatMessage =>
        e.kind === "user"
          ? { role: "user", text: e.text }
          : { role: "assistant", text: e.resp.segments.map((s) => s.text).join(" ") || "…" },
      ),
      { role: "user", text: message.slice(0, 2_000) },
    ];
    setEntries((all) => [...all, { id: next.current++, kind: "user", text: message }]);
    setText("");
    setBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    const res = await ask(history.slice(-40), { screen }, controller.signal);
    if (abort.current === controller) abort.current = undefined;
    setBusy(false);
    if (!res.ok && res.code === "aborted") return;
    const resp = res.ok ? res.value : unavailableResponse();
    push({ kind: "mira", resp });
    setPlans((p) => ({
      ...p,
      ...Object.fromEntries(resp.plans.map((pl) => [pl.id, { s: "ready" }])),
    }));
  };

  const stop = () => {
    abort.current?.abort();
    abort.current = undefined;
    setBusy(false);
  };

  // ---- plans ----
  const confirm = async (plan: PlanView) => {
    setPlans((p) => ({ ...p, [plan.id]: { s: "confirming" } }));
    const res = await confirmPlan(plan.id);
    const reply = res.ok ? res.value : undefined;
    if (reply?.status === "started") {
      const { runId } = reply;
      setPlans((p) => ({ ...p, [plan.id]: { s: "running", runId, steps: [] } }));
      return;
    }
    const reason = reply?.status === "refused" ? reply.reason : "failed";
    setPlans((p) => ({
      ...p,
      [plan.id]: { s: "refused", message: REFUSALS[reason] ?? REFUSALS.failed ?? "" },
    }));
  };

  // Running plans are polled together; a finished run is described by the assistant.
  const running = Object.entries(plans).flatMap(([id, ui]) =>
    ui.s === "running" ? [{ id, runId: ui.runId }] : [],
  );
  const runKey = running.map((r) => r.runId).join(",");
  useEffect(() => {
    if (runKey === "") return;
    let stopped = false;
    const tick = async () => {
      for (const r of running) {
        const view = await fetchRun(r.runId);
        if (stopped || !view) continue;
        if (TERMINAL.has(view.run.status)) {
          // The plan leaves `running` now, which stops this poll; the description still arrives.
          if (narrated.current.has(r.runId)) continue;
          narrated.current.add(r.runId);
          setPlans((p) => ({ ...p, [r.id]: { s: "done", runId: r.runId } }));
          const told = await narrate(r.runId);
          push({
            kind: "mira",
            resp: told.ok ? told.value : unavailableResponse(),
            runId: r.runId,
          });
        } else {
          setPlans((p) => ({
            ...p,
            [r.id]: { s: "running", runId: r.runId, steps: toSteps(view.nodes) },
          }));
        }
      }
    };
    const timer = setInterval(() => void tick(), 1_500);
    void tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // `running` is derived from `plans`; the run ids are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, push]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <>
      <Button
        ref={toggle}
        variant="secondary"
        aria-expanded={open}
        aria-controls="ask-mira"
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        Ask MIRA
      </Button>
      {open ? (
        <aside id="ask-mira" className="ask" aria-label="Ask MIRA">
          <div className="ask__head">
            <h2 ref={heading} tabIndex={-1} className="mira-title">
              Ask MIRA
            </h2>
            <CloseIconButton label="Close Ask MIRA" onClick={close} />
          </div>
          <div className="ask__body">
            {entries.length === 0 && !busy ? (
              <div className="ask__idle">
                <p>Ask about your measured profile, a shade, a look or your progress.</p>
                <ul className="ask__suggestions" aria-label="Suggestions">
                  {SUGGESTIONS[screen].map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        className="ask__suggestion"
                        onClick={() => void send(s)}
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="ask__log" role="log" aria-live="polite" aria-label="Conversation">
                {entries.map((e) =>
                  e.kind === "user" ? (
                    <p key={e.id} className="ask__msg ask__msg--user">
                      {e.text}
                    </p>
                  ) : (
                    <MiraEntry
                      key={e.id}
                      entry={e}
                      plans={plans}
                      onConfirm={(p) => void confirm(p)}
                      onCancel={(p) => {
                        setPlans((all) => ({ ...all, [p.id]: { s: "cancelled" } }));
                      }}
                    />
                  ),
                )}
                {busy ? (
                  <div className="ask__msg ask__msg--mira" role="status">
                    <p>Working out a plan</p>
                    <Button variant="secondary" onClick={stop}>
                      Stop
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <form
            className="ask__form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <label htmlFor={inputId} className="mira-sr-only">
              Ask MIRA a question
            </label>
            <input
              id={inputId}
              className="ask__input"
              value={text}
              maxLength={500}
              autoComplete="off"
              placeholder="Ask a question"
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
            <Button type="submit" disabled={busy || text.trim() === ""}>
              Send
            </Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}

function MiraEntry({
  entry,
  plans,
  onConfirm,
  onCancel,
}: {
  entry: Extract<Entry, { kind: "mira" }>;
  plans: Record<string, PlanUi>;
  onConfirm: (plan: PlanView) => void;
  onCancel: (plan: PlanView) => void;
}) {
  const { resp, runId } = entry;
  return (
    <div className={`ask__msg ask__msg--mira ask__msg--${resp.state}`} data-state={resp.state}>
      {resp.segments.map((s, i) => (
        <p key={i}>{s.text}</p>
      ))}
      {resp.state === "fallback" ? (
        <p className="mira-small">
          This is a standard reply. The answer the assistant wrote did not pass the checks MIRA
          runs.
        </p>
      ) : null}
      {resp.state === "unavailable" ? (
        <p className="ask__links">
          <Link href="/shade" className={buttonClass("secondary")}>
            Match my shade
          </Link>
          <Link href="/capture" className={buttonClass("secondary")}>
            Start measuring
          </Link>
        </p>
      ) : null}
      {resp.needs.map((n) => (
        <p key={`${n.need}:${n.screen}`} className="ask__links">
          <Link href={n.screen as never} className={buttonClass("secondary")}>
            {n.need === "photo" ? "Add a photo on that screen" : "Open it"}
          </Link>
        </p>
      ))}
      {resp.plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          ui={plans[plan.id] ?? { s: "ready" }}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ))}
      {runId !== undefined && resp.renders.length > 0 ? (
        <p className="ask__links">
          <Link href={`/shade?run=${runId}` as never} className={buttonClass("secondary")}>
            Open the previews
          </Link>
        </p>
      ) : null}
      {resp.nextActions.length > 0 ? (
        <p className="ask__links">
          {resp.nextActions.map((a) => (
            <Link key={a} href={ACTION_LINKS[a].href as never} className={buttonClass("secondary")}>
              {ACTION_LINKS[a].label}
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  ui,
  onConfirm,
  onCancel,
}: {
  plan: PlanView;
  ui: PlanUi;
  onConfirm: (plan: PlanView) => void;
  onCancel: (plan: PlanView) => void;
}) {
  if (ui.s === "cancelled") return <p className="mira-small">Plan cancelled. Nothing was used.</p>;
  if (ui.s === "refused") return <p role="alert">{ui.message}</p>;
  if (ui.s === "running" || ui.s === "done") {
    return (
      <div className="ask__run">
        {ui.s === "running" && ui.steps.length > 0 ? (
          <StepRail steps={ui.steps} label={plan.summary} />
        ) : (
          <p className="mira-small" role="status">
            {ui.s === "done" ? "The run has finished." : "Starting"}
          </p>
        )}
        <Link href={FULL_VIEW[plan.workflow](ui.runId)} className={buttonClass("secondary")}>
          Open full view
        </Link>
      </div>
    );
  }
  // Lines with the same name are one line here; the full screen lists each shade.
  const grouped = new Map<string, number>();
  for (const l of plan.quote.lines) {
    const label = stepLabel(l.label);
    grouped.set(label, (grouped.get(label) ?? 0) + l.units);
  }
  return (
    <QuoteSheet
      state={ui.s === "confirming" ? "confirmed" : plan.quote.overCap ? "over_cap" : "ready"}
      title={plan.summary}
      lines={[...grouped].map(([label, units]) => ({ label, units }))}
      unitsLeft={plan.quote.sessionUnitsLeft}
      onConfirm={() => {
        onConfirm(plan);
      }}
      onCancel={() => {
        onCancel(plan);
      }}
      extraActions={
        <Link href={CHANGE_AT[plan.workflow]} className={buttonClass("secondary")}>
          Change
        </Link>
      }
    />
  );
}
