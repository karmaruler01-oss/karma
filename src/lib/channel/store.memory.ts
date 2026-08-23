// In-memory ChannelStore.
//
// Same contract as the Lovable Cloud store (store.supabase.ts) so the exact
// same persistence logic in brain.server.ts can be exercised deterministically
// in tests. It stores what it is given: a null metric stays null, a zero stays
// zero, and nothing is ever back-filled with invented values.

import type {
  BaselineStats,
  NextVideoStrategy,
} from "./types";
import {
  EMPTY_CHANNEL_PROFILE,
  type ChannelDefaults,
  type ChannelStore,
  type LearningRow,
  type StoredChannelProfile,
  type ExperimentIntel,
  type ExperimentPatch,
  type StoredExperiment,
  type StoredMetrics,
  type StoredStrategy,
  type StoredVideo,
  type SyncLogRow,
} from "./store";
import type { IntelligenceSummary } from "./intel/types";

export interface MemoryStoreSeed {
  videos?: StoredVideo[];
  metrics?: StoredMetrics[];
  defaults?: Partial<ChannelDefaults>;
  productionCount?: number;
  channelProfile?: Partial<StoredChannelProfile>;
}

const DEFAULTS: ChannelDefaults = {
  durationSeconds: 60,
  genre: "mystery",
  narrationStyle: "cinematic",
  uploadTime: "18:00",
  explorationRatio: null,
};

interface Bucket {
  videos: Map<string, StoredVideo>;
  metrics: Map<string, StoredMetrics>;
  learnings: LearningRow[];
  baselines: Map<string, BaselineStats>;
  strategies: StoredStrategy[];
  experiments: StoredExperiment[];
  syncLog: SyncLogRow[];
  defaults: ChannelDefaults;
  productionCount: number;
  profile: StoredChannelProfile | null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export class MemoryChannelStore implements ChannelStore {
  private buckets = new Map<string, Bucket>();
  private seq = 0;
  /** Fixed clock so tests stay deterministic; defaults to the real clock. */
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  private bucket(userId: string): Bucket {
    let bucket = this.buckets.get(userId);
    if (!bucket) {
      bucket = {
        videos: new Map(),
        metrics: new Map(),
        learnings: [],
        baselines: new Map(),
        strategies: [],
        experiments: [],
        syncLog: [],
        defaults: { ...DEFAULTS },
        productionCount: 0,
        profile: null,
      };
      this.buckets.set(userId, bucket);
    }
    return bucket;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  seed(userId: string, seed: MemoryStoreSeed): void {
    const bucket = this.bucket(userId);
    for (const video of seed.videos ?? []) bucket.videos.set(video.videoId, clone(video));
    for (const row of seed.metrics ?? [])
      bucket.metrics.set(`${row.videoId}::${row.windowKey}`, clone(row));
    if (seed.defaults) bucket.defaults = { ...bucket.defaults, ...seed.defaults };
    if (typeof seed.productionCount === "number") bucket.productionCount = seed.productionCount;
    if (seed.channelProfile)
      bucket.profile = { ...EMPTY_CHANNEL_PROFILE, ...bucket.profile, ...seed.channelProfile };
  }

  async listVideos(userId: string): Promise<StoredVideo[]> {
    return clone([...this.bucket(userId).videos.values()]);
  }

  async listMetrics(userId: string): Promise<StoredMetrics[]> {
    return clone([...this.bucket(userId).metrics.values()]);
  }

  async upsertVideos(userId: string, videos: StoredVideo[]): Promise<number> {
    const bucket = this.bucket(userId);
    for (const video of videos) bucket.videos.set(video.videoId, clone(video));
    return videos.length;
  }

  async upsertMetrics(userId: string, rows: StoredMetrics[]): Promise<number> {
    const bucket = this.bucket(userId);
    for (const row of rows) bucket.metrics.set(`${row.videoId}::${row.windowKey}`, clone(row));
    return rows.length;
  }

  async listLearningRows(userId: string): Promise<LearningRow[]> {
    return clone(this.bucket(userId).learnings);
  }

  async replaceLearningRows(
    userId: string,
    videoId: string | null,
    categories: string[],
    rows: LearningRow[],
  ): Promise<number> {
    const bucket = this.bucket(userId);
    bucket.learnings = bucket.learnings.filter(
      (row) => !(row.videoId === videoId && categories.includes(row.category)),
    );
    bucket.learnings.push(...clone(rows));
    return rows.length;
  }

  async saveBaselines(userId: string, baselines: BaselineStats[]): Promise<number> {
    const bucket = this.bucket(userId);
    for (const baseline of baselines)
      bucket.baselines.set(`${baseline.windowKey}::${baseline.cohort}`, clone(baseline));
    return baselines.length;
  }

  async listBaselines(userId: string): Promise<BaselineStats[]> {
    return clone([...this.bucket(userId).baselines.values()]);
  }

  async latestStrategy(userId: string): Promise<StoredStrategy | null> {
    const active = this.bucket(userId)
      .strategies.filter((s) => s.active)
      .sort((a, b) => b.version - a.version);
    return active.length ? clone(active[0]!) : null;
  }

  async saveStrategy(
    userId: string,
    strategy: NextVideoStrategy,
    extra?: { reuseVersion?: number | null; intelligence?: IntelligenceSummary | null },
  ): Promise<StoredStrategy> {
    const bucket = this.bucket(userId);
    const reuse =
      typeof extra?.reuseVersion === "number"
        ? bucket.strategies.find((s) => s.version === extra.reuseVersion)
        : undefined;
    if (reuse) {
      reuse.strategy = clone(strategy);
      reuse.sufficiency = strategy.sufficiency;
      reuse.active = true;
      if (extra?.intelligence !== undefined) reuse.intelligence = clone(extra.intelligence);
      return clone(reuse);
    }
    const version = bucket.strategies.reduce((max, s) => Math.max(max, s.version), 0) + 1;
    for (const existing of bucket.strategies) existing.active = false;
    const row: StoredStrategy = {
      id: this.nextId("strategy"),
      version,
      active: true,
      createdAt: this.now(),
      sufficiency: strategy.sufficiency,
      strategy: clone(strategy),
      intelligence: clone(extra?.intelligence ?? null),
    };
    bucket.strategies.push(row);
    return clone(row);
  }

  async listExperiments(userId: string): Promise<StoredExperiment[]> {
    return clone(this.bucket(userId).experiments);
  }

  async saveExperiment(
    userId: string,
    input: {
      videoId?: string | null;
      projectId?: string | null;
      hypothesis: string;
      whatChanged: string;
      expectedOutcome?: string | null;
      mode: string;
      state?: string;
      intel?: ExperimentIntel | null;
    },
  ): Promise<StoredExperiment> {
    const bucket = this.bucket(userId);
    const key = input.intel?.key ?? null;
    const existing = bucket.experiments.find((e) =>
      key !== null
        ? e.intel?.key === key
        : e.hypothesis === input.hypothesis && e.whatChanged === input.whatChanged,
    );
    if (existing) return clone(existing);
    const row: StoredExperiment = {
      id: this.nextId("experiment"),
      videoId: input.videoId ?? null,
      projectId: input.projectId ?? null,
      hypothesis: input.hypothesis,
      whatChanged: input.whatChanged,
      state: input.state ?? "NEW_EXPERIMENT",
      mode: input.mode,
      createdAt: this.now(),
      expectedOutcome: input.expectedOutcome ?? null,
      actualOutcome: null,
      conclusion: null,
      confidence: 0,
      nextAction: null,
      intel: clone(input.intel ?? null),
    };
    bucket.experiments.push(row);
    return clone(row);
  }

  async updateExperiment(
    userId: string,
    id: string,
    patch: ExperimentPatch,
  ): Promise<StoredExperiment | null> {
    const row = this.bucket(userId).experiments.find((e) => e.id === id);
    if (!row) return null;
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.actualOutcome !== undefined) row.actualOutcome = patch.actualOutcome;
    if (patch.conclusion !== undefined) row.conclusion = patch.conclusion;
    if (patch.confidence !== undefined) row.confidence = patch.confidence;
    if (patch.nextAction !== undefined) row.nextAction = patch.nextAction;
    return clone(row);
  }

  async channelDefaults(userId: string): Promise<ChannelDefaults> {
    return { ...this.bucket(userId).defaults };
  }

  async productionCount(userId: string): Promise<number> {
    return this.bucket(userId).productionCount;
  }

  async getChannelProfile(userId: string): Promise<StoredChannelProfile | null> {
    const profile = this.bucket(userId).profile;
    return profile ? clone(profile) : null;
  }

  async saveChannelProfile(
    userId: string,
    patch: Partial<StoredChannelProfile>,
  ): Promise<StoredChannelProfile> {
    const bucket = this.bucket(userId);
    bucket.profile = {
      ...EMPTY_CHANNEL_PROFILE,
      ...(bucket.profile ?? {}),
      ...clone(patch),
    };
    return clone(bucket.profile);
  }

  async startSync(userId: string, kind: string): Promise<string> {
    const row: SyncLogRow = {
      id: this.nextId("sync"),
      kind,
      status: "RUNNING",
      detail: null,
      itemsSynced: 0,
      startedAt: this.now(),
      finishedAt: null,
    };
    this.bucket(userId).syncLog.push(row);
    return row.id;
  }

  async finishSync(
    id: string,
    status: SyncLogRow["status"],
    detail: string | null,
    itemsSynced: number,
  ): Promise<void> {
    for (const bucket of this.buckets.values()) {
      const row = bucket.syncLog.find((r) => r.id === id);
      if (!row) continue;
      row.status = status;
      row.detail = detail;
      row.itemsSynced = itemsSynced;
      row.finishedAt = this.now();
      return;
    }
    throw new Error(`Unknown sync log id: ${id}`);
  }

  async lastSuccessfulSync(userId: string, kind: string): Promise<SyncLogRow | null> {
    const rows = this.bucket(userId)
      .syncLog.filter((r) => r.kind === kind && r.status === "SUCCESS")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return rows.length ? clone(rows[0]!) : null;
  }

  async listSyncLog(userId: string, limit = 50): Promise<SyncLogRow[]> {
    return clone(
      [...this.bucket(userId).syncLog]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit),
    );
  }

  async markChannelSufficiency(
    userId: string,
    sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA",
  ): Promise<void> {
    await this.saveChannelProfile(userId, { dataSufficiency: sufficiency });
  }
}

export function createMemoryChannelStore(now?: () => string): MemoryChannelStore {
  return new MemoryChannelStore(now);
}
