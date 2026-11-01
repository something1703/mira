import { Button, EmptyState } from "@mira/ui";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { workflowsUrl } from "../../../../src/runs/api";

export const metadata: Metadata = { title: "Run viewer" };

async function startDemo() {
  "use server";
  const res = await fetch(`${workflowsUrl()}/internal/runs/demo`, {
    method: "POST",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`The demo run could not start (${String(res.status)}).`);
  const { runId } = (await res.json()) as { runId: string };
  redirect(`/dev/runs/${runId}`);
}

/** Developer and demo view (docs/UX_FLOWS.md §12). Hidden in live mode unless `?dev=1`. */
export default async function Runs({ searchParams }: { searchParams: Promise<{ dev?: string }> }) {
  if (process.env.MIRA_MODE === "live" && (await searchParams).dev !== "1") notFound();
  return (
    <EmptyState
      title="Start a demo run to watch the graph."
      description="Three analysers read one placeholder photo in parallel, then a local step summarises them. Run it twice to see the second run finish from saved results at zero units."
      action={
        <form action={startDemo}>
          <Button type="submit">Start a demo run</Button>
        </form>
      }
    />
  );
}
