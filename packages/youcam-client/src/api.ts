import { err, ok, type Result } from "@mira/schemas";
import { type YouCamError, invalidResponse, mapTaskError } from "./errors";
import { taskPath, type Feature } from "./features";
import { YouCamHttp, type FetchLike } from "./http";
import { slugOf, type Sku } from "./pricing";
import {
  CreateTaskResponse,
  CreditResponse,
  FeatureCostResponse,
  OkResponse,
  RegisterFileResponse,
  TaskStatusResponse,
} from "./schemas/envelopes";
import type { z } from "zod";

export interface RegisteredFile {
  readonly fileId: string;
  readonly method: string;
  readonly url: string;
  /** Exactly the headers YouCam returned; the PUT must send these and no others. */
  readonly headers: Record<string, string>;
}

export type TaskState =
  | { readonly status: "running" }
  | { readonly status: "success"; readonly results: unknown }
  | { readonly status: "error"; readonly error: YouCamError };

export interface CreditBalance {
  /** Sum of `amount_dec` over entries that have not expired. */
  readonly units: number;
  readonly entries: readonly { readonly units: number; readonly expiresAt?: number }[];
}

type TaskRef = Pick<Feature, "slug" | "version">;
type Res<T> = Promise<Result<T, YouCamError>>;

/** The seam the lifecycle depends on. `HttpYouCamApi` is real; `FakeYouCam` is the test double. */
export interface YouCamApi {
  registerFile(input: {
    contentType: string;
    fileName: string;
    fileSize: number;
  }): Res<RegisteredFile>;
  putBytes(file: RegisteredFile, bytes: Uint8Array): Res<void>;
  createTask(feature: TaskRef, body: Record<string, unknown>): Res<{ taskId: string }>;
  getTask(feature: TaskRef, taskId: string): Res<TaskState>;
  /** Deletes a finished task with its input files and outputs. Fails while it is running. */
  deleteTask(taskId: string): Res<void>;
  getCredit(now?: number): Res<CreditBalance>;
  /** Every page of the feature-cost endpoint. Free. */
  getFeatureCosts(): Res<Sku[]>;
}

function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): Result<z.infer<S>, YouCamError> {
  const out = schema.safeParse(value);
  return out.success
    ? ok(out.data)
    : err(
        invalidResponse(
          what,
          out.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        ),
      );
}

export interface HttpYouCamOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  /** Rate limiting and similar checks that run before every request (see `YouCamHttp`). */
  gate?: () => Promise<YouCamError | undefined>;
}

export class HttpYouCamApi implements YouCamApi {
  private readonly http: YouCamHttp;

  constructor(options: HttpYouCamOptions) {
    this.http = new YouCamHttp(options);
  }

  async registerFile(input: {
    contentType: string;
    fileName: string;
    fileSize: number;
  }): Res<RegisteredFile> {
    const res = await this.http.json("POST", "/s2s/v2.0/file", {
      files: [
        { content_type: input.contentType, file_name: input.fileName, file_size: input.fileSize },
      ],
    });
    if (!res.ok) return res;
    const parsed = parse(RegisterFileResponse, res.value, "register file");
    if (!parsed.ok) return parsed;
    const file = parsed.value.data.files[0];
    const req = file?.requests[0];
    if (!file || !req) return err(invalidResponse("register file", "no upload request"));
    return ok({ fileId: file.file_id, method: req.method, url: req.url, headers: req.headers });
  }

  async putBytes(file: RegisteredFile, bytes: Uint8Array): Res<void> {
    // Registering alone uploads nothing; skipping this PUT makes the task fail later with a 404
    // or 500 (docs/YOUCAM_API.md §1). No Authorization header goes to the presigned host.
    return await this.http.put(file.url, file.headers, bytes);
  }

  async createTask(feature: TaskRef, body: Record<string, unknown>): Res<{ taskId: string }> {
    const res = await this.http.json("POST", taskPath(feature), body);
    if (!res.ok) return res;
    const parsed = parse(CreateTaskResponse, res.value, "create task");
    return parsed.ok ? ok({ taskId: parsed.value.data.task_id }) : parsed;
  }

  async getTask(feature: TaskRef, taskId: string): Res<TaskState> {
    const res = await this.http.json("GET", `${taskPath(feature)}/${encodeURIComponent(taskId)}`);
    if (!res.ok) return res;
    const parsed = parse(TaskStatusResponse, res.value, "task status");
    if (!parsed.ok) return parsed;
    const d = parsed.value.data;
    if (d.task_status === "running") return ok({ status: "running" });
    if (d.task_status === "error") {
      return ok({ status: "error", error: mapTaskError(d.error, d.error_message ?? undefined) });
    }
    return ok({ status: "success", results: d.results });
  }

  async deleteTask(taskId: string): Res<void> {
    const res = await this.http.json("POST", "/s2s/v2.0/task/delete", { task_id: taskId });
    if (!res.ok) return res;
    const parsed = parse(OkResponse, res.value, "delete task");
    return parsed.ok ? ok(undefined) : parsed;
  }

  async getCredit(now = Date.now()): Res<CreditBalance> {
    const res = await this.http.json("GET", "/s2s/v1.0/client/credit");
    if (!res.ok) return res;
    const parsed = parse(CreditResponse, res.value, "credit balance");
    if (!parsed.ok) return parsed;
    const entries = parsed.value.results.map((e) => ({
      units: e.amount_dec,
      ...(e.expiry === undefined ? {} : { expiresAt: e.expiry }),
    }));
    const live = entries.filter((e) => e.expiresAt === undefined || e.expiresAt > now);
    return ok({ units: live.reduce((sum, e) => sum + e.units, 0), entries });
  }

  async getFeatureCosts(): Res<Sku[]> {
    const skus: Sku[] = [];
    let token: string | undefined;
    // The endpoint is paged at 20 and free; stop if a page repeats its token.
    for (let page = 0; page < 50; page++) {
      const query = `page_size=20${token ? `&starting_token=${encodeURIComponent(token)}` : ""}`;
      const res = await this.http.json("GET", `/s2s/v2.0/credit/feature-cost?${query}`);
      if (!res.ok) return res;
      const parsed = parse(FeatureCostResponse, res.value, "feature cost");
      if (!parsed.ok) return parsed;
      for (const s of parsed.value.result.skus) {
        skus.push({
          ...(s.description === undefined ? {} : { description: s.description }),
          amount: s.amount,
          ...(s.unit === undefined ? {} : { unit: s.unit }),
          slug: slugOf(s.run_task_url),
        });
      }
      const next = parsed.value.result.next_token ?? undefined;
      if (next === undefined || next === "" || next === token) return ok(skus);
      token = next;
    }
    return err(invalidResponse("feature cost", "more than 50 pages"));
  }
}
