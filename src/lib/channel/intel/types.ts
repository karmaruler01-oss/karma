// Intelligence layer — shared, client-safe types.
//
// Everything here describes evidence that was actually observed. A value that
// YouTube did not report stays `null` and is labelled UNAVAILABLE; a value the
// Brain computed from real values is labelled DERIVED. Nothing is invented.

import type { Confidence, Evidence, WindowKey } from "../types";

/** Where a number came from. Displayed in the UI so users can trust it. */
export type Provenance = "REAL" | "DERIVED" | "UNAVAILABLE";

export interface MetricValue {
  value: number | null;
  provenance: Provenance;
  /** Short human explanation, e.g. "likes / views". */
  note?: string;
}

export interface NormalizedMetrics {
  videoId: string;
  windowKey: WindowKey | null;
  publishedAt: string;
  ageHours: number;
  completeness: number; // 0..1 share of API-reported fields present

  // Reported by the YouTube APIs (REAL when present, UNAVAILABLE when not)
  views: MetricValue;
  likes: MetricValue;
  comments: MetricValue;
  shares: MetricValue;
  subscribersGained: MetricValue;
  subscribersLost: MetricValue;
  watchTimeMinutes: MetricValue;
  averageViewDurationSeconds: MetricValue;
  averageViewPercentage: MetricValue;
  impressions: MetricValue;
  impressionCtr: MetricValue;
  durationSeconds: MetricValue;
  usShare: MetricValue;

  // Derived strictly from the values above
  viewsPerHour: MetricValue;
  viewsPerDay: MetricValue;
  engagementRate: MetricValue;
  likeRate: MetricValue;
  commentRate: MetricValue;
  subscriberConversionRate: MetricValue;
}

export type CohortKind = "ALL" | "RECENT" | "FORMAT" | "DURATION" | "TOPIC";

export interface CohortStats {
  key: string;
  kind: CohortKind;
  label: string;
  windowKey: WindowKey;
  sampleSize: number;
  medianViews: number | null;
  meanViews: number | null;
  p25Views: number | null;
  p75Views: number | null;
  medianRetentionPercentage: number | null;
  trend: "RISING" | "FLAT" | "FALLING" | "INSUFFICIENT_DATA";
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  videoIds: string[];
}

export interface CohortComparison {
  cohortKey: string;
  label: string;
  windowKey: WindowKey;
  sampleSize: number;
  videoViews: number | null;
  cohortMedianViews: number | null;
  ratio: number | null;
  deviationPercent: number | null;
  verdict: "ABOVE" | "AROUND" | "BELOW" | "INSUFFICIENT_DATA";
}

export type DiagnosisStatus =
  | "OUTPERFORMING"
  | "NORMAL"
  | "UNDERPERFORMING"
  | "INSUFFICIENT_DATA";

export interface VideoDiagnosis {
  videoId: string;
  title: string | null;
  status: DiagnosisStatus;
  windowKey: WindowKey | null;
  metrics: NormalizedMetrics;
  comparisons: CohortComparison[];
  positiveSignals: string[];
  negativeSignals: string[];
  confidence: Confidence;
  confidenceScore: number;
  explanation: string;
  recommendedAction: string;
}

export type PatternType = "TOPIC" | "TITLE" | "FORMAT" | "PUBLISHING";

export interface PatternFinding {
  key: string; // stable identity across runs, e.g. "TITLE:question"
  type: PatternType;
  label: string;
  direction: "POSITIVE" | "NEGATIVE";
  observation: string;
  sampleSize: number;
  groupMedianViews: number;
  comparisonMedianViews: number;
  deltaPercent: number;
  windowKey: WindowKey;
  videoIds: string[];
  confidence: Confidence;
  confidenceScore: number;
  evidence: Evidence[];
}

export type LearningStatus =
  | "CANDIDATE"
  | "EMERGING"
  | "CONFIRMED"
  | "CONTRADICTED"
  | "STALE";

export interface LearningRecord {
  key: string;
  type: PatternType;
  observation: string;
  evidence: Evidence[];
  confidence: Confidence;
  confidenceScore: number;
  status: LearningStatus;
  direction: "POSITIVE" | "NEGATIVE";
  sampleSize: number;
  occurrences: number;
  contradictions: number;
  sourceVideos: string[];
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
  /** Signature of the evidence behind this record; null for legacy rows. */
  fingerprint: string | null;
}

export type RecommendationType =
  | "CONTENT"
  | "FORMAT"
  | "TITLE"
  | "PUBLISHING"
  | "EXPERIMENT"
  | "DATA";

export interface Recommendation {
  key: string;
  type: RecommendationType;
  title: string;
  explanation: string;
  evidence: Evidence[];
  confidence: Confidence;
  confidenceScore: number;
  impact: "LOW" | "MEDIUM" | "HIGH";
  nextAction: string;
}

export type ExperimentStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "COMPLETED"
  | "INCONCLUSIVE"
  | "REJECTED";

export interface ExperimentPlan {
  key: string;
  hypothesis: string;
  variable: string;
  whatChanged: string;
  baselineDescription: string;
  baselineMedianViews: number | null;
  targetMetric: string;
  successCriteria: string;
  testPeriodWindow: WindowKey;
  status: ExperimentStatus;
  confidence: Confidence;
  confidenceScore: number;
}

export interface ExperimentEvaluation {
  key: string;
  experimentId: string | null;
  status: ExperimentStatus;
  actualOutcome: string | null;
  conclusion: string | null;
  confidence: Confidence;
  confidenceScore: number;
  sampleSize: number;
}

export interface DataQualityReport {
  videosTotal: number;
  videosWithMetrics: number;
  videosWithoutPublishDate: number;
  unavailableFields: string[];
  smallSample: boolean;
  staleData: boolean;
  lastObservationAt: string | null;
  notes: string[];
}

export interface BrainStrategySummary {
  generatedAt: string;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  videosAnalyzed: number;
  diagnosisCounts: Record<DiagnosisStatus, number>;
  strongestThemes: string[];
  promisingFormats: string[];
  weakFormats: string[];
  titlePatternsToTest: string[];
  publishingObservations: string[];
  audienceSignals: string[];
  confirmedLearnings: string[];
  activeExperiments: string[];
  priorities: string[];
  dataQuality: DataQualityReport;
}

/** A persisted experiment as the intelligence layer reads it back. */
export interface StoredExperimentView {
  id: string | null;
  key: string;
  hypothesis: string;
  whatChanged: string;
  variable: string | null;
  status: ExperimentStatus;
  targetMetric: string;
  successCriteria: string;
  baselineMedianViews: number | null;
  testPeriodWindow: WindowKey;
  actualOutcome: string | null;
  conclusion: string | null;
  confidence: Confidence;
  confidenceScore: number;
  startedAt: string;
}

export type BrainStatus =
  | "READY"
  | "INSUFFICIENT_DATA"
  | "SYNC_REQUIRED"
  | "NOT_CONNECTED"
  | "ERROR";

export interface SummaryFinding {
  key: string;
  label: string;
  observation: string;
  direction: "POSITIVE" | "NEGATIVE";
  sampleSize: number;
  confidence: Confidence;
  confidenceScore: number;
}

export interface SummaryLearning {
  key: string;
  observation: string;
  status: LearningStatus;
  direction: "POSITIVE" | "NEGATIVE";
  occurrences: number;
  sampleSize: number;
  confidence: Confidence;
  confidenceScore: number;
}

export interface SummaryExperiment {
  key: string;
  hypothesis: string;
  whatChanged: string;
  status: ExperimentStatus;
  targetMetric: string;
  successCriteria: string;
  conclusion: string | null;
}

/**
 * The single structured payload the UI, the Brain read API and the persisted
 * strategy all share. Every field is either a real observation or an explicit
 * "not available yet" marker.
 */
export interface IntelligenceSummary {
  generatedAt: string;
  status: BrainStatus;
  videosAnalyzed: number;
  videosWithMetrics: number;
  windowKey: WindowKey | null;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  dataQuality: DataQualityReport;
  strongestFindings: SummaryFinding[];
  learnings: SummaryLearning[];
  activeExperiments: SummaryExperiment[];
  proposedExperiments: SummaryExperiment[];
  strategySummary: BrainStrategySummary;
  recommendations: Recommendation[];
  confidence: Confidence;
  confidenceScore: number;
  lastAnalysisAt: string | null;
  notes: string[];
}
