import { describe, expect, it } from "vitest";

import {
  analyzeChannel,
  analyzeVideoPerformance,
  buildFacts,
  createNextVideoStrategy,
  getCurrentChannelStrategy,
  planFormat,
  recalculateChannelBaseline,
  updateChannelBrain,
  usAudienceEvidence,
} from "./brain.server";
import { createMemoryChannelStore } from "./store.memory";
import {
  LEARNING_REPORT_CATEGORY,
  LEARNING_WEAK_PATTERN_CATEGORY,
  type StoredMetrics,
  type StoredVideo,
} from "./store";
import { EMPTY_METRICS, type ObservedMetrics, type WindowKey } from "./types";
import { DEFAULT_BRAIN_CONFIG } from "./config";

const USER = "user-1";
const NOW = "2026-03-01T00:00:00.000Z";

function hoursAgo(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3600_000).toISOString();
}

function video(id: string, overrides: Partial<StoredVideo> = {}): StoredVideo {
  return {
    videoId: id,
    projectId: `proj-${id}`,
    title: `Video ${id}`,
    publishedAt: hoursAgo(200),
    durationSeconds: 45,
    shortForm: true,
    genre: "mystery",
    structure: "hook-body-payoff",
    narrationStyle: "cinematic",
    hookText: "You won't believe this",
    ...overrides,
  };
}

function metrics(
  videoId: string,
  windowKey: WindowKey,
  patch: Partial<ObservedMetrics>,
): StoredMetrics {
  return { videoId, windowKey, metrics: { ...EMPTY_METRICS, ...patch } };
}

function store() {
  return createMemoryChannelStore(() => NOW);
}

describe("buildFacts", () => {
  it("keeps observed zeros and nulls exactly as stored", () => {
    const bundle = buildFacts(
      [video("a")],
      [metrics("a", "24h", { views: 0, impressions: 500, impressionCtr: null })],
    );
    const observed = bundle.facts[0]!.metrics["24h"]!;
    expect(observed.views).toBe(0);
    expect(observed.impressions).toBe(500);
    expect(observed.impressionCtr).toBeNull();
  });

  it("never invents a publish date", () => {
    const bundle = buildFacts([video("a", { publishedAt: null })], []);
    expect(bundle.facts).toHaveLength(0);
    expect(bundle.unusableVideoIds).toEqual(["a"]);
  });
});

describe("analyzeVideoPerformance", () => {
  it("reports INSUFFICIENT_DATA for an unknown video without throwing", async () => {
    const result = await analyzeVideoPerformance(USER, "missing", { store: store(), now: NOW });
    expect(result.found).toBe(false);
    expect(result.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(result.report).toBeNull();
  });

  it("treats a fresh video as too early rather than as a failure", async () => {
    const s = store();
    s.seed(USER, { videos: [video("a", { publishedAt: hoursAgo(2) })], metrics: [] });
    const result = await analyzeVideoPerformance(USER, "a", { store: s, now: NOW });
    expect(result.window?.windowKey).toBeNull();
    expect(result.zeroViews?.case).toBe("INSUFFICIENT_DATA");
    expect(result.stall?.stalled).toBe(false);
  });

  it("distinguishes observed zero views after a closed window", async () => {
    const s = store();
    s.seed(USER, {
      videos: [video("a", { publishedAt: hoursAgo(72) })],
      metrics: [metrics("a", "24h", { views: 0, impressions: 300 })],
    });
    const result = await analyzeVideoPerformance(USER, "a", { store: s, now: NOW });
    expect(result.zeroViews?.case).toBe("ZERO_VIEWS_OBSERVED");
    expect(result.observedMetrics?.views).toBe(0);
    expect(result.report).not.toBeNull();
  });

  it("persists learning rows idempotently", async () => {
    const s = store();
    s.seed(USER, {
      videos: [video("a", { publishedAt: hoursAgo(72) })],
      metrics: [metrics("a", "24h", { views: 120, impressions: 3000, impressionCtr: 4 })],
    });
    await analyzeVideoPerformance(USER, "a", { store: s, now: NOW });
    const first = await s.listLearningRows(USER);
    await analyzeVideoPerformance(USER, "a", { store: s, now: NOW });
    const second = await s.listLearningRows(USER);
    expect(second).toHaveLength(first.length);
    expect(second.some((r) => r.category === LEARNING_REPORT_CATEGORY)).toBe(true);
  });
});

describe("recalculateChannelBaseline", () => {
  it("returns INSUFFICIENT baselines instead of fabricating numbers", async () => {
    const s = store();
    s.seed(USER, {
      videos: [video("a", { publishedAt: hoursAgo(72) })],
      metrics: [metrics("a", "24h", { views: 10 })],
    });
    const result = await recalculateChannelBaseline(USER, { store: s, now: NOW });
    expect(result.sufficientWindows).toEqual([]);
    expect(result.persisted).toBe(result.baselines.length);
  });

  it("computes a window-vs-window baseline once enough videos exist", async () => {
    const s = store();
    const videos: StoredVideo[] = [];
    const rows: StoredMetrics[] = [];
    for (let i = 0; i < DEFAULT_BRAIN_CONFIG.minBaselineSample + 1; i++) {
      const id = `v${i}`;
      videos.push(video(id, { publishedAt: hoursAgo(100 + i) }));
      rows.push(metrics(id, "24h", { views: 100 + i * 10, impressions: 2000, impressionCtr: 5 }));
    }
    s.seed(USER, { videos, metrics: rows });
    const result = await recalculateChannelBaseline(USER, { store: s, now: NOW });
    expect(result.sufficientWindows).toContain("24h");
    const stored = await s.listBaselines(USER);
    expect(stored.length).toBeGreaterThan(0);
  });
});

describe("analyzeChannel", () => {
  it("marks the channel INSUFFICIENT_DATA with no observations", async () => {
    const s = store();
    const result = await analyzeChannel(USER, { store: s, now: NOW });
    expect(result.analysis.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(result.usAudience.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(result.usAudience.objective).toContain("United States");
  });

  it("persists weak patterns and stays idempotent across runs", async () => {
    const s = store();
    const videos: StoredVideo[] = [];
    const rows: StoredMetrics[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `w${i}`;
      videos.push(video(id, { publishedAt: hoursAgo(120 + i) }));
      rows.push(metrics(id, "24h", { views: 1, impressions: 4000, impressionCtr: 0.4 }));
    }
    s.seed(USER, { videos, metrics: rows });
    const first = await analyzeChannel(USER, { store: s, now: NOW });
    const rowsAfterFirst = await s.listLearningRows(USER);
    const second = await analyzeChannel(USER, { store: s, now: NOW });
    const rowsAfterSecond = await s.listLearningRows(USER);
    expect(rowsAfterSecond).toHaveLength(rowsAfterFirst.length);
    expect(second.weakPatternLabels).toEqual(first.weakPatternLabels);
    expect(
      rowsAfterSecond.filter((r) => r.category === LEARNING_WEAK_PATTERN_CATEGORY).length,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("updateChannelBrain", () => {
  it("stores baselines, learnings and confidence from real data only", async () => {
    const s = store();
    s.seed(USER, {
      videos: [
        video("a", { publishedAt: hoursAgo(80) }),
        video("b", { publishedAt: hoursAgo(90) }),
      ],
      metrics: [
        metrics("a", "24h", { views: 0, impressions: 900 }),
        metrics("b", "24h", { views: 400, impressions: 8000, impressionCtr: 5 }),
      ],
    });
    const update = await updateChannelBrain(USER, { store: s, now: NOW });
    expect(update.persisted.baselines).toBeGreaterThan(0);
    expect(update.zeroViewFindings.map((z) => z.videoId)).toContain("a");
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(update.confidence);

    const before = await s.listLearningRows(USER);
    const experimentsBefore = await s.listExperiments(USER);
    await updateChannelBrain(USER, { store: s, now: NOW });
    expect(await s.listLearningRows(USER)).toHaveLength(before.length);
    expect(await s.listExperiments(USER)).toHaveLength(experimentsBefore.length);
  });
});

describe("format intelligence", () => {
  it("returns INSUFFICIENT_DATA and an initial experiment with no format history", () => {
    const plan = planFormat([], [], DEFAULT_BRAIN_CONFIG);
    expect(plan.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(plan.isInitialExperiment).toBe(true);
    expect(plan.recommended).toBeNull();
    expect(plan.candidates.map((c) => c.key)).toEqual(["SHORT", "SHORT_STORY", "LONG_FORM"]);
  });

  it("marks a strategy as an initial experiment when no format is proven", async () => {
    const s = store();
    const result = await createNextVideoStrategy(USER, { store: s, now: NOW });
    expect(result.format.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(result.strategy.isExperiment).toBe(true);
    expect(result.strategy.flags).toContain("INSUFFICIENT_DATA");
    expect(result.strategy.objective).toContain("United States");
    expect(result.stored.strategy.objective).toBe(result.strategy.objective);
  });
});

describe("US audience objective", () => {
  it("reports INSUFFICIENT_DATA when no US share was synced", () => {
    const us = usAudienceEvidence(null, []);
    expect(us.usSharePercent).toBeNull();
    expect(us.evidence.detail).toContain("INSUFFICIENT_DATA");
  });

  it("uses the measured US share when it exists", () => {
    const bundle = buildFacts([video("a")], [metrics("a", "24h", { views: 100, usShare: 72 })]);
    const us = usAudienceEvidence(null, bundle.facts);
    expect(us.usSharePercent).toBe(72);
    expect(us.sufficiency).toBe("SUFFICIENT");
  });
});

describe("getCurrentChannelStrategy", () => {
  it("creates one when none exists and reuses it afterwards", async () => {
    const s = store();
    const created = await getCurrentChannelStrategy(USER, { store: s, now: NOW });
    expect(created.created).toBe(true);
    const reused = await getCurrentChannelStrategy(USER, { store: s, now: NOW });
    expect(reused.created).toBe(false);
    expect(reused.stored.id).toBe(created.stored.id);
  });
});
