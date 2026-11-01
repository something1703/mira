import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunViewer } from "./run-viewer";

export const metadata: Metadata = { title: "Run viewer" };

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ dev?: string }>;
}) {
  if (process.env.MIRA_MODE === "live" && (await searchParams).dev !== "1") notFound();
  const { runId } = await params;
  return <RunViewer runId={runId} />;
}
