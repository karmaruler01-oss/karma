// Channel AI Brain — pure detection + reasoning algorithms.
//
// Rules this file obeys:
//  * It never invents a metric. A missing value stays null and downgrades the
//    verdict to INSUFFICIENT_DATA instead of being guessed.
//  * It never predicts or guarantees views. It only describes what was
//    observed and what to change next.
//  * Comparisons are always window-vs-window against the channel's own median.
//
// Everything here is deterministic and side-effect free so it can be unit
// tested without a database.

import type { BrainConfig } from "./config";
import { DEFAULT_BRAIN_CONFIG } from "./config";
import {
  WINDOW_HOURS,
  WINDOW_KEYS,
  WINDOW_LABEL,
  type BaselineComparison,
  type BaselineStats,
  type BrainMode,
  type ChannelAnalysis,
  type ChannelHealth,
  type Confidence,
  type DistributionAnalysis,
  type Evidence,
  type HealthMetric,
  type HealthState,
  type IssueCode,
  type LearningMemoryEntry,
  type NextVideoStrategy,
  type ObservedMetrics,
  type PerformanceState,
  type RetentionAnalysis,
  type StallDetection,
  type VideoFacts,
  type VideoOptimizationReport,
  type WeakPattern,
  type WindowKey,
} from "./types";

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

export function hoursBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === "string" ? Date.parse(from) : from.getTime();
  const b = typeof to === "string" ? Date.parse(to) : to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / 3_600_000);
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] as number;
  if (low === high) return lowValue;
  const highValue = sorted[high] as number;
  return lowValue + (highValue - lowValue) * (rank - low);
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function evidence(label: string, detail: string): Evidence {
  return { label, detail };
}

// ---------------------------------------------------------------------------
// Age-aware window selection
// ---------------------------------------------------------------------------

export interface WindowSelection {
  windowKey: WindowKey | null;
  /** true when the selected window has fully elapsed for this video. */
  observationComplete: boolean;
  ageHours: number;
  /** every window that has both elapsed and has real metrics attached. */
  availableWindows: WindowKey[];
  reason: string;
}

/**
 * Picks the widest observation window that has actually elapsed for a video
 * AND for which real metrics exist. A 12h-old video gets no window at all —
 * it is too early to judge, not "bad".
 */
export function selectWindow(
  facts: Pick<VideoFacts, "publishedAt" | "metrics">,
  now: Date | string = new Date(),
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): WindowSelection {
  const ageHours = hoursBetween(facts.publishedAt, now);
  const elapsed = WINDOW_KEYS.filter((key) => ageHours >= WINDOW_HOURS[key]);
  const available = elapsed.filter((key) => Boolean(facts.metrics[key]));

  if (ageHours < config.minObservationHours) {
    return {
      windowKey: null,
      observationComplete: false,
      ageHours,
      availableWindows: [],
      reason: `Published ${ageHours.toFixed(1)}h ago; the first ${config.minObservationHours}h observation window has not closed.`,
    };
  }
  if (!available.length) {
    return {
      windowKey: null,
      observationComplete: elapsed.length > 0,
      ageHours,
      availableWindows: [],
      reason: elapsed.length
        ? "Observation window has elapsed but no analytics rows were synced for it."
        : "No observation window has elapsed yet.",
    };
  }
  const windowKey = available[available.length - 1] as WindowKey;
  return {
    windowKey,
    observationComplete: true,
    ageHours,
    availableWindows: available,
    reason: `${WINDOW_LABEL[windowKey]} window closed and analytics are present.`,
  };
}

// ---------------------------------------------------------------------------
// Zero-view detection
// ---------------------------------------------------------------------------

export interface ZeroViewDetection {
  zeroViews: boolean;
  case: "ZERO_VIEWS_OBSERVED" | "ZERO_VIEWS_INSUFFICIENT_DATA" | "HAS_VIEWS" | "INSUFFICIENT_DATA";
  evidence: Evidence[];
}

/**
 * Distinguishes case A (zero views, too early / not measured) from case B
 * (zero views after a closed observation window). A null view count is never
 * treated as zero.
 */
export function detectZeroViews(
  metrics: ObservedMetrics | null | undefined,
  selection: WindowSelection,
): ZeroViewDetection {
  if (!metrics || !isNumber(metrics.views)) {
    return {
      zeroViews: false,
      case: "INSUFFICIENT_DATA",
      evidence: [evidence("Views", "No view count returned by YouTube Analytics for this window.")],
    };
  }
  if (metrics.views > 0) {
    return {
      zeroViews: false,
      case: "HAS_VIEWS",
      evidence: [evidence("Views", `${metrics.views} views observed.`)],
    };
  }
  if (!selection.observationComplete || !selection.windowKey) {
    return {
      zeroViews: true,
      case: "ZERO_VIEWS_INSUFFICIENT_DATA",
      evidence: [
        evidence("Views", "0 views so far."),
        evidence("Age", selection.reason),
      ],
    };
  }
  return {
    zeroViews: true,
    case: "ZERO_VIEWS_OBSERVED",
    evidence: [
      evidence("Views", `0 views after the ${WINDOW_LABEL[selection.windowKey]} window closed.`),
      evidence(
        "Impressions",
        isNumber(metrics.impressions)
          ? `${metrics.impressions} impressions in the same window.`
          : "Impressions not reported for this window.",
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Baseline maths
// ---------------------------------------------------------------------------

export interface BaselineInput {
  videoId: string;
  cohort?: string | null;
  metrics: ObservedMetrics;
}

/** Median-based baseline for one window and one cohort. */
export function computeBaseline(
  windowKey: WindowKey,
  cohort: string,
  rows: BaselineInput[],
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): BaselineStats {
  const views = rows.map((r) => r.metrics.views).filter(isNumber);
  const watch = rows.map((r) => r.metrics.watchTimeMinutes).filter(isNumber);
  const retention = rows.map((r) => r.metrics.averageViewPercentage).filter(isNumber);
  const subs = rows.map((r) => r.metrics.subscribersGained).filter(isNumber);
  const sampleSize = views.length;
  return {
    windowKey,
    cohort,
    sampleSize,
    medianViews: median(views),
    p25Views: percentile(views, 0.25),
    p75Views: percentile(views, 0.75),
    medianWatchTimeMinutes: median(watch),
    medianRetentionPercentage: median(retention),
    medianSubscribersGained: median(subs),
    sufficiency: sampleSize >= config.minBaselineSample ? "SUFFICIENT" : "INSUFFICIENT_DATA",
  };
}

/** Builds "all" plus per-genre cohort baselines for every window with data. */
export function computeBaselines(
  videos: VideoFacts[],
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): BaselineStats[] {
  const out: BaselineStats[] = [];
  for (const windowKey of WINDOW_KEYS) {
    const rows: BaselineInput[] = [];
    for (const video of videos) {
      const metrics = video.metrics[windowKey];
      if (metrics) rows.push({ videoId: video.videoId, cohort: video.genre ?? null, metrics });
    }
    if (!rows.length) continue;
    out.push(computeBaseline(windowKey, "all", rows, config));
    const genres = new Set(rows.map((r) => r.cohort).filter((g): g is string => Boolean(g)));
    for (const genre of genres) {
      out.push(
        computeBaseline(
          windowKey,
          `genre:${genre}`,
          rows.filter((r) => r.cohort === genre),
          config,
        ),
      );
    }
  }
  return out;
}

/** Median comparison for one video against one baseline. */
export function compareToBaseline(
  views: number | null,
  baseline: BaselineStats | null | undefined,
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): BaselineComparison {
  const windowKey = baseline?.windowKey ?? "24h";
  const cohort = baseline?.cohort ?? "all";
  const sampleSize = baseline?.sampleSize ?? 0;
  const medianViews = baseline?.medianViews ?? null;

  if (
    !baseline ||
    baseline.sufficiency === "INSUFFICIENT_DATA" ||
    sampleSize < config.minBaselineSample ||
    !isNumber(medianViews) ||
    medianViews <= 0 ||
    !isNumber(views)
  ) {
    return {
      windowKey,
      cohort,
      sampleSize,
      videoViews: isNumber(views) ? views : null,
      medianViews: isNumber(medianViews) ? medianViews : null,
      ratio: null,
      verdict: "INSUFFICIENT_DATA",
    };
  }

  const ratio = views / medianViews;
  const verdict: BaselineComparison["verdict"] =
    ratio >= config.aboveBaselineRatio
      ? "ABOVE"
      : ratio < config.belowBaselineRatio
        ? "BELOW"
        : "AROUND";
  return { windowKey, cohort, sampleSize, videoViews: views, medianViews, ratio, verdict };
}

// ---------------------------------------------------------------------------
// Stalled-video detection
// ---------------------------------------------------------------------------

/**
 * Configurable stall detection. A video is stalled only when it is old enough,
 * has a closed window with real numbers, and either sits far below the channel
 * median or stopped growing between two consecutive windows.
 */
export function detectStalled(
  facts: VideoFacts,
  baselines: BaselineStats[],
  now: Date | string = new Date(),
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): StallDetection {
  const selection = selectWindow(facts, now, config);
  const metrics = selection.windowKey ? facts.metrics[selection.windowKey] : undefined;
  const notes: Evidence[] = [evidence("Window", selection.reason)];

  if (!selection.windowKey || !metrics) {
    return {
      stalled: false,
      state: selection.ageHours < config.minObservationHours ? "NEW" : "INSUFFICIENT_DATA",
      windowKey: selection.windowKey,
      ageHours: selection.ageHours,
      evidence: notes,
      confidence: "LOW",
    };
  }

  const zero = detectZeroViews(metrics, selection);
  if (zero.case === "ZERO_VIEWS_INSUFFICIENT_DATA") {
    return {
      stalled: false,
      state: "INSUFFICIENT_DATA",
      windowKey: selection.windowKey,
      ageHours: selection.ageHours,
      evidence: [...notes, ...zero.evidence],
      confidence: "LOW",
    };
  }
  if (zero.case === "ZERO_VIEWS_OBSERVED") {
    return {
      stalled: true,
      state: "STALLED",
      windowKey: selection.windowKey,
      ageHours: selection.ageHours,
      evidence: [...notes, ...zero.evidence],
      confidence: "HIGH",
    };
  }
  if (!isNumber(metrics.views)) {
    return {
      stalled: false,
      state: "INSUFFICIENT_DATA",
      windowKey: selection.windowKey,
      ageHours: selection.ageHours,
      evidence: [...notes, evidence("Views", "No view count for the closed window.")],
      confidence: "LOW",
    };
  }

  if (selection.ageHours < config.stallMinAgeHours) {
    return {
      stalled: false,
      state: "TESTING",
      windowKey: selection.windowKey,
      ageHours: selection.ageHours,
      evidence: [
        ...notes,
        evidence(
          "Age",
          `Still inside the ${config.stallMinAgeHours}h observation period; distribution can still change.`,
        ),
      ],
      confidence: "LOW",
    };
  }

  const baseline = baselines.find(
    (b) => b.windowKey === selection.windowKey && b.cohort === "all",
  );
  const comparison = compareToBaseline(metrics.views, baseline, config);
  const reasons: Evidence[] = [...notes];
  let stalled = false;
  let confidence: Confidence = "LOW";

  if (comparison.verdict !== "INSUFFICIENT_DATA" && isNumber(comparison.ratio)) {
    reasons.push(
      evidence(
        "Baseline",
        `${metrics.views} views vs channel median ${comparison.medianViews} (${comparison.ratio.toFixed(2)}x, n=${comparison.sampleSize}).`,
      ),
    );
    if (comparison.ratio < config.stallBaselineRatio) {
      stalled = true;
      confidence = "HIGH";
    }
  } else {
    reasons.push(
      evidence(
        "Baseline",
        `Not enough comparable videos (n=${comparison.sampleSize}) to compare against a median.`,
      ),
    );
  }

  // Window-over-window growth: 24h → 48h → 7d → 28d.
  const growthPair = consecutiveWindowGrowth(facts, selection.availableWindows);
  if (growthPair) {
    reasons.push(
      evidence(
        "Growth",
        `${growthPair.fromViews} views at ${WINDOW_LABEL[growthPair.from]} → ${growthPair.toViews} at ${WINDOW_LABEL[growthPair.to]} (${(growthPair.growth * 100).toFixed(1)}%).`,
      ),
    );
    if (growthPair.growth < config.stallMinWindowGrowthRatio) {
      stalled = true;
      confidence = confidence === "HIGH" ? "HIGH" : "MEDIUM";
    }
  }

  if (!stalled && metrics.views < config.stallAbsoluteViewFloor) {
    reasons.push(
      evidence(
        "Absolute floor",
        `${metrics.views} views is below the configured floor of ${config.stallAbsoluteViewFloor}.`,
      ),
    );
    stalled = true;
    confidence = confidence === "HIGH" ? "HIGH" : "MEDIUM";
  }

  const state: PerformanceState = stalled
    ? "STALLED"
    : comparison.verdict === "BELOW"
      ? "UNDERPERFORMING"
      : comparison.verdict === "INSUFFICIENT_DATA"
        ? "TESTING"
        : "GROWING";

  return {
    stalled,
    state,
    windowKey: selection.windowKey,
    ageHours: selection.ageHours,
    evidence: reasons,
    confidence,
  };
}

interface GrowthPair {
  from: WindowKey;
  to: WindowKey;
  fromViews: number;
  toViews: number;
  growth: number;
}

function consecutiveWindowGrowth(
  facts: VideoFacts,
  available: WindowKey[],
): GrowthPair | null {
  if (available.length < 2) return null;
  const to = available[available.length - 1] as WindowKey;
  const from = available[available.length - 2] as WindowKey;
  const toViews = facts.metrics[to]?.views ?? null;
  const fromViews = facts.metrics[from]?.views ?? null;
  if (!isNumber(toViews) || !isNumber(fromViews) || fromViews <= 0) return null;
  return { from, to, fromViews, toViews, growth: (toViews - fromViews) / fromViews };
}

// ---------------------------------------------------------------------------
// Distribution cases A–F
// ---------------------------------------------------------------------------

export function classifyDistribution(
  facts: VideoFacts,
  baselines: BaselineStats[],
  now: Date | string = new Date(),
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): DistributionAnalysis {
  const selection = selectWindow(facts, now, config);
  const metrics = selection.windowKey ? facts.metrics[selection.windowKey] : undefined;

  if (!selection.windowKey || !metrics) {
    return {
      windowKey: selection.windowKey,
      observationComplete: selection.observationComplete,
      case: "INSUFFICIENT_DATA",
      evidence: [evidence("Window", selection.reason)],
      confidence: "LOW",
    };
  }

  const zero = detectZeroViews(metrics, selection);
  if (zero.case === "ZERO_VIEWS_INSUFFICIENT_DATA") {
    // Case A
    return {
      windowKey: selection.windowKey,
      observationComplete: false,
      case: "ZERO_VIEWS_INSUFFICIENT_DATA",
      evidence: zero.evidence,
      confidence: "LOW",
    };
  }
  if (zero.case === "ZERO_VIEWS_OBSERVED") {
    // Case B
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "ZERO_VIEWS_OBSERVED",
      evidence: zero.evidence,
      confidence: "HIGH",
    };
  }
  if (zero.case === "INSUFFICIENT_DATA") {
    return {
      windowKey: selection.windowKey,
      observationComplete: selection.observationComplete,
      case: "INSUFFICIENT_DATA",
      evidence: zero.evidence,
      confidence: "LOW",
    };
  }

  const baseline = baselines.find(
    (b) => b.windowKey === selection.windowKey && b.cohort === "all",
  );
  const comparison = compareToBaseline(metrics.views, baseline, config);
  const belowBaseline = comparison.verdict === "BELOW";
  const notes: Evidence[] = [
    evidence("Views", `${metrics.views} views in the ${WINDOW_LABEL[selection.windowKey]} window.`),
  ];
  if (comparison.verdict === "INSUFFICIENT_DATA") {
    notes.push(evidence("Baseline", `Median comparison unavailable (n=${comparison.sampleSize}).`));
  } else if (isNumber(comparison.ratio)) {
    notes.push(
      evidence(
        "Baseline",
        `${comparison.ratio.toFixed(2)}x the channel median of ${comparison.medianViews} (n=${comparison.sampleSize}).`,
      ),
    );
  }

  const impressions = metrics.impressions;
  const ctr = metrics.impressionCtr;
  const retention = metrics.averageViewPercentage;

  // Case C — YouTube barely showed the video to anyone.
  if (isNumber(impressions) && impressions < config.lowImpressions) {
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "LOW_VIEWS_LOW_IMPRESSIONS",
      evidence: [
        ...notes,
        evidence(
          "Impressions",
          `${impressions} impressions is below the configured low-impression threshold of ${config.lowImpressions}.`,
        ),
      ],
      confidence: "MEDIUM",
    };
  }

  // Case D — plenty of impressions, weak click-through.
  if (isNumber(impressions) && impressions >= config.lowImpressions && isNumber(ctr) && ctr < config.weakCtrPercent) {
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "LOW_VIEWS_REASONABLE_IMPRESSIONS",
      evidence: [
        ...notes,
        evidence("Impressions", `${impressions} impressions were served.`),
        evidence("CTR", `${ctr.toFixed(2)}% click-through is below the ${config.weakCtrPercent}% threshold.`),
      ],
      confidence: "MEDIUM",
    };
  }

  // Case E — people clicked but did not stay.
  if (isNumber(retention) && retention < config.weakRetentionPercent) {
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "VIEWS_POOR_RETENTION",
      evidence: [
        ...notes,
        evidence(
          "Retention",
          `${retention.toFixed(1)}% average view percentage is below the ${config.weakRetentionPercent}% threshold.`,
        ),
      ],
      confidence: "MEDIUM",
    };
  }

  // Case F — the content held people, distribution did not scale.
  if (isNumber(retention) && retention >= config.strongRetentionPercent && belowBaseline) {
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "GOOD_RETENTION_WEAK_DISTRIBUTION",
      evidence: [
        ...notes,
        evidence("Retention", `${retention.toFixed(1)}% retention is strong, but reach stayed below the median.`),
      ],
      confidence: "MEDIUM",
    };
  }

  if (comparison.verdict === "INSUFFICIENT_DATA" && !isNumber(impressions) && !isNumber(retention)) {
    return {
      windowKey: selection.windowKey,
      observationComplete: true,
      case: "INSUFFICIENT_DATA",
      evidence: [...notes, evidence("Signals", "No impressions, CTR or retention were reported.")],
      confidence: "LOW",
    };
  }

  return {
    windowKey: selection.windowKey,
    observationComplete: true,
    case: belowBaseline ? "GOOD_RETENTION_WEAK_DISTRIBUTION" : "HEALTHY",
    evidence: notes,
    confidence: comparison.verdict === "INSUFFICIENT_DATA" ? "LOW" : "MEDIUM",
  };
}

export const CASE_ISSUE: Record<DistributionAnalysis["case"], IssueCode> = {
  ZERO_VIEWS_INSUFFICIENT_DATA: "insufficient_data",
  ZERO_VIEWS_OBSERVED: "distribution_problem",
  LOW_VIEWS_LOW_IMPRESSIONS: "distribution_problem",
  LOW_VIEWS_REASONABLE_IMPRESSIONS: "thumbnail_problem",
  VIEWS_POOR_RETENTION: "retention_problem",
  GOOD_RETENTION_WEAK_DISTRIBUTION: "topic_problem",
  HEALTHY: "insufficient_data",
  INSUFFICIENT_DATA: "insufficient_data",
};

const CASE_ACTION: Record<DistributionAnalysis["case"], string> = {
  ZERO_VIEWS_INSUFFICIENT_DATA: "Keep observing — the first measurement window has not closed yet.",
  ZERO_VIEWS_OBSERVED:
    "Treat this as a distribution failure: re-check topic/keyword fit, publish time and metadata before producing more of the same.",
  LOW_VIEWS_LOW_IMPRESSIONS:
    "Impressions were the bottleneck. Change topic framing, title keywords and packaging so the video can enter a larger candidate pool.",
  LOW_VIEWS_REASONABLE_IMPRESSIONS:
    "The video was shown but not clicked. Rework thumbnail contrast/subject and rewrite the title as a sharper curiosity gap.",
  VIEWS_POOR_RETENTION:
    "Viewers left early. Tighten the first 3 seconds, cut setup, and raise the pace of the opening act.",
  GOOD_RETENTION_WEAK_DISTRIBUTION:
    "Retention was fine but reach was not. Keep the story structure and change the topic/packaging so it addresses a larger audience.",
  HEALTHY: "Keep the current pattern and change only one variable in the next video.",
  INSUFFICIENT_DATA: "Not enough measured data to draw a conclusion. Continue syncing analytics.",
};

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export function analyzeRetention(
  metrics: ObservedMetrics | null | undefined,
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): RetentionAnalysis {
  const pct = metrics?.averageViewPercentage ?? null;
  const secs = metrics?.averageViewDurationSeconds ?? null;
  if (!isNumber(pct)) {
    return {
      state: "INSUFFICIENT_DATA",
      averageViewPercentage: null,
      averageViewDurationSeconds: isNumber(secs) ? secs : null,
      evidence: [evidence("Retention", "Average view percentage was not reported for this window.")],
    };
  }
  const state =
    pct >= config.strongRetentionPercent
      ? "STRONG"
      : pct < config.weakRetentionPercent
        ? "WEAK"
        : "AVERAGE";
  return {
    state,
    averageViewPercentage: pct,
    averageViewDurationSeconds: isNumber(secs) ? secs : null,
    evidence: [
      evidence("Retention", `${pct.toFixed(1)}% average view percentage.`),
      ...(isNumber(secs) ? [evidence("Watch length", `${secs.toFixed(0)}s average view duration.`)] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Per-video analysis
// ---------------------------------------------------------------------------

export function analyzeVideoFacts(
  facts: VideoFacts,
  baselines: BaselineStats[],
  now: Date | string = new Date(),
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): VideoOptimizationReport {
  const selection = selectWindow(facts, now, config);
  const metrics = selection.windowKey ? (facts.metrics[selection.windowKey] ?? null) : null;
  const stall = detectStalled(facts, baselines, now, config);
  const distribution = classifyDistribution(facts, baselines, now, config);
  const retention = analyzeRetention(metrics, config);

  const comparisons: BaselineComparison[] = [];
  if (selection.windowKey) {
    const all = baselines.find((b) => b.windowKey === selection.windowKey && b.cohort === "all");
    comparisons.push(compareToBaseline(metrics?.views ?? null, all, config));
    if (facts.genre) {
      const cohort = baselines.find(
        (b) => b.windowKey === selection.windowKey && b.cohort === `genre:${facts.genre}`,
      );
      if (cohort) comparisons.push(compareToBaseline(metrics?.views ?? null, cohort, config));
    }
  }

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (retention.state === "STRONG") strengths.push("Strong retention — the story held viewers.");
  if (retention.state === "WEAK") weaknesses.push("Weak retention — viewers dropped early.");
  const primary = comparisons[0];
  if (primary?.verdict === "ABOVE") strengths.push("Reach above the channel median for this window.");
  if (primary?.verdict === "BELOW") weaknesses.push("Reach below the channel median for this window.");
  if (distribution.case === "LOW_VIEWS_LOW_IMPRESSIONS") weaknesses.push("Impressions were the bottleneck.");
  if (distribution.case === "LOW_VIEWS_REASONABLE_IMPRESSIONS") weaknesses.push("Click-through on title/thumbnail was weak.");

  const performanceState: PerformanceState =
    distribution.case === "INSUFFICIENT_DATA" || distribution.case === "ZERO_VIEWS_INSUFFICIENT_DATA"
      ? selection.ageHours < config.minObservationHours
        ? "NEW"
        : "INSUFFICIENT_DATA"
      : stall.state;

  const issue = CASE_ISSUE[distribution.case];
  const confidence: Confidence =
    distribution.confidence === "HIGH" && stall.confidence === "HIGH"
      ? "HIGH"
      : distribution.case === "INSUFFICIENT_DATA"
        ? "LOW"
        : distribution.confidence;

  const lessons: string[] = [];
  const recommendedChanges: string[] = [CASE_ACTION[distribution.case]];
  if (issue !== "insufficient_data") {
    lessons.push(
      `${WINDOW_LABEL[selection.windowKey ?? "24h"]}: ${distribution.case} → ${issue.replace(/_/g, " ")}.`,
    );
  }

  return {
    videoId: facts.videoId,
    title: facts.title ?? null,
    performanceState,
    performanceWindow: selection.windowKey,
    ageHours: selection.ageHours,
    observedMetrics: metrics,
    historicalComparison: comparisons,
    distribution,
    retention,
    strengths,
    weaknesses,
    lessons,
    recommendedChanges,
    confidence,
    nextExperiment:
      issue === "insufficient_data"
        ? null
        : `Change one variable that addresses ${issue.replace(/_/g, " ")} and re-measure the same window.`,
  };
}

/** Turns a video report into a durable learning-memory entry (or null). */
export function toLearningEntry(
  report: VideoOptimizationReport,
  createdAt: string = new Date().toISOString(),
): LearningMemoryEntry | null {
  const issue = CASE_ISSUE[report.distribution.case];
  if (issue === "insufficient_data") return null;
  return {
    videoId: report.videoId,
    performanceWindow: report.performanceWindow,
    observedMetrics: report.observedMetrics,
    detectedIssue: issue,
    evidence: report.distribution.evidence,
    confidence: report.confidence,
    lesson: report.lessons[0] ?? `${report.distribution.case} observed.`,
    recommendedFutureChange: report.recommendedChanges[0] ?? CASE_ACTION[report.distribution.case],
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Repeated weak patterns
// ---------------------------------------------------------------------------

export function detectWeakPatterns(
  entries: LearningMemoryEntry[],
  videos: VideoFacts[] = [],
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): WeakPattern[] {
  const genreByVideo = new Map<string, string>();
  for (const video of videos) if (video.genre) genreByVideo.set(video.videoId, video.genre);

  const buckets = new Map<string, { label: string; count: number; last: string; lesson: string }>();
  const bump = (key: string, label: string, entry: LearningMemoryEntry) => {
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      if (entry.createdAt > existing.last) {
        existing.last = entry.createdAt;
        existing.lesson = entry.lesson;
      }
      return;
    }
    buckets.set(key, { label, count: 1, last: entry.createdAt, lesson: entry.lesson });
  };

  for (const entry of entries) {
    if (entry.detectedIssue === "insufficient_data") continue;
    bump(`issue:${entry.detectedIssue}`, entry.detectedIssue.replace(/_/g, " "), entry);
    const genre = genreByVideo.get(entry.videoId);
    if (genre) bump(`genre:${genre}`, `${genre} videos`, entry);
  }

  return [...buckets.entries()]
    .filter(([, v]) => v.count >= config.repeatedWeakPatternThreshold)
    .map(([key, v]) => ({
      key,
      label: v.label,
      occurrences: v.count,
      lastSeenAt: v.last,
      lesson: v.lesson,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

// ---------------------------------------------------------------------------
// Mode: exploration / exploitation / recovery
// ---------------------------------------------------------------------------

export interface ModeDecision {
  mode: BrainMode;
  explorationRatio: number;
  reason: string;
}

const WEAK_STATES: PerformanceState[] = ["STALLED", "UNDERPERFORMING"];

export function decideMode(
  reports: VideoOptimizationReport[],
  weakPatterns: WeakPattern[],
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
  explorationRatioOverride?: number | null,
): ModeDecision {
  const conclusive = reports.filter(
    (r) => r.performanceState !== "INSUFFICIENT_DATA" && r.performanceState !== "NEW",
  );
  const baseRatio =
    typeof explorationRatioOverride === "number" && Number.isFinite(explorationRatioOverride)
      ? Math.min(1, Math.max(0, explorationRatioOverride))
      : config.explorationRatio;

  if (conclusive.length < config.minChannelSample) {
    return {
      mode: "EXPLORATION",
      explorationRatio: config.coldStartExplorationRatio,
      reason: `Only ${conclusive.length} conclusively measured videos (need ${config.minChannelSample}); every video is still an experiment.`,
    };
  }

  // Recent-first streak of weak outcomes.
  const recent = [...conclusive].sort((a, b) => b.ageHours - a.ageHours).reverse();
  let streak = 0;
  for (const report of recent) {
    if (WEAK_STATES.includes(report.performanceState)) streak += 1;
    else break;
  }

  if (streak >= config.recoveryConsecutiveWeak) {
    return {
      mode: "RECOVERY_MODE",
      explorationRatio: config.recoveryExplorationRatio,
      reason: `${streak} consecutive weak videos — switching to Recovery Mode and rebuilding the fundamentals.`,
    };
  }
  if (weakPatterns.length) {
    return {
      mode: "EXPLORATION",
      explorationRatio: Math.max(baseRatio, config.recoveryExplorationRatio / 2),
      reason: `Repeated weak pattern detected (${weakPatterns.map((p) => p.label).join(", ")}); increasing exploration.`,
    };
  }
  return {
    mode: "EXPLOITATION",
    explorationRatio: baseRatio,
    reason: "Recent results are stable; repeating what worked and testing one variable at the configured rate.",
  };
}

/**
 * Deterministic exploration scheduling: over a long run of videos exactly
 * `ratio` of them are experiments, and the decision only depends on the index.
 */
export function shouldExplore(index: number, ratio: number): boolean {
  const r = Math.min(1, Math.max(0, ratio));
  if (r <= 0) return false;
  if (r >= 1) return true;
  const i = Math.max(0, Math.floor(index));
  return Math.floor((i + 1) * r) > Math.floor(i * r);
}

// ---------------------------------------------------------------------------
// Channel health + channel analysis
// ---------------------------------------------------------------------------

function healthMetric(
  key: string,
  label: string,
  state: HealthState,
  value: string,
  detail: string,
): HealthMetric {
  return { key, label, state, value, evidence: detail };
}

const INSUFFICIENT = "INSUFFICIENT_DATA";

export function computeChannelHealth(
  reports: VideoOptimizationReport[],
  baselines: BaselineStats[],
  learnings: LearningMemoryEntry[],
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
): ChannelHealth {
  const measured = reports.filter((r) => r.observedMetrics);
  const metrics = measured.map((r) => r.observedMetrics as ObservedMetrics);

  const viewValues = metrics.map((m) => m.views).filter(isNumber);
  const retentionValues = metrics.map((m) => m.averageViewPercentage).filter(isNumber);
  const engagementValues = metrics
    .map((m) => {
      if (!isNumber(m.views) || m.views <= 0) return null;
      const likes = isNumber(m.likes) ? m.likes : 0;
      const comments = isNumber(m.comments) ? m.comments : 0;
      if (!isNumber(m.likes) && !isNumber(m.comments)) return null;
      return ((likes + comments) / m.views) * 100;
    })
    .filter(isNumber);
  const subValues = metrics.map((m) => m.subscribersGained).filter(isNumber);
  const usValues = metrics.map((m) => m.usShare).filter(isNumber);

  const enough = measured.length >= config.minChannelSample;

  const distributionState: HealthState = !enough
    ? INSUFFICIENT
    : reports.filter((r) => r.distribution.case === "LOW_VIEWS_LOW_IMPRESSIONS" || r.distribution.case === "ZERO_VIEWS_OBSERVED").length >
        measured.length / 2
      ? "AT_RISK"
      : reports.some((r) => r.distribution.case === "GOOD_RETENTION_WEAK_DISTRIBUTION")
        ? "WATCH"
        : "HEALTHY";

  const medianRetention = median(retentionValues);
  const retentionState: HealthState = !enough || !isNumber(medianRetention)
    ? INSUFFICIENT
    : medianRetention >= config.strongRetentionPercent
      ? "HEALTHY"
      : medianRetention < config.weakRetentionPercent
        ? "AT_RISK"
        : "WATCH";

  const medianEngagement = median(engagementValues);
  const medianSubs = median(subValues);
  const medianUs = median(usValues);

  return {
    distribution: healthMetric(
      "distribution",
      "Distribution",
      distributionState,
      isNumber(median(viewValues)) ? `${median(viewValues)} median views` : INSUFFICIENT,
      `${measured.length} measured videos.`,
    ),
    retention: healthMetric(
      "retention",
      "Retention",
      retentionState,
      isNumber(medianRetention) ? `${medianRetention.toFixed(1)}%` : INSUFFICIENT,
      isNumber(medianRetention) ? `Median across ${retentionValues.length} videos.` : "Retention not reported.",
    ),
    engagement: healthMetric(
      "engagement",
      "Engagement",
      !enough || !isNumber(medianEngagement) ? INSUFFICIENT : medianEngagement >= 4 ? "HEALTHY" : medianEngagement >= 2 ? "WATCH" : "AT_RISK",
      isNumber(medianEngagement) ? `${medianEngagement.toFixed(2)}%` : INSUFFICIENT,
      isNumber(medianEngagement) ? `Likes + comments per view across ${engagementValues.length} videos.` : "Likes/comments not reported.",
    ),
    subscriberGrowth: healthMetric(
      "subscribers",
      "Subscriber growth",
      !enough || !isNumber(medianSubs) ? INSUFFICIENT : medianSubs > 0 ? "HEALTHY" : "WATCH",
      isNumber(medianSubs) ? `${medianSubs} median gained` : INSUFFICIENT,
      isNumber(medianSubs) ? `Median subscribers gained per video.` : "Subscriber deltas not reported.",
    ),
    usAudienceGrowth: healthMetric(
      "us_audience",
      "US audience",
      !enough || !isNumber(medianUs) ? INSUFFICIENT : medianUs >= 50 ? "HEALTHY" : medianUs >= 25 ? "WATCH" : "AT_RISK",
      isNumber(medianUs) ? `${medianUs.toFixed(1)}% of views` : INSUFFICIENT,
      isNumber(medianUs) ? "Median US share of views." : "Geography breakdown not reported.",
    ),
    learning: healthMetric(
      "learning",
      "Learning memory",
      learnings.length >= config.repeatedWeakPatternThreshold ? "HEALTHY" : learnings.length ? "WATCH" : INSUFFICIENT,
      `${learnings.length} stored lessons`,
      baselines.length ? `${baselines.length} baselines computed.` : "No baselines computed yet.",
    ),
  };
}

export interface ChannelAnalysisResult extends ChannelAnalysis {
  reports: VideoOptimizationReport[];
  learnings: LearningMemoryEntry[];
}

export function analyzeChannelFacts(
  videos: VideoFacts[],
  existingLearnings: LearningMemoryEntry[] = [],
  now: Date | string = new Date(),
  config: BrainConfig = DEFAULT_BRAIN_CONFIG,
  explorationRatioOverride?: number | null,
): ChannelAnalysisResult {
  const generatedAt = typeof now === "string" ? now : now.toISOString();
  const baselines = computeBaselines(videos, config);
  const reports = videos.map((video) => analyzeVideoFacts(video, baselines, now, config));
  const freshLearnings = reports
    .map((report) => toLearningEntry(report, generatedAt))
    .filter((entry): entry is LearningMemoryEntry => entry !== null);
  const allLearnings = [...existingLearnings, ...freshLearnings];
  const weakPatterns = detectWeakPatterns(allLearnings, videos, config);
  const decision = decideMode(reports, weakPatterns, config, explorationRatioOverride);
  const conclusive = reports.filter(
    (r) => r.performanceState !== "INSUFFICIENT_DATA" && r.performanceState !== "NEW",
  );

  return {
    generatedAt,
    videoCount: videos.length,
    analyzedVideos: reports.map((r) => ({
      videoId: r.videoId,
      title: r.title,
      state: r.performanceState,
      windowKey: r.performanceWindow,
      distributionCase: r.distribution.case,
      confidence: r.confidence,
    })),
    baselines,
    health: computeChannelHealth(reports, baselines, allLearnings, config),
    mode: decision.mode,
    explorationRatio: decision.explorationRatio,
    weakPatterns,
    stalledVideoIds: reports.filter((r) => r.performanceState === "STALLED").map((r) => r.videoId),
    sufficiency: conclusive.length >= config.minChannelSample ? "SUFFICIENT" : "INSUFFICIENT_DATA",
    reports,
    learnings: freshLearnings,
  };
}

// ---------------------------------------------------------------------------
// Next-video strategy
// ---------------------------------------------------------------------------

export interface StrategyInputs {
  analysis: ChannelAnalysisResult;
  /** How many videos the channel has already produced through the engine. */
  productionIndex: number;
  /** Channel defaults from settings — never fabricated. */
  defaults: {
    durationSeconds: number;
    genre: string;
    narrationStyle: string;
    uploadTime: string;
  };
  config?: BrainConfig;
}

const ISSUE_TO_CHANGE: Record<IssueCode, string> = {
  distribution_problem: "Rewrite the topic and title around a search/browse-friendly angle so the video can be surfaced at all.",
  topic_problem: "Pick a topic with a visibly larger audience while keeping the story structure that retained viewers.",
  title_problem: "Rewrite the title as a single sharp curiosity gap of under 55 characters.",
  thumbnail_problem: "Rebuild the thumbnail around one high-contrast face or object with at most three words of text.",
  audience_fit_problem: "Refocus the premise on the US audience the channel actually reaches.",
  retention_problem: "Cut the setup: open on the conflict within the first 3 seconds and keep scenes under 4 seconds.",
  timing_problem: "Shift the publish slot to the time band where this channel's own videos historically got their first views.",
  insufficient_data: "Keep the format stable and collect one more measured window before changing anything.",
};

export function buildNextVideoStrategy(inputs: StrategyInputs): NextVideoStrategy {
  const config = inputs.config ?? DEFAULT_BRAIN_CONFIG;
  const { analysis, defaults, productionIndex } = inputs;
  const insufficient = analysis.sufficiency === "INSUFFICIENT_DATA";
  const isExperiment = shouldExplore(productionIndex, analysis.explorationRatio);

  const flags: NextVideoStrategy["flags"] = [];
  if (insufficient) flags.push("INSUFFICIENT_DATA");
  if (analysis.weakPatterns.length) flags.push("REPEATED_WEAK_PATTERN");
  if (analysis.mode === "RECOVERY_MODE") flags.push("RECOVERY_MODE");

  const strengths = [...new Set(analysis.reports.flatMap((r) => r.strengths))];
  const weaknesses = [...new Set(analysis.reports.flatMap((r) => r.weaknesses))];

  const stalledReports = analysis.reports.filter((r) => analysis.stalledVideoIds.includes(r.videoId));
  const stalledInfluence = stalledReports.map(
    (r) =>
      `${r.videoId}: ${r.distribution.case} → ${ISSUE_TO_CHANGE[CASE_ISSUE[r.distribution.case]]}`,
  );

  const dominantIssue: IssueCode = (() => {
    const counts = new Map<IssueCode, number>();
    for (const report of analysis.reports) {
      const issue = CASE_ISSUE[report.distribution.case];
      if (issue === "insufficient_data") continue;
      counts.set(issue, (counts.get(issue) ?? 0) + 1);
    }
    let best: IssueCode = "insufficient_data";
    let bestCount = 0;
    for (const [issue, count] of counts) {
      if (count > bestCount) {
        best = issue;
        bestCount = count;
      }
    }
    return best;
  })();

  const patternsToAvoid = analysis.weakPatterns.map((p) => `${p.label} (seen ${p.occurrences}x): ${p.lesson}`);
  const patternsToRetain = analysis.reports
    .filter((r) => r.performanceState === "GROWING" && r.retention.state !== "WEAK")
    .map((r) => `Keep the structure used in ${r.videoId} (${r.retention.state.toLowerCase()} retention).`);

  const objective = insufficient
    ? "Collect clean, comparable data: keep the format stable and publish consistently until baselines exist."
    : analysis.mode === "RECOVERY_MODE"
      ? "Recovery Mode: rebuild distribution fundamentals before scaling output."
      : isExperiment
        ? "Test exactly one new variable against the existing baseline."
        : "Repeat the pattern that measured best and change nothing else.";

  const evidenceList: Evidence[] = [
    evidence("Mode", `${analysis.mode} at exploration ratio ${analysis.explorationRatio}.`),
    evidence("Sample", `${analysis.videoCount} videos, ${analysis.baselines.length} baselines computed.`),
    ...(insufficient
      ? [evidence("Sufficiency", `Fewer than ${config.minChannelSample} conclusively measured videos.`)]
      : []),
    ...analysis.weakPatterns.map((p) => evidence("Repeated weak pattern", `${p.label} seen ${p.occurrences}x.`)),
  ];

  const recoveryDuration = Math.max(30, Math.min(defaults.durationSeconds, 60));

  return {
    objective,
    mode: analysis.mode,
    explorationRatio: analysis.explorationRatio,
    isExperiment,
    sufficiency: analysis.sufficiency,
    channelBaseline: analysis.baselines,
    knownStrengths: strengths,
    knownWeaknesses: weaknesses,
    patternsToAvoid,
    patternsToRetain,
    newExperiment: isExperiment ? ISSUE_TO_CHANGE[dominantIssue] : null,
    recommendedTopic: insufficient
      ? `Stay inside the ${defaults.genre} lane so the next videos are comparable.`
      : ISSUE_TO_CHANGE[dominantIssue],
    recommendedHook:
      dominantIssue === "retention_problem"
        ? "Open mid-conflict in the first sentence; no scene setting."
        : "Open with a concrete, specific situation the viewer can picture immediately.",
    recommendedDurationSeconds: analysis.mode === "RECOVERY_MODE" ? recoveryDuration : defaults.durationSeconds,
    recommendedStoryStructure:
      dominantIssue === "retention_problem" ? "hook → escalation → twist → payoff (no preamble)" : "hook → setup → escalation → twist",
    recommendedPacing: dominantIssue === "retention_problem" ? "fast (scene changes under 4s)" : "steady",
    recommendedThumbnailDirection:
      dominantIssue === "thumbnail_problem"
        ? "One high-contrast subject, max 3 words, readable at 120px wide."
        : "Keep the current thumbnail language; change only the subject.",
    recommendedTitleDirection:
      dominantIssue === "thumbnail_problem" || dominantIssue === "title_problem"
        ? "Under 55 characters, one curiosity gap, no clickbait promise."
        : "Keep the current title pattern.",
    recommendedNarrationStyle: defaults.narrationStyle,
    recommendedUploadTime: defaults.uploadTime,
    stalledVideoInfluence: stalledInfluence,
    flags,
    evidence: evidenceList,
  };
}
