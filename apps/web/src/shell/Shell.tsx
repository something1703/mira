import { Lockup } from "@mira/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { AskMiraPanel } from "./AskMiraPanel";
import { BudgetBanner } from "./BudgetBanner";
import { FlashToast } from "./FlashToast";
import { SessionBanners } from "./SessionBanners";
import { ThemeSwitch } from "./ThemeSwitch";

/** App shell: header with the lockup, theme switch, banner slot and the Ask MIRA panel. */
export function Shell({ children }: { children: ReactNode }) {
  const mock = process.env.MIRA_MODE !== "live";
  // "Recorded run" is only true once real YouCam responses have been captured (Phase 3 fixtures).
  const recorded = process.env.MIRA_FIXTURES === "recorded";
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="shell__inner">
        <header className="shell__header">
          <Link href="/" className="shell__home" aria-label="MIRA home">
            <Lockup className="shell__lockup" />
          </Link>
          <nav className="shell__nav" aria-label="Main">
            <Link href="/profile">Profile</Link>
            <Link href="/settings/privacy">Privacy</Link>
          </nav>
          <div className="shell__tools">
            <ThemeSwitch />
            <AskMiraPanel />
          </div>
        </header>
        <div className="shell__banners">
          <SessionBanners mock={mock} recorded={recorded} />
          <BudgetBanner />
        </div>
        <main id="main" tabIndex={-1} className="shell__main">
          {children}
        </main>
      </div>
      <FlashToast />
    </div>
  );
}
