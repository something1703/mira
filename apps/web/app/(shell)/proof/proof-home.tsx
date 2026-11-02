"use client";

import { Claim, PROOF_CONCERNS, type ProofConcern } from "@mira/schemas";
import { Banner, Button, EmptyState, ErrorPanel, Field, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClaimReply, ProofList, type ProofView } from "../../../src/proof/api";
import { PROOF_REASONS, claimSentence, concernNoun } from "../../../src/proof/copy";

const WINDOWS = [
  { days: 14, label: "2 weeks" },
  { days: 28, label: "4 weeks" },
  { days: 42, label: "6 weeks" },
  { days: 56, label: "8 weeks" },
  { days: 84, label: "12 weeks" },
] as const;

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
    ? (PROOF_REASONS[code] ?? "That did not work. Nothing was charged.")
    : "That did not work. Nothing was charged.";
};

type Draft = {
  name: string;
  url?: string;
  concern?: ProofConcern | undefined;
  windowDays?: number | undefined;
  text?: string | undefined;
  source: "page" | "typed" | "chosen";
};

export function ProofHome({ adding }: { adding: boolean }) {
  const [proofs, setProofs] = useState<ProofView[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [adder, setAdder] = useState(adding);

  useEffect(() => {
    let alive = true;
    void fetch("/api/proof", { cache: "no-store" })
      .then(async (r) => (r.ok ? ProofList.safeParse(await r.json()) : undefined))
      .then((p) => {
        if (!alive) return;
        if (p?.success) setProofs(p.data.proofs);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (adder) {
    return (
      <AddProduct
        onCancel={() => {
          setAdder(false);
        }}
      />
    );
  }
  if (failed) {
    return (
      <ErrorPanel
        title="Your products could not be read."
        next="Nothing is lost. Try again in a moment."
        actions={
          <Button
            onClick={() => {
              location.reload();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  if (!proofs) return <p role="status">Opening your progress checks</p>;
  if (proofs.length === 0) {
    return (
      <EmptyState
        title="You have not started a progress check."
        description="Add a product you are using. MIRA learns your day-to-day variation first, then tells you whether anything changed by more than it."
        action={
          <Button
            onClick={() => {
              setAdder(true);
            }}
          >
            Add a product
          </Button>
        }
      />
    );
  }
  return (
    <div className="proof">
      <header>
        <h1 className="mira-display-l">Check my progress</h1>
        <p className="lead">
          Each product is judged against your own day-to-day variation, not against its promises.
        </p>
      </header>
      <ul className="proof__list" aria-label="Your products">
        {proofs.map(({ proof }) => (
          <li key={proof.id} className="proof__card">
            <h2 className="mira-title">{proof.product.name}</h2>
            <p>{claimSentence(proof.claim)}</p>
            <Link href={`/proof?p=${proof.id}`} className={buttonClass("secondary")}>
              Open {proof.product.name}
            </Link>
          </li>
        ))}
      </ul>
      <Button
        onClick={() => {
          setAdder(true);
        }}
      >
        Add a product
      </Button>
    </div>
  );
}

function AddProduct({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [stage, setStage] = useState<
    | { s: "start" }
    | { s: "reading" }
    | { s: "claim"; draft: Draft; editing: boolean; found: boolean }
    | { s: "saving" }
    | { s: "failed"; message: string }
  >({ s: "start" });

  const read = async () => {
    setStage({ s: "reading" });
    const res = await post("/api/proof/claim", { url: url.trim() });
    const parsed = ClaimReply.safeParse(res.json);
    if (res.status !== 200 || !parsed.success) {
      setStage({ s: "failed", message: reasonOf(res.json) });
      return;
    }
    const product = parsed.data.product ?? name.trim();
    const base: Draft = {
      name: product === "" ? "My product" : product,
      url: url.trim(),
      source: "page",
    };
    if (parsed.data.status === "found") {
      setStage({
        s: "claim",
        found: true,
        editing: false,
        draft: { ...base, ...parsed.data.claim },
      });
    } else if (parsed.data.status === "partial") {
      setStage({
        s: "claim",
        found: false,
        editing: true,
        draft: { ...base, ...parsed.data.claim },
      });
    } else {
      setStage({ s: "claim", found: false, editing: true, draft: { ...base, source: "chosen" } });
    }
  };

  const typed = () => {
    setStage({
      s: "claim",
      found: false,
      editing: true,
      draft: { name: name.trim(), source: "typed" },
    });
  };

  const save = async (d: Draft) => {
    const claim = Claim.safeParse({
      concern: d.concern,
      windowDays: d.windowDays,
      source: d.source,
      ...(d.text ? { text: d.text } : {}),
    });
    if (!claim.success) return;
    setStage({ s: "saving" });
    const res = await post("/api/proof", {
      product: { name: d.name, ...(d.url ? { url: d.url } : {}) },
      claim: claim.data,
    });
    const id = (res.json as { proof?: { id?: string } } | undefined)?.proof?.id;
    if (res.status === 201 && id) {
      router.push(`/proof?p=${id}`);
      return;
    }
    setStage({ s: "failed", message: reasonOf(res.json) });
  };

  if (stage.s === "reading" || stage.s === "saving") {
    return <p role="status">{stage.s === "reading" ? "Reading the page" : "Saving"}</p>;
  }
  if (stage.s === "failed") {
    return (
      <ErrorPanel
        title="That product could not be added."
        why={stage.message}
        actions={
          <Button
            onClick={() => {
              setStage({ s: "start" });
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  if (stage.s === "claim") {
    return (
      <ClaimStep
        stage={stage}
        onChange={(draft) => {
          setStage({ ...stage, draft });
        }}
        onEdit={() => {
          setStage({ ...stage, editing: true });
        }}
        onConfirm={() => void save(stage.draft)}
        onCancel={onCancel}
      />
    );
  }
  return (
    <div className="proof">
      <h1 className="mira-display-l">Add a product</h1>
      <p className="lead">
        Paste its page and MIRA reads the claim it makes, or type its name and choose what to track.
      </p>
      <form
        className="proof__form"
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
      >
        <Field
          label="Product page address"
          inputMode="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
        <Button type="submit" disabled={url.trim() === ""}>
          Read this page
        </Button>
      </form>
      <div className="proof__form">
        <Field
          label="Or type the product's name"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Button variant="secondary" disabled={name.trim() === ""} onClick={typed}>
          Continue
        </Button>
      </div>
      <Button variant="quiet" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function ClaimStep({
  stage,
  onChange,
  onEdit,
  onConfirm,
  onCancel,
}: {
  stage: { draft: Draft; editing: boolean; found: boolean };
  onChange: (d: Draft) => void;
  onEdit: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { draft } = stage;
  const complete = draft.concern !== undefined && draft.windowDays !== undefined;
  return (
    <div className="proof">
      <h1 className="mira-display-l">{draft.name}</h1>
      {stage.found && !stage.editing && complete ? (
        <>
          <p className="lead">
            {claimSentence({
              concern: draft.concern ?? "pore",
              windowDays: draft.windowDays ?? 28,
              source: "page",
            })}
          </p>
          {draft.text ? <blockquote className="proof__quote">{draft.text}</blockquote> : null}
          <div className="mira-row">
            <Button onClick={onConfirm}>Confirm claim</Button>
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {draft.source !== "typed" && draft.concern === undefined ? (
            <Banner kind="info">
              No measurable claim found on this page. Choose what you want to track.
            </Banner>
          ) : null}
          <label className="look__select">
            <span>What do you want to track?</span>
            <select
              value={draft.concern ?? ""}
              onChange={(e) => {
                const c = PROOF_CONCERNS.find((x) => x === e.target.value);
                onChange({ ...draft, ...(c ? { concern: c } : {}) });
              }}
            >
              <option value="" disabled>
                Choose one
              </option>
              {PROOF_CONCERNS.map((c) => (
                <option key={c} value={c}>
                  {concernNoun(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="look__select">
            <span>Over how long?</span>
            <select
              value={draft.windowDays === undefined ? "" : String(draft.windowDays)}
              onChange={(e) => {
                const days = Number(e.target.value);
                onChange({ ...draft, windowDays: days });
              }}
            >
              <option value="" disabled>
                Choose a timeframe
              </option>
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>
                  {w.label}
                </option>
              ))}
              {draft.windowDays !== undefined &&
              !WINDOWS.some((w) => w.days === draft.windowDays) ? (
                <option value={draft.windowDays}>{String(draft.windowDays)} days</option>
              ) : null}
            </select>
          </label>
          <div className="mira-row">
            <Button disabled={!complete} onClick={onConfirm}>
              Continue
            </Button>
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
