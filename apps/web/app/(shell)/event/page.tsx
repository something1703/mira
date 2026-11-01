import type { Metadata } from "next";
import { EventBoard } from "./event-board";

export const metadata: Metadata = { title: "Plan an event" };

/** Event Mode (docs/UX_FLOWS.md §7): several looks for one multi-day event. */
export default function EventPage() {
  return <EventBoard />;
}
