/**
 * Sending a photo to the server (src/app/api/uploads). Uses XMLHttpRequest because `fetch` cannot
 * report upload progress, and the Ring shows it. The server checks the file's type and size; what
 * it refuses comes back as a code that this maps to plain words.
 */
export type UploadKind =
  "face" | "repeat" | "body" | "hand" | "hair_front" | "hair_right" | "hair_left" | "garment";

export interface Uploaded {
  key: string;
  width: number;
  height: number;
  hdCapable: boolean;
}

export type UploadFailure =
  | "unsupported_type"
  | "too_large"
  | "below_min_size"
  | "empty"
  | "too_many_uploads"
  | "network"
  | "unavailable";

export type UploadOutcome = { ok: true; value: Uploaded } | { ok: false; code: UploadFailure };

const KNOWN: ReadonlySet<string> = new Set([
  "unsupported_type",
  "too_large",
  "below_min_size",
  "empty",
  "too_many_uploads",
]);

export function uploadPhoto(
  blob: Blob,
  kind: UploadKind,
  onProgress?: (share: number) => void,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?kind=${kind}`);
    xhr.setRequestHeader("content-type", blob.type || "image/jpeg");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => {
      resolve({ ok: false, code: "network" });
    };
    xhr.ontimeout = () => {
      resolve({ ok: false, code: "network" });
    };
    xhr.timeout = 60_000;
    xhr.onload = () => {
      let body: unknown;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = undefined;
      }
      const record = (body ?? {}) as Record<string, unknown>;
      if (xhr.status === 201 && typeof record.key === "string") {
        resolve({
          ok: true,
          value: {
            key: record.key,
            width: Number(record.width),
            height: Number(record.height),
            hdCapable: record.hdCapable === true,
          },
        });
        return;
      }
      const error = typeof record.error === "string" ? record.error : "";
      resolve({ ok: false, code: KNOWN.has(error) ? (error as UploadFailure) : "unavailable" });
    };
    xhr.send(blob);
  });
}

/** Removes a photo the person did not keep. Best effort: the held-photo limit and sweep follow up. */
export async function discardPhoto(key: string): Promise<void> {
  try {
    await fetch(`/api/uploads?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  } catch {
    // Offline: the photo is deleted with its run, by the sweep, or with the profile.
  }
}
