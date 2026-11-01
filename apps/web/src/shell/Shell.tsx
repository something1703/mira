import { Lockup } from "@mira/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { AskMiraPanel } from "./AskMiraPanel";
import { SessionBanners } from "./SessionBanners";
import { ThemeSwitch } from "./ThemeSwitch";

/** App shell: header with the lockup, theme switch, banner slot and the Ask MIRA panel. */
export function Shell({ children }: { children: ReactNode }) {
  const mock = process.env.MIRA_MODE !== "live";
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
          <div className="shell__tools">
            <ThemeSwitch />
            <AskMiraPanel />
          </div>
        </header>
        <div className="shell__banners">
          <SessionBanners mock={mock} />
        </div>
        <main id="main" tabIndex={-1} className="shell__main">
          {children}
        </main>
      </div>
    </div>
  );
}
