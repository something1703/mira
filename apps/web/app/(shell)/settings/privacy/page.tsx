import { ErrorPanel, buttonClass } from "@mira/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { loadInventory } from "../../../../src/profile/inventory";
import { PrivacyPanel } from "./privacy-panel";

export const metadata: Metadata = { title: "Privacy and my data" };
export const dynamic = "force-dynamic";

/** Settings → Privacy (docs/UX_FLOWS.md §11): every stored number, what was deleted, download, delete. */
export default async function PrivacyPage() {
  const inventory = await loadInventory();
  if (!inventory) {
    return (
      <ErrorPanel
        title="Your stored data could not be read."
        why="MIRA could not reach the service that holds it."
        next="Try again in a moment. Nothing was changed."
        actions={
          <Link href="/settings/privacy" className={buttonClass("secondary")}>
            Try again
          </Link>
        }
      />
    );
  }
  return <PrivacyPanel inventory={inventory} />;
}
