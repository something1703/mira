import { SDK_URL, type YmkApi } from "./types";

/**
 * Loads the Camera Kit script (docs/YOUCAM_API.md §5): `YMKAsyncInit` is defined first, then the
 * script is added, and the promise settles when the SDK calls back. It never rejects: a blocked
 * script, an offline browser or a missing SDK is a value, because each one sends the person to the
 * upload path rather than to an error page.
 */
export type SdkResult =
  { ok: true; ymk: YmkApi } | { ok: false; reason: "unsupported" | "blocked" | "timeout" };

export interface LoaderOptions {
  url?: string;
  timeoutMs?: number;
}

let pending: Promise<SdkResult> | undefined;

/** True where `getUserMedia` can work at all: a secure context (HTTPS or localhost) with the API. */
export function cameraSupported(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  // Outside a secure context the property exists but is undefined, so `in` is not enough.
  const devices = (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
  return typeof devices?.getUserMedia === "function";
}

export function loadCameraKit(options: LoaderOptions = {}): Promise<SdkResult> {
  if (!cameraSupported()) return Promise.resolve({ ok: false, reason: "unsupported" });
  if (window.YMK) return Promise.resolve({ ok: true, ymk: window.YMK });
  if (pending) return pending;
  const attempt = new Promise<SdkResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, reason: "timeout" });
    }, options.timeoutMs ?? 15_000);
    // Defined before the script loads, as the SDK requires.
    window.YMKAsyncInit = () => {
      clearTimeout(timer);
      resolve(window.YMK ? { ok: true, ymk: window.YMK } : { ok: false, reason: "unsupported" });
    };
    const script = document.createElement("script");
    script.src = options.url ?? SDK_URL;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      resolve({ ok: false, reason: "blocked" });
    };
    document.head.append(script);
  });
  pending = attempt;
  // A failure must not be remembered: the next attempt (a retry, or back online) loads again.
  void attempt.then((r) => {
    if (!r.ok) pending = undefined;
  });
  return attempt;
}

/** For tests: forget a finished load. */
export function resetLoader(): void {
  pending = undefined;
}
