import type { Route } from "next";

/**
 * Routes that later phases build (look: Phase 8, proof: 9; capture, shade and the profile are built and still use this cast).
 * Typed routes reject links to pages that do not exist yet, so these are cast on purpose. Until a
 * phase lands its page, the shell's not-found screen explains it.
 */
// ESLint sees `Route` as `string` (typed routes are generated only for `tsc`), so the cast looks
// unnecessary there while `tsc` needs it.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
export const later = (path: string): Route => path as Route;
