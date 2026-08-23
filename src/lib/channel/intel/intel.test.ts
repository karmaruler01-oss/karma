import { describe, expect, it } from "vitest";

import { DEFAULT_BRAIN_CONFIG } from "../config";
import { createMemoryChannelStore } from "../store.memory";
import { createNextVideoStrategy } from "../brain.server";
import { EMPTY_METRICS, type ObservedMetrics, type WindowKey } from "../types";
import type { StoredMetrics, StoredVideo } from "../store";
import { buildCohorts } from "./cohorts";
import { detectPatterns } from "./patterns";
import { evaluateExperiment, proposeExperiments, type EvaluableExperiment } from "./experiments";
import { assessDataQuality, buildStrategySummary } from "./strategy";
import { INTEL_LEARNING_CATEGORY } from "./learnings";
import { runBrainCycle } from "./orchestrator.server";

const USER = "user-intel";
const NOW = "2026-03-01T00:00:00.000Z";

function hoursAgo(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3600_000).toISOString();
}

function video(id: string, overrides: Partial<StoredVideo> = {}): StoredVideo {
  return {
    videoId: id,
    projectId: `proj-${id}`,
    title: `Video ${id}`,
    publishedAt: hoursAgo(300),
    durationSeconds: 45,
    shortForm: true,
    genre: "mystery",
    structure: "hook-body-payoff",
    narrationStyle: "cinematic",
    hookText: "hook",
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

/** Six comparable videos: three with a question title clearly outperforming. */
function seedChannel() {
  const videos: StoredVideo[] = [];
  const rows: StoredMetrics[] = [];
  for (let i = 0; i < 6; i += 1) {
    const question = i < 3;
    const id = `v${i}`;
    videos.push(
      video(id, {
        title: question ? `Why did this happen ${i}?` : `Plain story ${i}`,
        publishedAt: hoursAgo(300 + i * 24),
      }),
    );
    rows.push(
      metrics(id, "24h", {
        views: question ? 4000 : 800,
        impressions: 20_000,
        impressionCtr: 6,
        averageViewPercentage: 55,
        likes: 100,
      }),
    );
  }
  return { videos, metrics: rows };
}

function store() {
  return createMemoryChannelStore(() => NOW);
}

describe("assessDataQuality", () => {
  it("reports INSUFFICIENT_DATA and names what is missing instead of guessing", () => {
    const report = assessDataQuality({
      videos: [],
      unusableVideoIds: ["ghost"],
      lastSyncedAt: null,
      now: NOW,
      config: DEFAULT_BRAIN_CONFIG,
    });
    expect(report.videosWithMetrics).toBe(0);
    expect(report.smallSample).toBe(true);
    expect(report.lastObservationAt).toBeNull();
    expect(report.notes.join(" ")).toContain("No videos have been synced");
    expect(report.notes.join(" ")).toContain("no publish date");
  });

  it("flags stale data when the last observation is older than the threshold", () => {
    const report = assessDataQuality({
      videos: [],
      unusableVideoIds: [],
      lastSyncedAt: hoursAgo(24 * 40),
      now: NOW,
      config: DEFAULT_BRAIN_CONFIG,
    });
    expect(report.staleData).toBe(true);
  });
});

describe("proposeExperiments", () => {
  it("only proposes a baseline-building test while the sample is too small", () => {
    const quality = assessDataQuality({
      videos: [],
      unusableVideoIds: [],
      lastSyncedAt: NOW,
      now: NOW,
      config: DEFAULT_BRAIN_CONFIG,
    });
    const plans = proposeExperiments({
      learnings: [],
      findings: [],
      cohorts: [],
      quality,
      windowKey: "24h",
      config: DEFAULT_BRAIN_CONFIG,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.key).toBe("EXP:BASELINE");
    expect(plans[0]!.baselineMedianViews).toBeNull();
    expect(plans[0]!.baselineDescription).toContain("INSUFFICIENT_DATA");
  });

  it("names a single variable and a measured baseline once evidence exists", () => {
    const seed = seedChannel();
    const facts = seed.videos.map((v) => ({
      videoId: v.videoId,
      projectId: v.projectId,
      title: v.title,
      publishedAt: v.publishedAt!,
      durationSeconds: v.durationSeconds,
      genre: v.genre,
      structure: v.structure,
      narrationStyle: v.narrationStyle,
      hookText: v.hookText,
      shortForm: v.shortForm,
      metrics: {
        "24h": seed.metrics.find((m) => m.videoId === v.videoId)!.metrics,
      },
    }));
    const cohorts = buildCohorts(facts, "24h", DEFAULT_BRAIN_CONFIG);
    const findings = detectPatterns(facts, "24h", DEFAULT_BRAIN_CONFIG, NOW);
    const quality = assessDataQuality({
      videos: facts,
      unusableVideoIds: [],
      lastSyncedAt: NOW,
      now: NOW,
      config: DEFAULT_BRAIN_CONFIG,
    });
    const plans = proposeExperiments({
      learnings: [],
      findings,
      cohorts,
      quality,
      windowKey: "24h",
      config: DEFAULT_BRAIN_CONFIG,
    });
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0]!.variable).toBeTruthy();
    expect(plans[0]!.baselineMedianViews).not.toBeNull();
    expect(plans[0]!.successCriteria).toContain("median");
  });
});

describe("evaluateExperiment", () => {
  const experiment: EvaluableExperiment = {
    id: "exp-1",
    key: "EXP:TITLE:question",
    hypothesis: "Question titles raise views",
    whatChanged: "Used a question title",
    variable: "TITLE:question",
    status: "PROPOSED",
    baselineMedianViews: 1000,
    targetMetric: "views (24h window)",
    successCriteria: "Beat 1000 views",
    testPeriodWindow: "24h",
    startedAt: hoursAgo(500),
  };

  it("refuses a verdict when no upload followed the change", () => {
    const result = evaluateExperiment(experiment, [], DEFAULT_BRAIN_CONFIG);
    expect(result.status).toBe("PROPOSED");
    expect(result.conclusion).toContain("INSUFFICIENT_DATA");
  });

  it("reports movement but no conclusion below the sample threshold", () => {
    const facts = [
      {
        videoId: "n1",
        projectId: null,
        title: "New",
        publishedAt: hoursAgo(100),
        durationSeconds: 45,
        genre: "mystery",
        structure: null,
        narrationStyle: null,
        hookText: null,
        shortForm: true,
        metrics: { "24h": { ...EMPTY_METRICS, views: 5000 } },
      },
    ];
    const result = evaluateExperiment(experiment, facts, DEFAULT_BRAIN_CONFIG);
    expect(result.status).toBe("ACTIVE");
    expect(result.conclusion).toContain("no conclusion is drawn");
  });

  it("concludes association, never causation, once enough uploads exist", () => {
    const facts = [0, 1, 2].map((i) => ({
      videoId: `n${i}`,
      projectId: null,
      title: `New ${i}`,
      publishedAt: hoursAgo(100 - i),
      durationSeconds: 45,
      genre: "mystery",
      structure: null,
      narrationStyle: null,
      hookText: null,
      shortForm: true,
      metrics: { "24h": { ...EMPTY_METRICS, views: 5000 } },
    }));
    const result = evaluateExperiment(experiment, facts, DEFAULT_BRAIN_CONFIG);
    expect(result.status).toBe("COMPLETED");
    expect(result.conclusion).toContain("not proven causation");
  });

  it("marks a change that lost views as REJECTED", () => {
    const facts = [0, 1, 2].map((i) => ({
      videoId: `n${i}`,
      projectId: null,
      title: `New ${i}`,
      publishedAt: hoursAgo(100 - i),
      durationSeconds: 45,
      genre: "mystery",
      structure: null,
      narrationStyle: null,
      hookText: null,
      shortForm: true,
      metrics: { "24h": { ...EMPTY_METRICS, views: 200 } },
    }));
    const result = evaluateExperiment(experiment, facts, DEFAULT_BRAIN_CONFIG);
    expect(result.status).toBe("REJECTED");
  });
});

describe("buildStrategySummary", () => {
  it("states INSUFFICIENT_DATA as the first priority when evidence is missing", () => {
    const quality = assessDataQuality({
      videos: [],
      unusableVideoIds: [],
      lastSyncedAt: NOW,
      now: NOW,
      config: DEFAULT_BRAIN_CONFIG,
    });
    const summary = buildStrategySummary({
      now: NOW,
      diagnoses: [],
      findings: [],
      learnings: [],
      experiments: [],
      quality,
      windowKey: null,
    });
    expect(summary.sufficiency).toBe("INSUFFICIENT_DATA");
    expect(summary.priorities[0]).toContain("INSUFFICIENT_DATA");
    expect(summary.confirmedLearnings).toEqual([]);
  });
});

describe("runBrainCycle", () => {
  it("says SYNC_REQUIRED for an empty channel instead of inventing findings", async () => {
    const result = await runBrainCycle(USER, { store: store(), now: NOW });
    expect(result.summary.status).toBe("SYNC_REQUIRED");
    expect(result.summary.strongestFindings).toEqual([]);
    expect(result.summary.confidenceScore).toBe(0);
    expect(result.summary.dataQuality.notes.length).toBeGreaterThan(0);
  });

  it("derives findings, learnings and experiments from real observations", async () => {
    const s = store();
    const seed = seedChannel();
    s.seed(USER, { videos: seed.videos, metrics: seed.metrics });
    await createNextVideoStrategy(USER, { store: s, now: NOW });

    const result = await runBrainCycle(USER, { store: s, now: NOW });
    expect(result.summary.status).toBe("READY");
    expect(result.summary.videosWithMetrics).toBe(6);
    expect(result.summary.strongestFindings.length).toBeGreaterThan(0);
    expect(result.summary.learnings.length).toBeGreaterThan(0);
    expect(result.persisted.experimentsCreated).toBeGreaterThan(0);

    const rows = await s.listLearningRows(USER);
    expect(rows.some((row) => row.category === INTEL_LEARNING_CATEGORY)).toBe(true);

    const strategy = await s.latestStrategy(USER);
    expect(strategy?.intelligence?.status).toBe("READY");
    expect(strategy?.version).toBe(1);
  });

  it("is idempotent: a second run adds no duplicate learnings or experiments", async () => {
    const s = store();
    const seed = seedChannel();
    s.seed(USER, { videos: seed.videos, metrics: seed.metrics });
    await createNextVideoStrategy(USER, { store: s, now: NOW });

    const first = await runBrainCycle(USER, { store: s, now: NOW });
    const learningsAfterFirst = (await s.listLearningRows(USER)).filter(
      (row) => row.category === INTEL_LEARNING_CATEGORY,
    );
    const experimentsAfterFirst = await s.listExperiments(USER);

    const second = await runBrainCycle(USER, { store: s, now: NOW });
    const learningsAfterSecond = (await s.listLearningRows(USER)).filter(
      (row) => row.category === INTEL_LEARNING_CATEGORY,
    );
    const experimentsAfterSecond = await s.listExperiments(USER);

    expect(learningsAfterSecond.length).toBe(learningsAfterFirst.length);
    expect(experimentsAfterSecond.length).toBe(experimentsAfterFirst.length);
    expect(second.persisted.experimentsCreated).toBe(0);
    // Occurrence counters are evidence-driven: unchanged evidence, same counts.
    expect(second.summary.learnings.map((l) => l.occurrences)).toEqual(
      first.summary.learnings.map((l) => l.occurrences),
    );
    const strategies = await s.latestStrategy(USER);
    expect(strategies?.version).toBe(1);
  });

  it("never reports a confidence above LOW while the sample is small", async () => {
    const s = store();
    s.seed(USER, {
      videos: [video("only")],
      metrics: [metrics("only", "24h", { views: 100 })],
    });
    const result = await runBrainCycle(USER, { store: s, now: NOW });
    expect(result.summary.status).toBe("INSUFFICIENT_DATA");
    expect(result.summary.confidence).toBe("LOW");
    expect(result.summary.strategySummary.sufficiency).toBe("INSUFFICIENT_DATA");
  });
});
