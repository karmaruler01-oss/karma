// Data-quality reporting + strategy/intelligence summary generation.
//
// The summary is the only thing the UI and the Brain read API ever see, so it
// must be honest by construction:
//   * every number comes from a real observation or is omitted,
//   * "no evidence yet" is reported as INSUFFICIENT_DATA, never as a zero-value
//     finding,
//   * strategy statements are only made from Brain evidence (diagnoses,
//     patterns, learnings, experiments), never from defaults.

import type { BrainConfig } from "../config";
import type { Confidence, ObservedMetrics, VideoFacts, WindowKey } from "../types";
import { levelFromScore } from "./confidence";
import { activeLearnings } from "./learnings";
import type {
  BrainStrategySummary,
  DataQualityReport,
  DiagnosisStatus,
  ExperimentPlan,
  IntelligenceSummary,
  LearningRecord,
  PatternFinding,
  Recommendation,
  StoredExperimentView,
  VideoDiagnosis,
} from "./types";

const TRACKED_FIELDS: (keyof ObservedMetrics)[] = [
  "views",
  "impressions",
  "impressionCtr",
  "watchTimeMinutes",
  "averageViewDurationSeconds",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "usShare",
];

export interface DataQualityInput {
  videos: VideoFacts[];
  unusableVideoIds: string[];
  lastSyncedAt: string | null;
  now: string;
  config: BrainConfig;
}

/** Describes exactly what the Brain could and could not observe. */
export function assessDataQuality(input: DataQualityInput): DataQualityReport {
  const { videos, unusableVideoIds, lastSyncedAt, now, config } = input;

  const withMetrics = videos.filter((video) =>
    Object.values(video.metrics).some(
      (metrics) => metrics && typeof metrics.views === "number",
    ),
  );

  const seenFields = new Set<string>();
  let lastObservationAt: string | null = lastSyncedAt;
  for (const video of videos) {
    for (const metrics of Object.values(video.metrics)) {
      if (!metrics) continue;
      for (const field of TRACKED_FIELDS) {
        if (typeof metrics[field] === "number") seenFields.add(field);
      }
    }
  }
  const unavailableFields = TRACKED_FIELDS.filter((field) => !seenFields.has(field));

  const staleMs = config.staleDataDays * 86_400_000;
  const observedAge =
    lastObservationAt === null ? null : Date.parse(now) - Date.parse(lastObservationAt);
  const staleData =
    observedAge !== null && Number.isFinite(observedAge) && observedAge > staleMs;

  const smallSample = withMetrics.length < config.minChannelSample;

  const notes: string[] = [];
  if (videos.length === 0) notes.push("No videos have been synced yet.");
  if (withMetrics.length === 0 && videos.length > 0) {
    notes.push("Videos are synced but no analytics rows with views exist yet.");
  }
  if (smallSample && withMetrics.length > 0) {
    notes.push(
      `Only ${withMetrics.length} video(s) with analytics — below the ${config.minChannelSample} needed for channel-level conclusions.`,
    );
  }
  if (unusableVideoIds.length) {
    notes.push(
      `${unusableVideoIds.length} video(s) have no publish date and cannot be placed in an observation window.`,
    );
  }
  if (unavailableFields.length) {
    notes.push(`YouTube reported no values for: ${unavailableFields.join(", ")}.`);
  }
  if (staleData) {
    notes.push(
      `Last observation is older than ${config.staleDataDays} days — run a sync before trusting these findings.`,
    );
  }
  if (lastObservationAt === null) notes.push("No successful analytics sync recorded yet.");

  return {
    videosTotal: videos.length,
    videosWithMetrics: withMetrics.length,
    videosWithoutPublishDate: unusableVideoIds.length,
    unavailableFields,
    smallSample,
    staleData,
    lastObservationAt,
    notes,
  };
}

export interface StrategySummaryInput {
  now: string;
  diagnoses: VideoDiagnosis[];
  findings: PatternFinding[];
  learnings: LearningRecord[];
  experiments: StoredExperimentView[];
  quality: DataQualityReport;
  windowKey: WindowKey | null;
}

const EMPTY_COUNTS: Record<DiagnosisStatus, number> = {
  OUTPERFORMING: 0,
  NORMAL: 0,
  UNDERPERFORMING: 0,
  INSUFFICIENT_DATA: 0,
};

function labelsFor(
  findings: PatternFinding[],
  type: PatternFinding["type"],
  direction: PatternFinding["direction"],
): string[] {
  return findings
    .filter((finding) => finding.type === type && finding.direction === direction)
    .map((finding) => finding.observation);
}

/** Strategy statements, each one traceable to Brain evidence. */
export function buildStrategySummary(input: StrategySummaryInput): BrainStrategySummary {
  const { diagnoses, findings, learnings, experiments, quality, now } = input;

  const diagnosisCounts: Record<DiagnosisStatus, number> = { ...EMPTY_COUNTS };
  for (const diagnosis of diagnoses) diagnosisCounts[diagnosis.status] += 1;

  const sufficiency: BrainStrategySummary["sufficiency"] =
    quality.smallSample || quality.videosWithMetrics === 0 ? "INSUFFICIENT_DATA" : "SUFFICIENT";

  const confirmed = learnings.filter((record) => record.status === "CONFIRMED");
  const active = experiments.filter(
    (experiment) => experiment.status === "PROPOSED" || experiment.status === "ACTIVE",
  );

  const priorities: string[] = [];
  if (sufficiency === "INSUFFICIENT_DATA") {
    priorities.push(
      "INSUFFICIENT_DATA — keep publishing and syncing; no channel-level strategy can be justified yet.",
    );
  }
  for (const record of activeLearnings(learnings).slice(0, 3)) {
    priorities.push(
      record.status === "CONFIRMED"
        ? `Apply the confirmed learning: ${record.observation}`
        : `Test the emerging learning: ${record.observation}`,
    );
  }
  for (const experiment of active.slice(0, 2)) {
    priorities.push(`Run the open experiment: ${experiment.whatChanged}`);
  }
  if (diagnosisCounts.UNDERPERFORMING > 0) {
    priorities.push(
      `${diagnosisCounts.UNDERPERFORMING} upload(s) are below their comparable baselines — fix the weakest observed signal first.`,
    );
  }

  return {
    generatedAt: now,
    sufficiency,
    videosAnalyzed: diagnoses.length,
    diagnosisCounts,
    strongestThemes: labelsFor(findings, "TOPIC", "POSITIVE"),
    promisingFormats: labelsFor(findings, "FORMAT", "POSITIVE"),
    weakFormats: labelsFor(findings, "FORMAT", "NEGATIVE"),
    titlePatternsToTest: labelsFor(findings, "TITLE", "POSITIVE").concat(
      labelsFor(findings, "TITLE", "NEGATIVE"),
    ),
    publishingObservations: findings
      .filter((finding) => finding.type === "PUBLISHING")
      .map((finding) => finding.observation),
    audienceSignals: diagnoses
      .flatMap((diagnosis) => diagnosis.positiveSignals)
      .slice(0, 5),
    confirmedLearnings: confirmed.map((record) => record.observation),
    activeExperiments: active.map((experiment) => experiment.hypothesis),
    priorities,
    dataQuality: quality,
  };
}

export interface IntelligenceSummaryInput extends StrategySummaryInput {
  status: IntelligenceSummary["status"];
  strategySummary: BrainStrategySummary;
  recommendations: Recommendation[];
  proposals: ExperimentPlan[];
  lastAnalysisAt: string | null;
}

/** Overall confidence: the evidence actually behind the strongest statements. */
export function summaryConfidence(
  learnings: LearningRecord[],
  diagnoses: VideoDiagnosis[],
  quality: DataQualityReport,
): { confidence: Confidence; score: number } {
  if (quality.smallSample || quality.videosWithMetrics === 0) {
    return { confidence: "LOW", score: 0 };
  }
  const scores = [
    ...activeLearnings(learnings).map((record) => record.confidenceScore),
    ...diagnoses
      .filter((diagnosis) => diagnosis.status !== "INSUFFICIENT_DATA")
      .map((diagnosis) => diagnosis.confidenceScore),
  ];
  if (!scores.length) return { confidence: "LOW", score: 0 };
  const score = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000;
  return { confidence: levelFromScore(score), score };
}

/** The structured payload persisted with the strategy and returned to the UI. */
export function buildIntelligenceSummary(
  input: IntelligenceSummaryInput,
): IntelligenceSummary {
  const { confidence, score } = summaryConfidence(
    input.learnings,
    input.diagnoses,
    input.quality,
  );

  const strongest = [...input.findings]
    .sort((a, b) => b.confidenceScore - a.confidenceScore || Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
    .slice(0, 5)
    .map((finding) => ({
      key: finding.key,
      label: finding.label,
      observation: finding.observation,
      direction: finding.direction,
      sampleSize: finding.sampleSize,
      confidence: finding.confidence,
      confidenceScore: finding.confidenceScore,
    }));

  const experiments = input.experiments
    .filter((experiment) => experiment.status === "PROPOSED" || experiment.status === "ACTIVE")
    .map((experiment) => ({
      key: experiment.key,
      hypothesis: experiment.hypothesis,
      whatChanged: experiment.whatChanged,
      status: experiment.status,
      targetMetric: experiment.targetMetric,
      successCriteria: experiment.successCriteria,
      conclusion: experiment.conclusion,
    }));

  return {
    generatedAt: input.now,
    status: input.status,
    videosAnalyzed: input.diagnoses.length,
    videosWithMetrics: input.quality.videosWithMetrics,
    windowKey: input.windowKey,
    sufficiency: input.strategySummary.sufficiency,
    dataQuality: input.quality,
    strongestFindings: strongest,
    learnings: input.learnings
      .filter((record) => record.status !== "STALE")
      .slice(0, 10)
      .map((record) => ({
        key: record.key,
        observation: record.observation,
        status: record.status,
        direction: record.direction,
        occurrences: record.occurrences,
        sampleSize: record.sampleSize,
        confidence: record.confidence,
        confidenceScore: record.confidenceScore,
      })),
    activeExperiments: experiments,
    proposedExperiments: input.proposals.map((plan) => ({
      key: plan.key,
      hypothesis: plan.hypothesis,
      whatChanged: plan.whatChanged,
      status: plan.status,
      targetMetric: plan.targetMetric,
      successCriteria: plan.successCriteria,
      conclusion: null,
    })),
    strategySummary: input.strategySummary,
    recommendations: input.recommendations,
    confidence,
    confidenceScore: score,
    lastAnalysisAt: input.lastAnalysisAt,
    notes: input.quality.notes,
  };
}
