"use client";

import { Button, ErrorPanel, buttonClass } from "@mira/ui";
import Link from "next/link";
import { useEffect } from "react";

/**
 * "Unexpected error" (docs/UX_FLOWS.md §0). Server errors arrive with a `digest` that matches the
 * server log line, so it is shown as the reference; the message itself never is.
 */
export default function ShellError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorPanel
      title="Something failed on our side."
      why="The run was stopped and no units were charged for unfinished steps."
      next="Try again, or go back to the start."
      {...(digest ? { traceId: digest, referenceLabel: "Reference" } : {})}
      actions={
        <>
          <Button onClick={retry}>Try again</Button>
          <Link href="/" className={buttonClass("secondary")}>
            Go home
          </Link>
        </>
      }
    />
  );
}
