/**
 * What the webcam can deliver, checked before Camera Kit is asked for HD. YouCam's `hdskincare`
 * mode needs a webcam with a 2560 px long side (docs/YOUCAM_API.md §5); most laptop cameras top out
 * at 1920. Without this check the SDK refuses and draws its own message into the Ring, and the
 * person never sees MIRA's "Low camera resolution" state (docs/UX_FLOWS.md §3).
 */
export const HD_SKINCARE_LONG_SIDE = 2560;

export type CameraProbe =
  { ok: true; longSide: number } | { ok: false; reason: "denied" | "failed" };

/** Opens the camera once at the highest resolution it offers, reads what it can do, and closes it. */
export async function probeCamera(): Promise<CameraProbe> {
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: HD_SKINCARE_LONG_SIDE }, height: { ideal: 1920 } },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) return { ok: false, reason: "failed" };
    // Capabilities say what the camera could do; settings say what it gave. Either can be missing.
    const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    const settings = track.getSettings();
    const longSide = Math.max(
      caps.width?.max ?? 0,
      caps.height?.max ?? 0,
      settings.width ?? 0,
      settings.height ?? 0,
    );
    return { ok: true, longSide };
  } catch (e) {
    const denied =
      e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
    return { ok: false, reason: denied ? "denied" : "failed" };
  } finally {
    for (const t of stream?.getTracks() ?? []) t.stop();
  }
}

/** True when the camera can meet the HD skin-capture requirement. */
export function meetsHdSkincare(probe: CameraProbe): boolean {
  return probe.ok && probe.longSide >= HD_SKINCARE_LONG_SIDE;
}
