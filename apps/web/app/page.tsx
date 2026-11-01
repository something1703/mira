import { Lockup } from "./lockup";

/** Phase 1 placeholder. Phase 2 replaces it with the Welcome screen (docs/UX_FLOWS.md §1). */
export default function Home() {
  return (
    <main className="placeholder">
      <Lockup />
      <h1>Look, measured.</h1>
      <p>
        MIRA measures you once, then shows makeup and clothes on you without smoothing your skin,
        and checks every preview before you see it.
      </p>
    </main>
  );
}
