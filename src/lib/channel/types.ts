// Channel AI Brain — shared domain types.
// Everything here is client-safe (no DB / no secrets) so the same reasoning
// runs in server functions, in tests, and in the dashboard UI.

/** Age-aware observation windows. Comparisons are only ever window-vs-window. */
export type WindowKey = "24h" | "48h" | "7d" | "28d";

export const WINDOW_KEYS: WindowKey[] = ["24h", "48h", "7d", "28d"];

export const WINDOW_HOURS: Record<WindowKey, number> = {
  "24h": 24,
  "48h": 48,
  "7d": 24 * 7,
  "28d": 24 * 28,
};

export const WINDOW_LABEL: Record<WindowKey, string> = {
  "24h": "First 24 hours",
  "48h": "First 48 hours",
  "7d": "First 7 days",
  "28d": "First 28 days",
};

/** Evidence-based performance state. Never a guarantee, never a promise. */
export type PerformanceState =
  | "NEW"
  | "TESTING"
  | "GROWING"
  | "STALLED"
  | "UNDERPERFORMING"
  | "INSUFFICIENT_DATA";

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/** The six distribution cases the brain must be able to tell apart. */
export type DistributionCase =
  | "ZERO_VIEWS_INSUFFICIENT_DATA" // A
  | "ZERO_VIEWS_OBSERVED" // B
  | "LOW_VIEWS_LOW_IMPRESSIONS" // C
  | "LOW_VIEWS_REASONABLE_IMPRESSIONS" // D
  | "VIEWS_POOR_RETENTION" // E
  | "GOOD_RETENTION_WEAK_DISTRIBUTION" // F
  | "HEALTHY"
  | "INSUFFICIENT_DATA";

export type IssueCode =
  | "distribution_problem"
  | "topic_problem"
  | "title_problem"
  | "thumbnail_problem"
  | "audience_fit_problem"
  | "retention_problem"
  | "timing_problem"
  | "insufficient_data";

export type BrainMode = "EXPLOITATION" | "EXPLORATION" | "RECOVERY_MODE";

export type HealthState = "HEALTHY" | "WATCH" | "AT_RISK" | "INSUFFICIENT_DATA";

/** Raw, real metrics for one video in one window. All fields optional: the
 *  YouTube Analytics API does not always return impressions/CTR/retention. */
export interface ObservedMetrics {
  views: number | null;
  impressions: number | null;
  impressionCtr: number | null; // percent, 0-100
  watchTimeMinutes: number | null;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null; // retention, 0-100
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
  trafficSources: Record<string, number> | null;
  usShare: number | null; // percent of views from the US, 0-100
}

export const EMPTY_METRICS: ObservedMetrics = {
  views: null,
  impressions: null,
  impressionCtr: null,
  watchTimeMinutes: null,
  averageViewDurationSeconds: null,
  averageViewPercentage: null,
  likes: null,
  comments: null,
  shares: null,
  subscribersGained: null,
  trafficSources: null,
  usShare: null,
};

export interface VideoFacts {
  videoId: string;
  projectId?: string | null;
  title?: string | null;
  publishedAt: string; // ISO
  durationSeconds?: number | null;
  genre?: string | null;
  structure?: string | null;
  narrationStyle?: string | null;
  hookText?: string | null;
  shortForm?: boolean;
  /** metrics per window; a window may be missing entirely. */
  metrics: Partial<Record<WindowKey, ObservedMetrics>>;
}

export interface BaselineStats {
  windowKey: WindowKey;
  cohort: string; // "all" or e.g. "genre:mystery"
  sampleSize: number;
  medianViews: number | null;
  p25Views: number | null;
  p75Views: number | null;
  medianWatchTimeMinutes: number | null;
  medianRetentionPercentage: number | null;
  medianSubscribersGained: number | null;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
}

export interface Evidence {
  label: string;
  detail: string;
}

export interface BaselineComparison {
  windowKey: WindowKey;
  cohort: string;
  sampleSize: number;
  videoViews: number | null;
  medianViews: number | null;
  ratio: number | null; // videoViews / medianViews
  verdict: "ABOVE" | "AROUND" | "BELOW" | "INSUFFICIENT_DATA";
}

export interface DistributionAnalysis {
  windowKey: WindowKey | null;
  observationComplete: boolean;
  case: DistributionCase;
  evidence: Evidence[];
  confidence: Confidence;
}

export interface RetentionAnalysis {
  state: "STRONG" | "AVERAGE" | "WEAK" | "INSUFFICIENT_DATA";
  averageViewPercentage: number | null;
  averageViewDurationSeconds: number | null;
  evidence: Evidence[];
}

export interface StallDetection {
  stalled: boolean;
  state: PerformanceState;
  windowKey: WindowKey | null;
  ageHours: number;
  evidence: Evidence[];
  confidence: Confidence;
}

export interface StallAnalysis {
  videoId: string;
  issue: IssueCode;
  secondaryIssues: IssueCode[];
  evidence: Evidence[];
  confidence: Confidence;
  recommendedAction: string;
  lesson: string | null;
  recommendedFutureChange: string | null;
}

export interface LearningMemoryEntry {
  videoId: string;
  performanceWindow: WindowKey | null;
  observedMetrics: ObservedMetrics | null;
  detectedIssue: IssueCode;
  evidence: Evidence[];
  confidence: Confidence;
  lesson: string;
  recommendedFutureChange: string;
  createdAt: string;
}

export interface VideoOptimizationReport {
  videoId: string;
  title: string | null;
  performanceState: PerformanceState;
  performanceWindow: WindowKey | null;
  ageHours: number;
  observedMetrics: ObservedMetrics | null;
  historicalComparison: BaselineComparison[];
  distribution: DistributionAnalysis;
  retention: RetentionAnalysis;
  strengths: string[];
  weaknesses: string[];
  lessons: string[];
  recommendedChanges: string[];
  confidence: Confidence;
  nextExperiment: string | null;
}

export interface HealthMetric {
  key: string;
  label: string;
  state: HealthState;
  value: string; // human readable, or "INSUFFICIENT_DATA"
  evidence: string;
}

export interface ChannelHealth {
  distribution: HealthMetric;
  retention: HealthMetric;
  engagement: HealthMetric;
  subscriberGrowth: HealthMetric;
  usAudienceGrowth: HealthMetric;
  learning: HealthMetric;
}

export interface WeakPattern {
  key: string; // e.g. "genre:mystery" or "issue:retention_problem"
  label: string;
  occurrences: number;
  lastSeenAt: string;
  lesson: string;
}

export interface NextVideoStrategy {
  objective: string;
  mode: BrainMode;
  explorationRatio: number;
  isExperiment: boolean;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  channelBaseline: BaselineStats[];
  knownStrengths: string[];
  knownWeaknesses: string[];
  patternsToAvoid: string[];
  patternsToRetain: string[];
  newExperiment: string | null;
  recommendedTopic: string;
  recommendedHook: string;
  recommendedDurationSeconds: number;
  recommendedStoryStructure: string;
  recommendedPacing: string;
  recommendedThumbnailDirection: string;
  recommendedTitleDirection: string;
  recommendedNarrationStyle: string;
  recommendedUploadTime: string;
  stalledVideoInfluence: string[];
  flags: ("REPEATED_WEAK_PATTERN" | "RECOVERY_MODE" | "INSUFFICIENT_DATA")[];
  evidence: Evidence[];
}

export interface ChannelAnalysis {
  generatedAt: string;
  videoCount: number;
  analyzedVideos: {
    videoId: string;
    title: string | null;
    state: PerformanceState;
    windowKey: WindowKey | null;
    distributionCase: DistributionCase;
    confidence: Confidence;
  }[];
  baselines: BaselineStats[];
  health: ChannelHealth;
  mode: BrainMode;
  explorationRatio: number;
  weakPatterns: WeakPattern[];
  stalledVideoIds: string[];
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
}
