import type { Metadata } from "next";
import { planFrom } from "../../../src/capture/flow";
import { CaptureFlow } from "./capture-flow";

export const metadata: Metadata = { title: "Measure" };

/** Capture (docs/UX_FLOWS.md §3). `?only=face,hair` retries those groups; `?step=repeats` adds the repeat photos. */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  return <CaptureFlow plan={planFrom({ only: one(q.only), step: one(q.step) })} />;
}
