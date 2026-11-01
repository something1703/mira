import { err, ok, type Result } from "@mira/schemas";
import {
  invalidResponse,
  mapHttpError,
  networkError,
  uploadError,
  type YouCamError,
} from "./errors";

export const YOUCAM_BASE_URL = "https://yce-api-01.makeupar.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /**
   * Called before every request to YouCam's API. Returning an error stops the request (it is not
   * sent) and surfaces as that error: this is where the rate limiter plugs in.
   */
  gate?: () => Promise<YouCamError | undefined>;
}

/**
 * Some IDs exceed 2^53 and lose precision in JSON.parse (docs/YOUCAM_API.md §1). Quote any long
 * integer that follows an `id` key before parsing, so it survives as a string.
 */
export function parseJsonSafe(text: string): unknown {
  return JSON.parse(text.replace(/("(?:id|task_id)"\s*:\s*)(\d{16,})/g, '$1"$2"')) as unknown;
}

/**
 * Thin authenticated JSON transport. The API key is attached here and nowhere else, and only to
 * YouCam's own host: presigned upload URLs get no Authorization header.
 */
export class YouCamHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: HttpOptions) {
    this.baseUrl = options.baseUrl ?? YOUCAM_BASE_URL;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async json(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, YouCamError>> {
    const blocked = await this.options.gate?.();
    if (blocked) return err(blocked);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      return err(networkError(cause));
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text === "" ? {} : parseJsonSafe(text);
    } catch {
      return err(
        res.ok
          ? invalidResponse(path, "the body was not JSON")
          : mapHttpError(res.status, undefined),
      );
    }
    return res.ok ? ok(parsed) : err(mapHttpError(res.status, parsed));
  }

  /** Uploads bytes to a presigned URL with exactly the headers YouCam returned, and no key. */
  async put(
    url: string,
    headers: Record<string, string>,
    bytes: Uint8Array,
  ): Promise<Result<void, YouCamError>> {
    try {
      const res = await this.fetchImpl(url, { method: "PUT", headers, body: bytes });
      if (!res.ok) return err(uploadError(res.status));
      return ok(undefined);
    } catch (cause) {
      return err(networkError(cause));
    }
  }
}
