// Channel AI Brain — persistence layer.
//
// The pure algorithms in brain.ts are the single source of truth for every
// judgement made here. This module only:
//   1. loads real observations through the ChannelStore contract,
//   2. shapes them into the VideoFacts the algorithms expect,
//   3. calls the existing algorithms (never re-implements them), and
//   4. persists the results idempotently.
//
// Rules that are never broken:
//   * 0 means an observed zero, NULL means "not available" — nothing is
//     back-filled, defaulted, or invented.
//   * every persisting entry point is safe to run repeatedly.

import {
  analyzeChannelFacts,
  analyzeVideoFacts,
  computeBaselines,
  detectStalled,
  detectWeakPatterns,
  detectZeroViews,
  selectWindow,
  toLearningEntry,
  buildNextVideoStrategy,
  median,
  type ChannelAnalysisResult,
  type ModeDecision,
  type WindowSelection,
  type ZeroViewDetection,
} from "./brain";
import { resolveBrainConfig, type BrainConfig, type BrainConfigOverrides } from "./config";
import {
  LEARNING_LESSON_CATEGORY,
  LEARNING_REPORT_CATEGORY,
  LEARNING_STRENGTH_CATEGORY,
  LEARNING_WEAK_PATTERN_CATEGORY,
  confidenceScore,
  learningEntryToRow,
  reportToLearningRow,
  rowToLearningEntry,
  type ChannelStore,
  type LearningRow,
  type StoredChannelProfile,
  type StoredMetrics,
  type StoredStrategy,
  type StoredVideo,
} from "./store";
import type {
  BaselineStats,
  Confidence,
  Evidence,
  LearningMemoryEntry,
  NextVideoStrategy,
  ObservedMetrics,
  StallDetection,
  VideoFacts,
  VideoOptimizationReport,
  WeakPattern,
} from "./types";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ChannelBrainDeps {
  /** Defaults to the Lovable Cloud store; tests inject MemoryChannelStore. */
  store?: ChannelStore;
  /** Fixed clock for deterministic tests. */
  now?: Date | string;
  config?: BrainConfigOverrides | null;
}

interface ResolvedDeps {
  store: ChannelStore;
  now: string;
  config: BrainConfig;
}

async function resolve(deps?: ChannelBrainDeps): Promise<ResolvedDeps> {
  const now =
    deps?.now === undefined
      ? new Date().toISOString()
      : typeof deps.now === "string"
        ? deps.now
        : deps.now.toISOString();
  let store = deps?.store;
  if (!store) {
    const { createSupabaseChannelStore } = await import("./store.supabase");
    store = createSupabaseChannelStore();
  }
  return { store, now, config: resolveBrainConfig(deps?.config ?? null) };
}

// ---------------------------------------------------------------------------
// Fact shaping (no invention)
// ---------------------------------------------------------------------------

export interface FactsBundle {
  facts: VideoFacts[];
  /** Videos that cannot be judged at all (no publish date recorded). */
  unusableVideoIds: string[];
  byId: Map<string, VideoFacts>;
}

export function buildFacts(videos: StoredVideo[], metrics: StoredMetrics[]): FactsBundle {
  const metricsByVideo = new Map<string, Partial<Record<StoredMetrics["windowKey"], ObservedMetrics>>>();
  for (const row of metrics) {
    const bucket = metricsByVideo.get(row.videoId) ?? {};
    // Stored exactly as observed: nulls stay null, zeros stay zero.
    bucket[row.windowKey] = row.metrics;
    metricsByVideo.set(row.videoId, bucket);
  }

  const facts: VideoFacts[] = [];
  const unusableVideoIds: string[] = [];
  for (const video of videos) {
    if (!video.publishedAt) {
      // A missing publish date cannot be guessed; age-aware windows would lie.
      unusableVideoIds.push(video.videoId);
      continue;
    }
    facts.push({
      videoId: video.videoId,
      projectId: video.projectId,
      title: video.title,
      publishedAt: video.publishedAt,
      durationSeconds: video.durationSeconds,
      genre: video.genre,
      structure: video.structure,
      narrationStyle: video.narrationStyle,
      hookText: video.hookText,
      shortForm: video.shortForm,
      metrics: metricsByVideo.get(video.videoId) ?? {},
    });
  }
  const byId = new Map(facts.map((f) => [f.videoId, f]));
  return { facts, unusableVideoIds, byId };
}

async function loadFacts(store: ChannelStore, userId: string): Promise<FactsBundle> {
  const [videos, metrics] = await Promise.all([store.listVideos(userId), store.listMetrics(userId)]);
  return buildFacts(videos, metrics);
}

async function loadStoredLearnings(
  store: ChannelStore,
  userId: string,
): Promise<LearningMemoryEntry[]> {
  const rows = await store.listLearningRows(userId);
  return rows
    .map((row) => rowToLearningEntry(row))
    .filter((entry): entry is LearningMemoryEntry => entry !== null);
}

function projectIdOf(facts: FactsBundle, videoId: string): string | null {
  return facts.byId.get(videoId)?.projectId ?? null;
}

// ---------------------------------------------------------------------------
// analyzeVideoPerformance
// ---------------------------------------------------------------------------

export interface VideoPerformanceResult {
  videoId: string;
  found: boolean;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  window: WindowSelection | null;
  observedMetrics: ObservedMetrics | null;
  baselinesUsed: BaselineStats[];
  zeroViews: ZeroViewDetection | null;
  stall: StallDetection | null;
  report: VideoOptimizationReport | null;
  learning: LearningMemoryEntry | null;
  persistedRows: number;
}

/**
 * load video → load metrics → load relevant baselines → age-aware window →
 * existing Brain algorithms → optimization report → persist learning.
 */
export async function analyzeVideoPerformance(
  userId: string,
  videoId: string,
  deps?: ChannelBrainDeps,
): Promise<VideoPerformanceResult> {
  const { store, now, config } = await resolve(deps);
  const bundle = await loadFacts(store, userId);
  const facts = bundle.byId.get(videoId);

  if (!facts) {
    return {
      videoId,
      found: false,
      sufficiency: "INSUFFICIENT_DATA",
      window: null,
      observedMetrics: null,
      baselinesUsed: [],
      zeroViews: null,
      stall: null,
      report: null,
      learning: null,
      persistedRows: 0,
    };
  }

  // Baselines are recomputed from the channel's own comparable windows, so a
  // new video is never measured against an old video's lifetime numbers.
  const baselines = computeBaselines(bundle.facts, config);
  const selection = selectWindow(facts, now, config);
  const observedMetrics = selection.windowKey ? (facts.metrics[selection.windowKey] ?? null) : null;
  const zeroViews = detectZeroViews(observedMetrics, selection);
  const stall = detectStalled(facts, baselines, now, config);
  const report = analyzeVideoFacts(facts, baselines, now, config);
  const learning = toLearningEntry(report, now);

  const relevant = baselines.filter(
    (b) =>
      b.windowKey === selection.windowKey &&
      (b.cohort === "all" || (facts.genre ? b.cohort === `genre:${facts.genre}` : false)),
  );

  const projectId = facts.projectId ?? null;
  const rows: LearningRow[] = [reportToLearningRow(report, now, projectId)];
  if (learning) rows.push(learningEntryToRow(learning, projectId, LEARNING_LESSON_CATEGORY));

  // Idempotent: replaces this video's own report/lesson rows every run.
  const persistedRows = await store.replaceLearningRows(
    userId,
    videoId,
    [LEARNING_REPORT_CATEGORY, LEARNING_LESSON_CATEGORY],
    rows,
  );

  return {
    videoId,
    found: true,
    sufficiency: report.performanceState === "INSUFFICIENT_DATA" ? "INSUFFICIENT_DATA" : "SUFFICIENT",
    window: selection,
    observedMetrics,
    baselinesUsed: relevant,
    zeroViews,
    stall,
    report,
    learning,
    persistedRows,
  };
}

// ---------------------------------------------------------------------------
// analyzeChannel
// ---------------------------------------------------------------------------

export interface ChannelAnalysisPersisted {
  analysis: ChannelAnalysisResult;
  profile: StoredChannelProfile | null;
  /** Weak patterns that crossed the repeat threshold. */
  repeatedWeakPatterns: WeakPattern[];
  strongPatterns: string[];
  weakPatternLabels: string[];
  stalledVideoInfluence: string[];
  unusableVideoIds: string[];
  usAudience: UsAudienceEvidence;
  persisted: { baselines: number; learningRows: number };
}

export async function analyzeChannel(
  userId: string,
  deps?: ChannelBrainDeps,
): Promise<ChannelAnalysisPersisted> {
  const { store, now, config } = await resolve(deps);
  const bundle = await loadFacts(store, userId);
  const [profile, storedLearnings, defaults] = await Promise.all([
    store.getChannelProfile(userId),
    loadStoredLearnings(store, userId),
    store.channelDefaults(userId),
  ]);

  const analysis = analyzeChannelFacts(
    bundle.facts,
    storedLearnings,
    now,
    config,
    defaults.explorationRatio,
  );

  const strongPatterns = [...new Set(analysis.reports.flatMap((r) => r.strengths))];
  const repeatedWeakPatterns = analysis.weakPatterns.filter(
    (p) => p.occurrences >= config.repeatedWeakPatternThreshold,
  );
  const stalledVideoInfluence = analysis.reports
    .filter((r) => analysis.stalledVideoIds.includes(r.videoId))
    .map((r) => `${r.videoId}: ${r.distribution.case}`);

  const baselineCount = await store.saveBaselines(userId, analysis.baselines);
  const learningRows = await persistChannelPatterns(
    store,
    userId,
    now,
    analysis.weakPatterns,
    strongPatterns,
  );
  await store.markChannelSufficiency(userId, analysis.sufficiency);

  return {
    analysis,
    profile,
    repeatedWeakPatterns,
    strongPatterns,
    weakPatternLabels: analysis.weakPatterns.map((p) => p.label),
    stalledVideoInfluence,
    unusableVideoIds: bundle.unusableVideoIds,
    usAudience: usAudienceEvidence(profile, bundle.facts),
    persisted: { baselines: baselineCount, learningRows },
  };
}

/** Channel-level pattern rows are keyed to videoId = null and always replaced. */
async function persistChannelPatterns(
  store: ChannelStore,
  userId: string,
  now: string,
  weakPatterns: WeakPattern[],
  strongPatterns: string[],
): Promise<number> {
  const rows: LearningRow[] = [
    ...weakPatterns.map<LearningRow>((pattern) => ({
      category: LEARNING_WEAK_PATTERN_CATEGORY,
      statement: pattern.lesson,
      state: "WEAK_PATTERN",
      confidence: confidenceScore(patternConfidence(pattern)),
      evidence: {
        key: pattern.key,
        label: pattern.label,
        occurrences: pattern.occurrences,
        lastSeenAt: pattern.lastSeenAt,
      },
      source: "channel_brain",
      videoId: null,
      projectId: null,
      observedAt: now,
    })),
    ...strongPatterns.map<LearningRow>((statement) => ({
      category: LEARNING_STRENGTH_CATEGORY,
      statement,
      state: "POSITIVE_PATTERN",
      confidence: confidenceScore("MEDIUM"),
      evidence: { observedAt: now },
      source: "channel_brain",
      videoId: null,
      projectId: null,
      observedAt: now,
    })),
  ];

  return store.replaceLearningRows(
    userId,
    null,
    [LEARNING_WEAK_PATTERN_CATEGORY, LEARNING_STRENGTH_CATEGORY],
    rows,
  );
}

function patternConfidence(pattern: WeakPattern): Confidence {
  if (pattern.occurrences >= 5) return "HIGH";
  if (pattern.occurrences >= 3) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// recalculateChannelBaseline
// ---------------------------------------------------------------------------

export interface BaselineResult {
  baselines: BaselineStats[];
  persisted: number;
  sufficientWindows: string[];
}

/**
 * Recomputes the 24h / 48h / 7d / 28d baselines with the existing
 * computeBaselines() implementation and persists them. Only window-vs-window
 * comparisons are ever produced, so a new video is never measured against an
 * older video's lifetime totals.
 */
export async function recalculateChannelBaseline(
  userId: string,
  deps?: ChannelBrainDeps,
): Promise<BaselineResult> {
  const { store, config } = await resolve(deps);
  const bundle = await loadFacts(store, userId);
  const baselines = computeBaselines(bundle.facts, config);
  const persisted = await store.saveBaselines(userId, baselines);
  return {
    baselines,
    persisted,
    sufficientWindows: baselines
      .filter((b) => b.sufficiency === "SUFFICIENT" && b.cohort === "all")
      .map((b) => b.windowKey),
  };
}

// ---------------------------------------------------------------------------
// updateChannelBrain
// ---------------------------------------------------------------------------

export interface ChannelBrainUpdate {
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  mode: ModeDecision["mode"];
  explorationRatio: number;
  confidence: Confidence;
  learningEntries: LearningMemoryEntry[];
  zeroViewFindings: { videoId: string; case: ZeroViewDetection["case"] }[];
  stalledVideoIds: string[];
  weakPatterns: WeakPattern[];
  strongPatterns: string[];
  recommendedActions: string[];
  experimentIds: string[];
  persisted: { baselines: number; videoLearningRows: number; channelLearningRows: number };
}

/**
 * Persists everything the brain has actually learned from real observations.
 * Running it twice in a row produces the same stored state.
 */
export async function updateChannelBrain(
  userId: string,
  deps?: ChannelBrainDeps,
): Promise<ChannelBrainUpdate> {
  const { store, now, config } = await resolve(deps);
  const bundle = await loadFacts(store, userId);
  const [storedLearnings, defaults] = await Promise.all([
    loadStoredLearnings(store, userId),
    store.channelDefaults(userId),
  ]);

  const analysis = analyzeChannelFacts(
    bundle.facts,
    storedLearnings,
    now,
    config,
    defaults.explorationRatio,
  );

  const baselines = await store.saveBaselines(userId, analysis.baselines);

  // Per-video report + lesson rows, replaced per video ⇒ idempotent.
  let videoLearningRows = 0;
  const zeroViewFindings: ChannelBrainUpdate["zeroViewFindings"] = [];
  for (const report of analysis.reports) {
    const facts = bundle.byId.get(report.videoId);
    const projectId = projectIdOf(bundle, report.videoId);
    const rows: LearningRow[] = [reportToLearningRow(report, now, projectId)];
    const entry = toLearningEntry(report, now);
    if (entry) rows.push(learningEntryToRow(entry, projectId, LEARNING_LESSON_CATEGORY));
    videoLearningRows += await store.replaceLearningRows(
      userId,
      report.videoId,
      [LEARNING_REPORT_CATEGORY, LEARNING_LESSON_CATEGORY],
      rows,
    );

    if (facts) {
      const selection = selectWindow(facts, now, config);
      const metrics = selection.windowKey ? (facts.metrics[selection.windowKey] ?? null) : null;
      const zero = detectZeroViews(metrics, selection);
      // Only a closed observation window is real evidence of zero views.
      if (zero.case === "ZERO_VIEWS_OBSERVED") {
        zeroViewFindings.push({ videoId: report.videoId, case: zero.case });
      }
    }
  }

  const allLearnings = [...storedLearnings, ...analysis.learnings];
  const weakPatterns = detectWeakPatterns(allLearnings, bundle.facts, config);
  const strongPatterns = [...new Set(analysis.reports.flatMap((r) => r.strengths))];
  const channelLearningRows = await persistChannelPatterns(
    store,
    userId,
    now,
    weakPatterns,
    strongPatterns,
  );
  await store.markChannelSufficiency(userId, analysis.sufficiency);

  const recommendedActions = [
    ...new Set(analysis.reports.flatMap((r) => r.recommendedChanges)),
  ];

  // Experiments are deduplicated by (hypothesis, whatChanged) in both stores.
  const experimentIds: string[] = [];
  const strategy = await buildStrategy(store, userId, now, config, analysis, defaults);
  if (strategy.newExperiment) {
    const experiment = await store.saveExperiment(userId, {
      hypothesis: strategy.objective,
      whatChanged: strategy.newExperiment,
      expectedOutcome: null,
      mode: strategy.mode,
      state: strategy.sufficiency === "INSUFFICIENT_DATA" ? "INITIAL_EXPERIMENT" : "NEW_EXPERIMENT",
    });
    experimentIds.push(experiment.id);
  }

  return {
    sufficiency: analysis.sufficiency,
    mode: analysis.mode,
    explorationRatio: analysis.explorationRatio,
    confidence: aggregateConfidence(analysis.reports, analysis.sufficiency),
    learningEntries: analysis.learnings,
    zeroViewFindings,
    stalledVideoIds: analysis.stalledVideoIds,
    weakPatterns,
    strongPatterns,
    recommendedActions,
    experimentIds,
    persisted: { baselines, videoLearningRows, channelLearningRows },
  };
}

function aggregateConfidence(
  reports: VideoOptimizationReport[],
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA",
): Confidence {
  if (sufficiency === "INSUFFICIENT_DATA") return "LOW";
  const high = reports.filter((r) => r.confidence === "HIGH").length;
  if (high >= 3) return "HIGH";
  const medium = reports.filter((r) => r.confidence !== "LOW").length;
  return medium >= 2 ? "MEDIUM" : "LOW";
}

// ---------------------------------------------------------------------------
// Format / duration intelligence
// ---------------------------------------------------------------------------

export type FormatKey = "SHORT" | "SHORT_STORY" | "LONG_FORM";

export interface FormatCandidate {
  key: FormatKey;
  label: string;
  minSeconds: number;
  maxSeconds: number;
  /** Median views measured for this channel's own videos in this band. */
  medianViews: number | null;
  sampleSize: number;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
}

/** Candidate ranges, never permanent rules. */
export const FORMAT_CANDIDATES: readonly Omit<
  FormatCandidate,
  "medianViews" | "sampleSize" | "sufficiency"
>[] = [
  { key: "SHORT", label: "Short (30–60s)", minSeconds: 30, maxSeconds: 60 },
  { key: "SHORT_STORY", label: "Short story (2–5 min)", minSeconds: 120, maxSeconds: 300 },
  { key: "LONG_FORM", label: "Long form (8–15 min)", minSeconds: 480, maxSeconds: 900 },
];

export interface FormatPlan {
  candidates: FormatCandidate[];
  /** Only set when the channel's own data supports it. */
  recommended: FormatKey | null;
  recommendedDurationSeconds: number | null;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  isInitialExperiment: boolean;
  evidence: Evidence[];
}

/**
 * Measures the channel's own formats window-vs-window. With no evidence it
 * returns INSUFFICIENT_DATA and marks the next video as an explicit initial
 * experiment — it never claims a format is proven.
 */
export function planFormat(
  facts: VideoFacts[],
  reports: VideoOptimizationReport[],
  config: BrainConfig,
): FormatPlan {
  const byVideoWindow = new Map(reports.map((r) => [r.videoId, r.performanceWindow]));
  const candidates: FormatCandidate[] = FORMAT_CANDIDATES.map((candidate) => {
    const views: number[] = [];
    for (const video of facts) {
      const duration = video.durationSeconds;
      if (typeof duration !== "number" || !Number.isFinite(duration)) continue;
      if (duration < candidate.minSeconds || duration > candidate.maxSeconds) continue;
      const windowKey = byVideoWindow.get(video.videoId);
      if (!windowKey) continue;
      const metrics = video.metrics[windowKey];
      // 0 is a real observation and is included; null is not.
      if (!metrics || typeof metrics.views !== "number") continue;
      views.push(metrics.views);
    }
    return {
      ...candidate,
      medianViews: median(views),
      sampleSize: views.length,
      sufficiency:
        views.length >= config.minBaselineSample
          ? ("SUFFICIENT" as const)
          : ("INSUFFICIENT_DATA" as const),
    };
  });

  const measured = candidates.filter((c) => c.sufficiency === "SUFFICIENT" && c.medianViews !== null);
  const evidence: Evidence[] = candidates.map((c) => ({
    label: c.label,
    detail:
      c.sampleSize === 0
        ? "No measured videos in this duration band yet."
        : `${c.sampleSize} measured video(s), median ${c.medianViews ?? "INSUFFICIENT_DATA"} views in the comparable window.`,
  }));

  if (!measured.length) {
    return {
      candidates,
      recommended: null,
      recommendedDurationSeconds: null,
      sufficiency: "INSUFFICIENT_DATA",
      isInitialExperiment: true,
      evidence: [
        ...evidence,
        {
          label: "Format",
          detail:
            "No format has enough comparable data on this channel yet; the next video is an explicitly marked initial experiment.",
        },
      ],
    };
  }

  const best = measured.reduce((a, b) => ((b.medianViews ?? 0) > (a.medianViews ?? 0) ? b : a));
  return {
    candidates,
    recommended: best.key,
    recommendedDurationSeconds: Math.round((best.minSeconds + best.maxSeconds) / 2),
    sufficiency: "SUFFICIENT",
    isInitialExperiment: false,
    evidence: [
      ...evidence,
      {
        label: "Format",
        detail: `${best.label} measured best on this channel (median ${best.medianViews} views across ${best.sampleSize} videos).`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// US audience objective
// ---------------------------------------------------------------------------

export interface UsAudienceEvidence {
  objective: string;
  usSharePercent: number | null;
  sampleSize: number;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  evidence: Evidence;
}

/**
 * The configured objective is always "target audience = US". The measured
 * US share is only reported when it was actually synced — never estimated.
 */
export function usAudienceEvidence(
  profile: StoredChannelProfile | null,
  facts: VideoFacts[],
): UsAudienceEvidence {
  const shares: number[] = [];
  for (const video of facts) {
    for (const metrics of Object.values(video.metrics)) {
      if (metrics && typeof metrics.usShare === "number") shares.push(metrics.usShare);
    }
  }
  const fromProfile = (() => {
    const raw = profile?.audienceProfile?.["usShare"];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  })();
  const usSharePercent = fromProfile ?? median(shares);
  const sufficiency = usSharePercent === null ? "INSUFFICIENT_DATA" : "SUFFICIENT";

  return {
    objective: "Target audience: United States.",
    usSharePercent,
    sampleSize: shares.length,
    sufficiency,
    evidence: {
      label: "US audience",
      detail:
        usSharePercent === null
          ? "INSUFFICIENT_DATA — no US audience share has been synced for this channel."
          : `${usSharePercent}% of measured views came from the US (${shares.length || 1} observation(s)).`,
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

async function buildStrategy(
  store: ChannelStore,
  userId: string,
  now: string,
  config: BrainConfig,
  analysis: ChannelAnalysisResult,
  defaults: { durationSeconds: number; genre: string; narrationStyle: string; uploadTime: string },
): Promise<NextVideoStrategy> {
  const productionIndex = await store.productionCount(userId);
  // Source of truth: the pure algorithm. Everything below is additive.
  return buildNextVideoStrategy({
    analysis,
    productionIndex,
    defaults: {
      durationSeconds: defaults.durationSeconds,
      genre: defaults.genre,
      narrationStyle: defaults.narrationStyle,
      uploadTime: defaults.uploadTime,
    },
    config,
  });
}

export interface StrategyResult {
  stored: StoredStrategy;
  strategy: NextVideoStrategy;
  format: FormatPlan;
  usAudience: UsAudienceEvidence;
  created: boolean;
}

export async function createNextVideoStrategy(
  userId: string,
  deps?: ChannelBrainDeps,
): Promise<StrategyResult> {
  const { store, now, config } = await resolve(deps);
  const bundle = await loadFacts(store, userId);
  const [storedLearnings, defaults, profile] = await Promise.all([
    loadStoredLearnings(store, userId),
    store.channelDefaults(userId),
    store.getChannelProfile(userId),
  ]);

  const analysis = analyzeChannelFacts(
    bundle.facts,
    storedLearnings,
    now,
    config,
    defaults.explorationRatio,
  );
  const base = await buildStrategy(store, userId, now, config, analysis, defaults);

  const format = planFormat(bundle.facts, analysis.reports, config);
  const us = usAudienceEvidence(profile, bundle.facts);

  const strategy: NextVideoStrategy = {
    ...base,
    objective: `${base.objective} ${us.objective}`,
    // Only overridden when the channel's own format data supports it.
    recommendedDurationSeconds:
      format.recommendedDurationSeconds ?? base.recommendedDurationSeconds,
    isExperiment: base.isExperiment || format.isInitialExperiment,
    newExperiment:
      base.newExperiment ??
      (format.isInitialExperiment
        ? "INITIAL_EXPERIMENT: no format is proven on this channel yet — publish one deliberate format test and measure it."
        : null),
    flags:
      format.sufficiency === "INSUFFICIENT_DATA" && !base.flags.includes("INSUFFICIENT_DATA")
        ? [...base.flags, "INSUFFICIENT_DATA"]
        : base.flags,
    evidence: [...base.evidence, ...format.evidence, us.evidence],
  };

  const stored = await store.saveStrategy(userId, strategy);
  return { stored, strategy, format, usAudience: us, created: true };
}

/**
 * Returns the persisted active strategy. When none exists yet, one is created
 * from the current real observations (possibly marked INSUFFICIENT_DATA).
 */
export async function getCurrentChannelStrategy(
  userId: string,
  deps?: ChannelBrainDeps,
): Promise<StrategyResult> {
  const { store } = await resolve(deps);
  const existing = await store.latestStrategy(userId);
  if (existing) {
    const bundle = await loadFacts(store, userId);
    const profile = await store.getChannelProfile(userId);
    const { config } = await resolve(deps);
    return {
      stored: existing,
      strategy: existing.strategy,
      format: planFormat(bundle.facts, [], config),
      usAudience: usAudienceEvidence(profile, bundle.facts),
      created: false,
    };
  }
  return createNextVideoStrategy(userId, deps);
}
