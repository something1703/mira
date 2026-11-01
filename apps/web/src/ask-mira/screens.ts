import type { Screen } from "@mira/schemas";

/** Which screen the person is on, from the path. The assistant is told only this. */
export function screenOf(pathname: string): Screen {
  if (pathname === "/") return "welcome";
  const first = pathname.split("/")[1];
  switch (first) {
    case "capture":
    case "profile":
    case "shade":
    case "look":
    case "proof":
    case "settings":
      return first;
    default:
      return "other";
  }
}

/** Three suggestions per screen (docs/UX_FLOWS.md §9, Idle). They are plain questions. */
export const SUGGESTIONS: Record<Screen, readonly [string, string, string]> = {
  welcome: ["What can you do?", "What is my skin colour?", "Find my foundation in a range"],
  capture: ["What gets measured?", "What is my skin colour?", "Find my foundation in a range"],
  profile: [
    "What is my skin colour?",
    "What does the pore reading mean?",
    "Find my foundation in a range",
  ],
  shade: ["Find my foundation in a range", "What is my skin colour?", "What does verified mean?"],
  look: ["What makeup looks can you list?", "Build me a sangeet look", "What is my skin colour?"],
  proof: [
    "Check whether my serum works",
    "What is my skin colour?",
    "What does day-to-day variation mean?",
  ],
  settings: ["What does MIRA keep?", "What is my skin colour?", "What can you do?"],
  other: ["What can you do?", "What is my skin colour?", "Find my foundation in a range"],
};

/** Where each next action leads. */
export const ACTION_LINKS = {
  match_shade: { label: "Match my shade", href: "/shade" },
  compose_look: { label: "Build a look", href: "/look" },
  start_proof: { label: "Check my progress", href: "/proof" },
  proof_check_in: { label: "Check in", href: "/proof" },
  build_twin: { label: "Start measuring", href: "/capture" },
} as const;
