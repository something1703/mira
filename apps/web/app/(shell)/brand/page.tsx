import type { Metadata } from "next";
import { BrandConsole } from "./brand-console";

export const metadata: Metadata = { title: "Brand console" };

/** The brand console (docs/UX_FLOWS.md §10): what anonymised measurements say about a range. */
export default function BrandPage() {
  return <BrandConsole />;
}
