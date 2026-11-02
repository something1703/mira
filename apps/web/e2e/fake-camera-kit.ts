import { CAMERA_KIT_SDK_URL } from "@mira/youcam-client/camera-kit";
import type { Page } from "@playwright/test";

const isSdk = (url: URL) => url.href === CAMERA_KIT_SDK_URL;

/**
 * A stand-in for YouCam's Camera Kit, served in place of the real script (docs/TESTING.md: the
 * camera is mocked in mock mode). It follows the documented contract: `YMKAsyncInit` is called when
 * ready, `init` needs `#YMK-module` to exist, events go to listeners. Tests drive it through
 * `window.__ymk`: `emit` sends any event, `capture` takes a real, decodable JPEG of a given size.
 */
const SCRIPT = String.raw`
(() => {
  const listeners = {};
  const calls = [];
  const api = {
    init(args) {
      if (!document.getElementById("YMK-module")) throw new Error("#YMK-module is missing at init");
      calls.push({ op: "init", args });
    },
    openCameraKit() { calls.push({ op: "open" }); setTimeout(() => emit("opened"), 0); },
    close() { calls.push({ op: "close" }); },
    pause() {}, resume() {},
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); },
  };
  function emit(name, payload) { (listeners[name] || []).slice().forEach((fn) => fn(payload)); }
  function jpeg(width, height, hue) {
    const c = document.createElement("canvas");
    c.width = width; c.height = height;
    const g = c.getContext("2d");
    g.fillStyle = "hsl(" + hue + ", 30%, 60%)"; g.fillRect(0, 0, width, height);
    // Unique bytes per capture: the workflows server caches results by photo, and tests in other
    // projects share it. A repeated photo would be (correctly) priced at zero.
    g.fillStyle = "#000"; g.fillRect(Math.floor(Math.random() * (width - 8)), Math.floor(Math.random() * (height - 8)), 8, 8);
    return new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.8));
  }
  let shots = 0;
  window.__ymk = {
    calls, emit,
    listenerCount: (name) => (listeners[name] || []).length,
    async capture(opts) {
      const o = Object.assign({ width: 1200, height: 1600, phases: [undefined] }, opts);
      const images = [];
      for (const phase of o.phases) {
        shots += 1;
        images.push({ phase, image: await jpeg(o.width, o.height, (shots * 40) % 360), width: o.width, height: o.height });
      }
      emit("faceDetectionCaptured", { mode: "test", images });
    },
    good: () => emit("faceQualityChanged", { hasFace: true, position: "good", frontal: "good", lighting: "good" }),
  };
  window.YMK = api;
  if (typeof window.YMKAsyncInit === "function") window.YMKAsyncInit();
})();
`;

export async function installFakeCameraKit(page: Page): Promise<void> {
  await page.route(isSdk, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: SCRIPT }),
  );
}

export async function blockCameraKit(page: Page): Promise<void> {
  await page.route(isSdk, (route) => route.abort("failed"));
}

declare global {
  interface Window {
    __ymk: {
      calls: { op: string; args?: Record<string, unknown> }[];
      emit: (name: string, payload?: unknown) => void;
      listenerCount: (name: string) => number;
      capture: (opts?: {
        width?: number;
        height?: number;
        phases?: (string | undefined)[];
      }) => Promise<void>;
      good: () => void;
    };
  }
}

/** Waits for the SDK to have been initialised, then returns the init arguments. */
export async function initArgs(page: Page): Promise<Record<string, unknown>> {
  await page.waitForFunction(
    () => "__ymk" in window && window.__ymk.calls.some((c) => c.op === "open"),
  );
  return await page.evaluate(() => {
    const calls = window.__ymk.calls.filter((c) => c.op === "init");
    return calls[calls.length - 1]?.args ?? {};
  });
}
