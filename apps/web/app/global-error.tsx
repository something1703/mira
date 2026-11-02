"use client";

import "./globals.css";

/**
 * Errors in the root layout replace the whole document, so this page brings its own html, body
 * and styles. It follows the system theme (the saved choice is in the layout that failed).
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something failed · MIRA</title>
        <main className="shell" style={{ paddingBlock: "var(--mira-space-8)" }}>
          <div className="shell__inner mira-error" role="alert">
            <div className="mira-error__body">
              <p className="mira-title">Something failed on our side.</p>
              <p className="mira-error__text">
                The run was stopped and no units were charged for unfinished steps.
              </p>
              <div className="mira-row">
                <button type="button" className="mira-btn mira-btn--primary" onClick={retry}>
                  Try again
                </button>
              </div>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
