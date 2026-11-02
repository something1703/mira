import { CONFIG, err, ok, type Result } from "@mira/schemas";
import type { Clock } from "@mira/runtime";
import type { CreditBalance, Sku, YouCamApi, YouCamError } from "@mira/youcam-client";

/** Feature-cost SKUs, refreshed daily (phases/PHASE_03: "cost cache refreshed daily"). */
export class FeatureCostCache {
  private skus: Sku[] | undefined;
  private fetchedAt = 0;

  constructor(
    private readonly api: YouCamApi,
    private readonly clock: Clock,
  ) {}

  async get(): Promise<Result<readonly Sku[], YouCamError>> {
    const ttl = CONFIG.youcam.featureCostCacheHours.value * 3_600_000;
    if (this.skus && this.clock.now() - this.fetchedAt < ttl) return ok(this.skus);
    const res = await this.api.getFeatureCosts();
    if (!res.ok) return this.skus ? ok(this.skus) : err(res.error); // stale prices beat none
    this.skus = res.value;
    this.fetchedAt = this.clock.now();
    return ok(res.value);
  }

  /** When the prices were last read, for the quote's `pricedAt`. */
  get pricedAt(): number {
    return this.fetchedAt;
  }
}

/** The live balance, re-read at most every few seconds because polls share a rate budget. */
export class BalanceCache {
  private balance: CreditBalance | undefined;
  private fetchedAt = -Infinity;

  constructor(
    private readonly api: YouCamApi,
    private readonly clock: Clock,
  ) {}

  async get(): Promise<Result<CreditBalance, YouCamError>> {
    const ttl = CONFIG.budget.balanceCacheSeconds.value * 1000;
    if (this.balance && this.clock.now() - this.fetchedAt < ttl) return ok(this.balance);
    const res = await this.api.getCredit(this.clock.now());
    if (!res.ok) return res;
    this.balance = res.value;
    this.fetchedAt = this.clock.now();
    return res;
  }

  /** After a task settles the balance changed; read it fresh next time. */
  invalidate(): void {
    this.fetchedAt = -Infinity;
  }
}
