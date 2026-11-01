import { CONFIG } from "@mira/schemas";
import type { Clock } from "@mira/runtime";
import { HttpYouCamApi, RateLimiter } from "@mira/youcam-client";

/**
 * The one way a real `HttpYouCamApi` is built: every request passes MIRA's own sliding-window
 * limiter, sized under YouCam's 250 requests per 300 s (docs/FACTS.md F11). Queue rates alone
 * cannot promise that, because a submit can be four calls and cleanup and balance reads count too.
 */
export function liveYouCam(
  options: { apiKey: string; baseUrl?: string | undefined },
  clock: Clock,
): { api: HttpYouCamApi; limiter: RateLimiter } {
  const limiter = new RateLimiter({
    limit: CONFIG.youcam.requestsPerWindow.value,
    windowMs: CONFIG.youcam.rateWindowSeconds.value * 1000,
    maxWaitMs: CONFIG.youcam.rateMaxWaitSeconds.value * 1000,
    clock,
  });
  const api = new HttpYouCamApi({
    apiKey: options.apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    gate: () => limiter.acquire(),
  });
  return { api, limiter };
}
