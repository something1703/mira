import { CONFIG } from "@mira/schemas";
import type { UploadFailure } from "./upload";

/** How long a photo that waits for a later run is held, from the one setting that enforces it. */
export const HELD_HOURS = CONFIG.twin.heldPhotoMinutes.value / 60;
import type { StepId } from "./flow";

/** The words of the capture screens (docs/COPY.md, docs/UX_FLOWS.md §3). */

export const STEP_TITLES: Record<StepId, string> = {
  face: "Your face",
  repeats: "Two more photos",
  body: "Your full body",
  hand: "Your hand",
  hair: "Your hair",
};

export const STEP_RAIL_LABELS: Record<StepId, string> = {
  face: "Face photo",
  repeats: "Two repeat photos",
  body: "Full-body photo",
  hand: "Hand photo",
  hair: "Hair photos",
};

export const STEP_GUIDE: Record<StepId, string> = {
  face: "Look straight at the camera in even light. Take off glasses and move hair off your forehead if you can.",
  repeats:
    "Stay where you are. MIRA takes two more photos a few seconds apart, to see how much a reading moves on its own.",
  body: "Wear a plain, light top. Dark or patterned tops can make a clothes preview come back unchanged. Step back so your whole body is in the frame.",
  hand: "Hold your hand open in front of the camera, palm facing it, in even light.",
  hair: "Take your hair down. Photos from the front, then the right, then the left.",
};

export const STEP_WHY: Partial<Record<StepId, string>> = {
  repeats:
    "Optional. They show how much a reading moves between photos taken seconds apart. Day-to-day variation needs checks on different days.",
  body: `Optional. Used later to try clothes on. Held for up to ${String(HELD_HOURS)} hours, then deleted.`,
  hand: `Optional. Used later to try on jewellery. Held for up to ${String(HELD_HOURS)} hours, then deleted.`,
  hair: "Optional. Measures hair type, density, length and frizziness.",
};

export const UPLOAD_MESSAGES: Record<UploadFailure, string> = {
  unsupported_type: "That file is not a JPEG or PNG photo. Choose a different one.",
  too_large: "That photo is over 10 MB. Choose a smaller one.",
  below_min_size:
    "That photo is too small to measure. Use one at least 480 pixels on its shorter side.",
  empty: "That file is empty. Choose a different photo.",
  too_many_uploads: "Too many photos are waiting. Delete one, or measure with the ones you have.",
  network: "The upload did not finish. Check your connection and try again.",
  unavailable: "MIRA could not take that photo just now. Try again in a moment.",
};

export const CAMERA_COPY = {
  permission: "MIRA needs your camera to measure. Nothing is recorded until you capture.",
  denied: "Camera access is off. Turn it on in your browser settings, or upload a photo.",
  deniedHow:
    "Open the lock or camera icon beside the address, allow the camera for this site, then reload this page. On a Mac, also open System Settings, Privacy & Security, Camera, and switch on your browser; until then the browser cannot even ask.",
  unsupported: "This browser cannot open the camera. Upload a photo instead.",
  lowRes:
    "This camera cannot capture the detail HD measuring needs. MIRA will measure in standard detail.",
  failed: "The camera could not be opened. Close other apps that use it, or upload a photo.",
  blocked: "The camera tool could not be loaded. Check your connection, or upload a photo.",
  /** Offered when YouCam's Camera Kit cannot open; the browser's own camera is the fallback. */
  simple:
    "The simple camera takes the photo with your browser's own camera, without the live checks. MIRA still checks the photo before measuring.",
} as const;
