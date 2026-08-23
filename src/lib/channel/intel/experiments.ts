// Experiment proposal + evaluation.
//
// An experiment is a deliberate, single-variable change with a baseline that
// was actually measured on this channel. Rules that are never broken:
//   * a proposal is only made when the Brain can name the variable and the
//     baseline it will be compared against (or explicitly says the baseline is
//     unknown and the experiment only exists to *create* one),
//   * an evaluation never claims causation. With too few post-change videos the
//     verdict stays INCONCLUSIVE / still ACTIVE and says so,
//   * every key is stable across runs so repeated syncs never duplicate work.

import { median } from "../brain";
import type { BrainConfig } from "../config";
import type { VideoFacts, WindowKey } from "../types";
import { activeLearnings } from "./learnings";
import type {
  CohortStats,
  DataQualityReport,
  ExperimentEvaluation,
  ExperimentPlan,
  ExperimentStatus,
  LearningRecord,
  PatternFinding,
} from "./types";

export const EXPERIMENT_KEY_PREFIX = "EXP:";

/** The subset of a stored experiment the pure evaluator needs. */
export interface EvaluableExperiment {
  id: string | null;
  key: string;
  hypothesis: string;
  whatChanged: string;
  variable: string | null;
  status: ExperimentStatus;
  baselineMedianViews: number | null;
  targetMetric: string;
  successCriteria: string;
  testPeriodWindow: WindowKey;
  /** ISO timestamp the experiment was proposed — only later uploads count. */
  startedAt: string;
}

export interface ExperimentContext {
  learnings: LearningRecord[];
  findings: PatternFinding[];
  cohorts: CohortStats[];
  quality: DataQualityReport;
  windowKey: WindowKey;
  config: BrainConfig;
}

function allCohort(cohorts: CohortStats[], windowKey: WindowKey): CohortStats | null {
  return cohorts.find((c) => c.key === "all" && c.windowKey === windowKey) ?? null;
}

function baselineOf(cohorts: CohortStats[], windowKey: WindowKey): number | null {
  const cohort = allCohort(cohorts, windowKey);
  if (!cohort || cohort.sufficiency === "INSUFFICIENT_DATA") return null;
  return cohort.medianViews;
}

function successCriteriaFor(baseline: number | null, config: BrainConfig): string {
  return baseline === null
    ? `No comparable baseline exists yet — this test only creates one. Re-evaluate once ${config.minCohortSample} comparable uploads exist.`
    : `Beat the ${config.patternMinDeltaPercent}% threshold vs the current median of ${Math.round(baseline)} views in the same window.`;
}

/**
 * Proposes at most one experiment per variable, ordered by how much evidence
 * backs the idea. CONFIRMED learnings are not re-tested — they are already
 * acted on by the recommendations layer.
 */
export function proposeExperiments(ctx: ExperimentContext): ExperimentPlan[] {
  const { config, windowKey } = ctx;
  const baseline = baselineOf(ctx.cohorts, windowKey);
  const cohort = allCohort(ctx.cohorts, windowKey);
  const baselineDescription =
    baseline === null
      ? cohort
        ? `INSUFFICIENT_DATA — only ${cohort.sampleSize} comparable video(s) in the ${windowKey} window.`
        : `INSUFFICIENT_DATA — no ${windowKey} observations synced yet.`
      : `Median ${Math.round(baseline)} views across ${cohort?.sampleSize ?? 0} comparable video(s) in the ${windowKey} window.`;

  // Cold start: the only honest experiment is one that creates a baseline.
  if (ctx.quality.smallSample || ctx.quality.videosWithMetrics === 0) {
    return [
      {
        key: `${EXPERIMENT_KEY_PREFIX}BASELINE`,
        hypothesis:
          "The channel has too little comparable data to test anything — publishing consistently will produce a measurable baseline.",
        variable: "baseline",
        whatChanged:
          "Keep the format deliberately consistent for the next uploads so the resulting numbers are comparable.",
        baselineDescription,
        baselineMedianViews: baseline,
        targetMetric: `views (${windowKey} window)`,
        successCriteria: successCriteriaFor(baseline, config),
        testPeriodWindow: windowKey,
        status: "PROPOSED",
        confidence: "LOW",
        confidenceScore: 0,
      },
    ];
  }

  const plans: ExperimentPlan[] = [];
  const usedVariables = new Set<string>();

  // 1. Learnings that are real but not yet proven ⇒ deliberate tests.
  for (const record of activeLearnings(ctx.learnings)) {
    if (record.status === "CONFIRMED") continue;
    if (usedVariables.has(record.key)) continue;
    usedVariables.add(record.key);
    plans.push({
      key: `${EXPERIMENT_KEY_PREFIX}${record.key}`,
      hypothesis:
        record.direction === "POSITIVE"
          ? `Repeating this trait raises views: ${record.observation}`
          : `Removing this trait raises views: ${record.observation}`,
      variable: record.key,
      whatChanged:
        record.direction === "POSITIVE"
          ? `Deliberately apply "${record.key}" on the next upload and change nothing else.`
          : `Deliberately drop "${record.key}" on the next upload and change nothing else.`,
      baselineDescription,
      baselineMedianViews: baseline,
      targetMetric: `views (${windowKey} window)`,
      successCriteria: successCriteriaFor(baseline, config),
      testPeriodWindow: windowKey,
      status: "PROPOSED",
      confidence: record.confidence,
      confidenceScore: record.confidenceScore,
    });
  }

  // 2. Strong single-run findings that have not become learnings yet.
  for (const finding of ctx.findings) {
    if (usedVariables.has(finding.key)) continue;
    if (finding.sampleSize < config.minPatternSample) continue;
    if (Math.abs(finding.deltaPercent) < config.patternMinDeltaPercent) continue;
    usedVariables.add(finding.key);
    plans.push({
      key: `${EXPERIMENT_KEY_PREFIX}${finding.key}`,
      hypothesis: `Observed association, not yet proven: ${finding.observation}`,
      variable: finding.key,
      whatChanged:
        finding.direction === "POSITIVE"
          ? `Apply "${finding.label}" on the next upload as the only intentional change.`
          : `Avoid "${finding.label}" on the next upload as the only intentional change.`,
      baselineDescription,
      baselineMedianViews: baseline,
      targetMetric: `views (${windowKey} window)`,
      successCriteria: successCriteriaFor(baseline, config),
      testPeriodWindow: windowKey,
      status: "PROPOSED",
      confidence: finding.confidence,
      confidenceScore: finding.confidenceScore,
    });
  }

  return plans.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 3);
}

/** Videos published after the experiment started, with views in its window. */
export function experimentSamples(
  experiment: EvaluableExperiment,
  videos: VideoFacts[],
): { videoId: string; views: number }[] {
  const start = Date.parse(experiment.startedAt);
  const out: { videoId: string; views: number }[] = [];
  for (const video of videos) {
    const published = Date.parse(video.publishedAt);
    if (!Number.isFinite(published) || !Number.isFinite(start) || published < start) continue;
    const views = video.metrics[experiment.testPeriodWindow]?.views;
    if (typeof views !== "number") continue;
    out.push({ videoId: video.videoId, views });
  }
  return out;
}

/**
 * Evaluates one experiment against the uploads that happened after it was
 * proposed. Never upgrades an association into a proven cause: the conclusion
 * always states what was measured and how many videos back it.
 */
export function evaluateExperiment(
  experiment: EvaluableExperiment,
  videos: VideoFacts[],
  config: BrainConfig,
): ExperimentEvaluation {
  const samples = experimentSamples(experiment, videos);
  const base = {
    key: experiment.key,
    experimentId: experiment.id,
    sampleSize: samples.length,
  };

  if (samples.length === 0) {
    return {
      ...base,
      status: experiment.status === "PROPOSED" ? "PROPOSED" : "ACTIVE",
      actualOutcome: null,
      conclusion:
        "INSUFFICIENT_DATA — no upload with comparable analytics has been published since this experiment was proposed.",
      confidence: "LOW",
      confidenceScore: 0,
    };
  }

  const observed = median(samples.map((s) => s.views));
  const actualOutcome =
    observed === null
      ? null
      : `Median ${Math.round(observed)} views across ${samples.length} upload(s) published after the change.`;

  if (experiment.baselineMedianViews === null || experiment.baselineMedianViews <= 0) {
    return {
      ...base,
      status: "ACTIVE",
      actualOutcome,
      conclusion:
        "INSUFFICIENT_DATA — there is no measured baseline to compare these uploads against yet.",
      confidence: "LOW",
      confidenceScore: 0,
    };
  }

  if (observed === null) {
    return {
      ...base,
      status: "ACTIVE",
      actualOutcome: null,
      conclusion: "INSUFFICIENT_DATA — no views were reported for the test uploads.",
      confidence: "LOW",
      confidenceScore: 0,
    };
  }

  const deltaPercent =
    Math.round(((observed - experiment.baselineMedianViews) / experiment.baselineMedianViews) * 1000) /
    10;

  // Too few post-change uploads: report the movement, refuse a verdict.
  if (samples.length < config.minCohortSample) {
    return {
      ...base,
      status: "ACTIVE",
      actualOutcome,
      conclusion: `Measured ${deltaPercent > 0 ? "+" : ""}${deltaPercent}% vs baseline, but only ${samples.length} of the ${config.minCohortSample} uploads needed for a verdict — no conclusion is drawn.`,
      confidence: "LOW",
      confidenceScore: 0,
    };
  }

  if (Math.abs(deltaPercent) < config.patternMinDeltaPercent) {
    return {
      ...base,
      status: "INCONCLUSIVE",
      actualOutcome,
      conclusion: `Measured ${deltaPercent > 0 ? "+" : ""}${deltaPercent}% vs baseline across ${samples.length} upload(s) — inside the ${config.patternMinDeltaPercent}% noise threshold, so the change made no observable difference.`,
      confidence: "LOW",
      confidenceScore: 0.25,
    };
  }

  const supported = deltaPercent > 0;
  return {
    ...base,
    status: supported ? "COMPLETED" : "REJECTED",
    actualOutcome,
    conclusion: `${supported ? "Consistent with" : "Contradicts"} the hypothesis: ${deltaPercent > 0 ? "+" : ""}${deltaPercent}% vs the baseline across ${samples.length} upload(s). This is an association measured on this channel, not proven causation.`,
    confidence: samples.length >= config.minCohortSample + 2 ? "MEDIUM" : "LOW",
    confidenceScore: samples.length >= config.minCohortSample + 2 ? 0.6 : 0.35,
  };
}
