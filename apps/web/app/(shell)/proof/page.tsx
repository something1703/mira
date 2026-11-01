import type { Metadata } from "next";
import { ProofHome } from "./proof-home";
import { ProofView } from "./proof-view";

export const metadata: Metadata = { title: "Check my progress" };
export const dynamic = "force-dynamic";

/** Proof (docs/UX_FLOWS.md §8): is a product visibly working, above your own day-to-day variation? */
export default async function ProofPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const id = typeof q.p === "string" && /^prf_[a-z0-9]{6,64}$/.test(q.p) ? q.p : undefined;
  return id ? <ProofView proofId={id} /> : <ProofHome adding={q.add === "1"} />;
}
