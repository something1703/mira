import type { Downloader } from "./types";

/** Downloads a result URL. Result URLs expire after 2 hours, so this runs as soon as a task settles. */
export const fetchDownloader: Downloader = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok)
      return { ok: false, error: { message: `download answered ${String(res.status)}` } };
    return {
      ok: true,
      value: {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: error instanceof Error ? error.message : "download failed" },
    };
  }
};
