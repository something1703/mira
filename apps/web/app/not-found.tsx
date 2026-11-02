import { EmptyState, buttonClass } from "@mira/ui";
import Link from "next/link";
import { Shell } from "../src/shell/Shell";

/** Unmatched URLs, including links to screens that later phases build. */
export default function NotFound() {
  return (
    <Shell>
      <EmptyState
        title="This screen is not available yet."
        description="MIRA is being built one part at a time. The link you followed leads to a part that has not arrived."
        action={
          <Link href="/" className={buttonClass("primary")}>
            Go home
          </Link>
        }
      />
    </Shell>
  );
}
