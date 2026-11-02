import { afterEach, describe, expect, it, vi } from "vitest";
import { HD_SKINCARE_LONG_SIDE, meetsHdSkincare, probeCamera } from "./capability";

function fakeCamera(
  caps: { width?: number; height?: number },
  settings: { width?: number; height?: number },
) {
  const stop = vi.fn();
  const track = {
    getCapabilities: () => ({
      ...(caps.width ? { width: { max: caps.width } } : {}),
      ...(caps.height ? { height: { max: caps.height } } : {}),
    }),
    getSettings: () => settings,
    stop,
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(() => Promise.resolve(stream)) },
  });
  return stop;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeCamera", () => {
  it("reports a typical 1080p laptop camera as below the HD skin-capture requirement", async () => {
    const stop = fakeCamera({ width: 1920, height: 1080 }, { width: 1920, height: 1080 });
    const probe = await probeCamera();
    expect(probe).toEqual({ ok: true, longSide: 1920 });
    expect(meetsHdSkincare(probe)).toBe(false);
    expect(stop).toHaveBeenCalled();
  });

  it("accepts a camera with a 2560 px long side", async () => {
    fakeCamera({ width: 2560, height: 1440 }, { width: 2560, height: 1440 });
    expect(meetsHdSkincare(await probeCamera())).toBe(true);
    expect(HD_SKINCARE_LONG_SIDE).toBe(2560);
  });

  it("falls back to the settings when capabilities are not reported", async () => {
    fakeCamera({}, { width: 1280, height: 720 });
    expect(await probeCamera()).toEqual({ ok: true, longSide: 1280 });
  });

  it("tells a denied permission apart from other failures", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => Promise.reject(new DOMException("no", "NotAllowedError")),
      },
    });
    expect(await probeCamera()).toEqual({ ok: false, reason: "denied" });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: () => Promise.reject(new DOMException("busy", "NotReadableError")),
      },
    });
    expect(await probeCamera()).toEqual({ ok: false, reason: "failed" });
  });
});
