import {
  CacheEntry,
  CONFIG,
  Run,
  RunNode,
  type Audit,
  type NodeError,
  type RunEvent,
  TRACE_ATTRIBUTE,
} from "@mira/schemas";
import { getDoc, updateDoc } from "@mira/runtime";
import {
  featureOf,
  type Feature,
  type FeatureInputs,
  type FeatureSlug,
  type FileRef,
  type YouCamError,
} from "@mira/youcam-client";
import { cacheKey, sha256 } from "./canonical";
import { RUN_EVENTS_TOPIC, type LifecycleDeps } from "./types";

const TERMINAL = new Set<RunNode["status"]>(["done", "cached", "failed", "skipped", "cancelled"]);
export const isTerminal = (status: RunNode["status"]): boolean => TERMINAL.has(status);

const runPath = (runId: string) => `runs/${runId}`;
const nodePath = (runId: string, nodeId: string) => `runs/${runId}/nodes/${nodeId}`;

const iso = (ms: number) => new Date(ms).toISOString();
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface FailInfo {
  code: string;
  retryable: boolean;
  upstream?: string | undefined;
}

function nodeError(e: FailInfo): NodeError {
  return {
    code: e.code,
    ...(e.upstream === undefined ? {} : { upstream: e.upstream }),
    retryable: e.retryable,
    unitsCharged: 0,
  };
}

/** Delay before poll n: 2 s growing 1.5× to a 15 s cap (CONFIG.youcam). */
export function pollDelayMs(n: number): number {
  const { pollInitialMs, pollMaxMs } = CONFIG.youcam;
  return Math.min(pollMaxMs.value, Math.round(pollInitialMs.value * 1.5 ** n));
}

/**
 * Every YouCam call in every workflow runs through here (docs/ARCHITECTURE.md §3, AGENTS.md §2.2):
 * cache check, quote and reserve, upload once, submit and persist `task_id` before waiting,
 * settle, audit, emit. A worker that restarts finds `taskId` and resumes polling; it never
 * resubmits (§2.3).
 */
export class NodeLifecycle {
  constructor(private readonly d: LifecycleDeps) {}

  /**
   * Whether this step would be a cache hit right now, so the quote can list it at zero units. It
   * uses the same key and freshness rules as `start`.
   */
  async wouldHit(spec: {
    feature?: string | undefined;
    params?: Record<string, unknown> | undefined;
    inputs?: Record<string, string> | undefined;
  }): Promise<boolean> {
    const feature =
      spec.feature === undefined
        ? undefined
        : (featureOf(spec.feature as FeatureSlug) as Feature | undefined);
    if (!feature) return false;
    const probe = RunNode.parse({
      id: "probe",
      runId: "run_probe0",
      kind: "youcam",
      label: "probe",
      dependsOn: [],
      status: "queued",
      params: spec.params ?? {},
      inputs: spec.inputs ?? {},
    });
    const key = await this.keyFor(probe, feature);
    return key !== undefined && (await this.lookup(key)) !== undefined;
  }

  // ------------------------------------------------------------------ steps 1–4: start

  async start(runId: string, nodeId: string): Promise<void> {
    const loaded = await this.load(runId, nodeId);
    if (!loaded) return;
    let { node } = loaded;
    const { run } = loaded;
    if (isTerminal(node.status) || node.kind !== "youcam") return;

    // Crash rule: a task was already created, so only waiting remains. Never submit twice.
    if (node.taskId !== undefined) {
      await this.enqueuePoll(runId, nodeId, 0, 0);
      return;
    }

    const feature = this.featureFor(node);
    if (!feature) {
      await this.fail(run, node, { code: "unknown_feature", retryable: false }, false);
      return;
    }
    const parsed = feature.params.safeParse(node.params);
    if (!parsed.success) {
      await this.fail(run, node, { code: "invalid_request", retryable: false }, false);
      return;
    }

    node = await this.patch(runId, nodeId, (n) => ({
      ...n,
      status: "running",
      attempts: n.attempts + 1,
      startedAt: n.startedAt ?? iso(this.d.clock.now()),
    }));
    if (node.attempts === 1) await this.emit(run, nodeId, "node_started");

    // Step 1: cache check.
    const key = await this.keyFor(node, feature);
    if (key === undefined) {
      await this.fail(run, node, { code: "input_missing", retryable: false }, false);
      return;
    }
    if (node.cacheKey !== key)
      node = await this.patch(runId, nodeId, (n) => ({ ...n, cacheKey: key }));
    const hit = await this.lookup(key);
    if (hit) {
      await this.settleFromCache(run, node, hit);
      return;
    }

    // Step 2: quote and reserve.
    const skus = await this.d.costs.get();
    if (!skus.ok) {
      await this.retryStart(run, node, skus.error);
      return;
    }
    const price = feature.price(parsed.data, skus.value);
    if (!price.ok) {
      await this.fail(run, node, { code: price.error.code, retryable: false }, false);
      return;
    }
    const balance = await this.d.balance.get();
    if (!balance.ok) {
      await this.retryStart(run, node, balance.error);
      return;
    }
    const ref = { runId, nodeId, sessionId: run.sessionId, feature: feature.slug };
    const reserved = await this.d.ledger.reserve(ref, price.value, balance.value.units);
    if (!reserved.ok) {
      await this.fail(run, node, { code: reserved.error.code, retryable: false }, false);
      return;
    }
    node = await this.patch(runId, nodeId, (n) => ({ ...n, unitsReserved: reserved.value }));

    // Step 3: upload once.
    const inputs = await this.resolveInputs(node, feature);
    if (!inputs.ok) {
      await this.retryStart(run, node, inputs.error);
      return;
    }

    // Step 4: submit and persist the task id before waiting.
    const created = await this.d.api.createTask(
      feature,
      feature.buildBody(parsed.data, inputs.value),
    );
    if (!created.ok) {
      await this.retryStart(run, node, created.error);
      return;
    }
    const { taskId } = created.value;
    await this.d.state.set(`tasks/${taskId}`, { runId, nodeId });
    await this.patch(runId, nodeId, (n) => ({ ...n, taskId, status: "waiting" }));
    await this.emit(run, nodeId, "node_waiting");
    await this.enqueuePoll(runId, nodeId, 0, pollDelayMs(0));
  }

  /** A retryable failure before a task exists is retried with backoff; anything else fails the node. */
  private async retryStart(run: Run, node: RunNode, e: YouCamError): Promise<void> {
    if (e.retryable && node.attempts < CONFIG.youcam.maxRetries.value) {
      await this.d.queue.enqueue("youcam-submit", {
        payload: { op: "start", runId: node.runId, nodeId: node.id },
        delayMs: pollDelayMs(node.attempts),
        dedupeKey: `start:${node.runId}:${node.id}:${String(node.attempts)}`,
      });
      return;
    }
    await this.fail(run, node, nodeError(e), true);
  }

  // ------------------------------------------------------------------ step 5: wait

  async poll(runId: string, nodeId: string, n: number): Promise<void> {
    const loaded = await this.load(runId, nodeId);
    if (!loaded) return;
    const { run, node } = loaded;
    if (isTerminal(node.status) || node.taskId === undefined) return;
    const feature = this.featureFor(node);
    if (!feature) return;

    const res = await this.d.api.getTask(feature, node.taskId);
    if (!res.ok) {
      const tooLong = this.waitedMs(node) > CONFIG.youcam.pollGiveUpMs.value;
      if (res.error.retryable && !tooLong) {
        await this.enqueuePoll(runId, nodeId, n + 1, pollDelayMs(n + 1));
        return;
      }
      await this.fail(run, node, nodeError(res.error), true);
      return;
    }
    const state = res.value;
    if (state.status === "running") {
      if (this.waitedMs(node) > CONFIG.youcam.pollGiveUpMs.value) {
        // The task may still finish on YouCam's side; it is deleted with the run's other tasks.
        await this.fail(run, node, { code: "youcam_timeout", retryable: true }, true);
        return;
      }
      await this.enqueuePoll(runId, nodeId, n + 1, pollDelayMs(n + 1));
      return;
    }
    if (state.status === "error") {
      await this.fail(run, node, nodeError(state.error), true);
      return;
    }

    // Step 6: settle.
    const out = feature.result.safeParse(state.results);
    if (!out.success) {
      // YouCam reported success, so it charged; keep the commit and say the result was unreadable.
      this.d.balance.invalidate();
      await this.d.ledger.commit(this.refOf(run, node));
      await this.fail(run, node, { code: "invalid_response", retryable: false }, false);
      return;
    }
    await this.settleSuccess(run, node, feature, out.data, n);
  }

  /** Resolves a task id from a webhook to its node and polls right away. */
  async pollNow(taskId: string, webhookId: string): Promise<boolean> {
    const index = await this.d.state.get(`tasks/${taskId}`);
    if (typeof index !== "object" || index === null) return false;
    const { runId, nodeId } = index as { runId: string; nodeId: string };
    await this.d.queue.enqueue("youcam-poll", {
      payload: { op: "poll", runId, nodeId, n: 0 },
      dedupeKey: `webhook:${webhookId}`,
    });
    return true;
  }

  // ------------------------------------------------------------------ step 6–8

  private async settleSuccess(
    run: Run,
    node: RunNode,
    feature: Feature,
    result: unknown,
    n: number,
  ): Promise<void> {
    let resultRef: string | undefined;
    let resultUrl: string | undefined;
    let output: unknown;
    const url = (result as { url?: unknown }).url;
    if (typeof url === "string") {
      // Result URLs last 2 hours, so the image is copied out now (F4).
      const dl = await this.d.download(url);
      if (!dl.ok) {
        if (this.waitedMs(node) > CONFIG.youcam.pollGiveUpMs.value) {
          await this.fail(run, node, { code: "download_failed", retryable: true }, true);
          return;
        }
        await this.enqueuePoll(run.id, node.id, n + 1, pollDelayMs(n + 1));
        return;
      }
      const ext = EXT[dl.value.contentType] ?? "bin";
      resultRef = `runs/${run.id}/${node.id}/output.${ext}`;
      await this.d.blobs.put(resultRef, dl.value.bytes, dl.value.contentType);
      resultUrl = url;
    } else {
      output = result;
    }

    this.d.balance.invalidate();
    const units = await this.d.ledger.commit(this.refOf(run, node));
    const expiresAt = iso(this.d.clock.now() + CONFIG.youcam.resultUrlHours.value * 3_600_000);

    if (node.cacheKey !== undefined) {
      const entry: CacheEntry = {
        feature: feature.slug,
        ...(output === undefined ? {} : { output }),
        ...(resultRef === undefined ? {} : { resultRef }),
        engineVersion: this.d.engineVersion,
        createdAt: iso(this.d.clock.now()),
      };
      await this.d.state.set(`cache/${node.cacheKey}`, entry);
    }

    const audit = await this.runAudit(run, node, output, resultRef);
    await this.patch(run.id, node.id, (cur) => ({
      ...cur,
      status: "done",
      unitsCommitted: units,
      ...(resultRef === undefined ? {} : { resultRef }),
      ...(resultUrl === undefined ? {} : { resultUrl, resultUrlExpiresAt: expiresAt }),
      ...(output === undefined ? {} : { output }),
      ...(audit ? { audit } : {}),
      endedAt: iso(this.d.clock.now()),
    }));
    await this.emit(run, node.id, "node_done");
    await this.d.onSettled(run.id);
  }

  private async settleFromCache(run: Run, node: RunNode, hit: CacheEntry): Promise<void> {
    const audit = await this.runAudit(run, node, hit.output, hit.resultRef);
    await this.patch(run.id, node.id, (cur) => ({
      ...cur,
      status: "cached",
      unitsCommitted: 0,
      ...(hit.resultRef === undefined ? {} : { resultRef: hit.resultRef }),
      ...(hit.output === undefined ? {} : { output: hit.output }),
      ...(audit ? { audit } : {}),
      endedAt: iso(this.d.clock.now()),
    }));
    await this.emit(run, node.id, "node_cached");
    await this.d.onSettled(run.id);
  }

  /** Step 7: nothing downstream or visible is released before the audit has run. */
  private async runAudit(
    run: Run,
    node: RunNode,
    output: unknown,
    resultRef: string | undefined,
  ): Promise<Audit | undefined> {
    if (!this.d.audit || resultRef === undefined) return undefined;
    let audit: Audit | undefined;
    try {
      audit = await this.d.audit({ run, node, output, resultRef });
    } catch (error) {
      this.d.log("audit failed", { runId: run.id, nodeId: node.id, error: String(error) });
      audit = {
        kind: "garment",
        outcome: "not_checked",
        directions: [],
        reason: "audit_error",
        engineVersion: this.d.engineVersion,
      };
    }
    if (audit) await this.emit(run, node.id, "node_audited");
    return audit;
  }

  /** A failed task cost nothing: release the reserve, record why, and let the runner react. */
  async fail(run: Run, node: RunNode, error: FailInfo, release: boolean): Promise<void> {
    if (release) await this.d.ledger.release(this.refOf(run, node));
    await this.patch(run.id, node.id, (cur) => ({
      ...cur,
      status: "failed",
      error: nodeError(error),
      endedAt: iso(this.d.clock.now()),
    }));
    await this.emit(run, node.id, "node_failed");
    await this.d.onSettled(run.id);
  }

  // ------------------------------------------------------------------ inputs

  /** Uploads each input once and stores its file id before the next step (AGENTS.md §2.2). */
  private async resolveInputs(
    node: RunNode,
    feature: Feature,
  ): Promise<{ ok: true; value: FeatureInputs } | { ok: false; error: YouCamError }> {
    const roles =
      feature.inputs === "triple"
        ? ["src0", "src1", "src2"]
        : feature.inputs === "single+ref"
          ? ["src", "ref"]
          : ["src"];
    const refs: Record<string, FileRef> = {};
    for (const role of roles) {
      const spec = node.inputs[role];
      if (spec === undefined) return { ok: false, error: missingInput(role) };
      const known = (await this.fresh(node)).files[role];
      if (known !== undefined) {
        refs[role] = { fileId: known };
        continue;
      }
      const resolved = await this.resolveOne(node, role, spec);
      if (!resolved.ok) return resolved;
      refs[role] = resolved.value;
    }
    const inputs: FeatureInputs = {
      ...(refs.src ? { src: refs.src } : {}),
      ...(refs.ref ? { ref: refs.ref } : {}),
      ...(refs.src0 && refs.src1 && refs.src2
        ? { srcs: [refs.src0, refs.src1, refs.src2] as const }
        : {}),
    };
    return { ok: true, value: inputs };
  }

  private async resolveOne(
    node: RunNode,
    role: string,
    spec: string,
  ): Promise<{ ok: true; value: FileRef } | { ok: false; error: YouCamError }> {
    if (spec.startsWith("url:")) return { ok: true, value: { url: spec.slice(4) } };
    let blobKey: string | undefined;
    if (spec.startsWith("node:")) {
      const up = await getDoc(this.d.state, nodePath(node.runId, spec.slice(5)), RunNode);
      if (up?.resultUrl && up.resultUrlExpiresAt) {
        const margin = CONFIG.youcam.resultUrlSafetyMinutes.value * 60_000;
        // D12: chain on the previous result's URL while it is valid, else upload the stored copy.
        if (Date.parse(up.resultUrlExpiresAt) - this.d.clock.now() > margin) {
          return { ok: true, value: { url: up.resultUrl } };
        }
      }
      blobKey = up?.resultRef;
    } else if (spec.startsWith("blob:")) {
      blobKey = spec.slice(5);
    }
    const blob = blobKey === undefined ? undefined : await this.d.blobs.get(blobKey);
    if (!blob) return { ok: false, error: missingInput(role) };

    const reg = await this.d.api.registerFile({
      contentType: blob.contentType,
      fileName: `${role}.${EXT[blob.contentType] ?? "bin"}`,
      fileSize: blob.bytes.byteLength,
    });
    if (!reg.ok) return reg;
    const put = await this.d.api.putBytes(reg.value, blob.bytes);
    if (!put.ok) return put;
    await this.patch(node.runId, node.id, (n) => ({
      ...n,
      files: { ...n.files, [role]: reg.value.fileId },
    }));
    return { ok: true, value: { fileId: reg.value.fileId } };
  }

  /** The cache key covers the bytes of every input, so a different photo is a different key. */
  private async keyFor(node: RunNode, feature: Feature): Promise<string | undefined> {
    const parts: string[] = [];
    for (const role of Object.keys(node.inputs).sort()) {
      const spec = node.inputs[role] ?? "";
      if (spec.startsWith("blob:")) {
        const blob = await this.d.blobs.get(spec.slice(5));
        if (!blob) return undefined;
        parts.push(`${role}=${sha256(blob.bytes)}`);
      } else if (spec.startsWith("node:")) {
        const up = await getDoc(this.d.state, nodePath(node.runId, spec.slice(5)), RunNode);
        if (!up) return undefined;
        parts.push(`${role}=${up.cacheKey ?? `${up.runId}/${up.id}`}`);
      } else {
        parts.push(`${role}=${sha256(spec)}`);
      }
    }
    return cacheKey({
      inputHash: sha256(parts.join("|")),
      feature: feature.slug,
      version: feature.version,
      params: node.params,
      engineVersion: this.d.engineVersion,
    });
  }

  /**
   * A hit needs to be fresh (7 days) and, for an image, its blob must still exist: images are
   * deleted when their run ends, so an image result is only ever reused inside its own run (D23).
   */
  private async lookup(key: string): Promise<CacheEntry | undefined> {
    const entry = await getDoc(this.d.state, `cache/${key}`, CacheEntry);
    if (!entry) return undefined;
    const ageMs = this.d.clock.now() - Date.parse(entry.createdAt);
    if (ageMs > CONFIG.retention.cacheDays.value * 86_400_000) return undefined;
    if (entry.resultRef !== undefined && !(await this.d.blobs.get(entry.resultRef)))
      return undefined;
    return entry;
  }

  // ------------------------------------------------------------------ plumbing

  private featureFor(node: RunNode): Feature | undefined {
    return node.feature === undefined ? undefined : featureOf(node.feature as FeatureSlug);
  }

  private waitedMs(node: RunNode): number {
    return node.startedAt === undefined ? 0 : this.d.clock.now() - Date.parse(node.startedAt);
  }

  private refOf(run: Run, node: RunNode) {
    return {
      runId: run.id,
      nodeId: node.id,
      sessionId: run.sessionId,
      feature: node.feature ?? "unknown",
    };
  }

  private async load(runId: string, nodeId: string) {
    const [run, node] = await Promise.all([
      getDoc(this.d.state, runPath(runId), Run),
      getDoc(this.d.state, nodePath(runId, nodeId), RunNode),
    ]);
    return run && node ? { run, node } : undefined;
  }

  private async fresh(node: RunNode): Promise<RunNode> {
    return (await getDoc(this.d.state, nodePath(node.runId, node.id), RunNode)) ?? node;
  }

  private async patch(
    runId: string,
    nodeId: string,
    fn: (n: RunNode) => RunNode,
  ): Promise<RunNode> {
    return await updateDoc(this.d.state, nodePath(runId, nodeId), RunNode, (cur) => {
      if (!cur) throw new Error(`Node ${nodeId} of ${runId} does not exist`);
      return fn(cur);
    });
  }

  private async enqueuePoll(
    runId: string,
    nodeId: string,
    n: number,
    delayMs: number,
  ): Promise<void> {
    await this.d.queue.enqueue("youcam-poll", {
      payload: { op: "poll", runId, nodeId, n },
      delayMs,
      dedupeKey: `poll:${runId}:${nodeId}:${String(n)}`,
    });
  }

  private async emit(run: Run, nodeId: string | undefined, type: RunEvent["type"]): Promise<void> {
    const event: RunEvent = {
      runId: run.id,
      ...(nodeId === undefined ? {} : { nodeId }),
      type,
      at: iso(this.d.clock.now()),
      traceId: run.traceId,
    };
    // The trace travels as a message attribute too, as Pub/Sub carries it live (AGENTS.md §7).
    await this.d.events.publish(RUN_EVENTS_TOPIC, event, { [TRACE_ATTRIBUTE]: run.traceId });
  }
}

function missingInput(role: string): YouCamError {
  return {
    kind: "invalid_response",
    code: "input_missing",
    message: `Input ${role} could not be found`,
    retryable: false,
    guidance: "none",
    unitsCharged: 0,
  };
}
