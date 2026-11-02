import { notFound } from "next/navigation";

/** Throws on purpose so the "Unexpected error" state can be seen and tested. Never in live mode. */
export default function DevError() {
  if (process.env.MIRA_MODE === "live") notFound();
  throw new Error("Deliberate test error from /dev/error");
}
