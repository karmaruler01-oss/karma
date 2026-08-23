// Channel-intelligence persistence contract.
//
// The brain algorithms stay pure (brain.ts). This interface is the only thing
// between them and storage, so the exact same persistence logic can run against
// Lovable Cloud in production and against an in-memory store in tests.
//
// Client-safe: types only, no database import.

import type { IntelligenceSummary } from "./intel/types";
import type {
  BaselineStats,
  Confidence,
  IssueCode,
  LearningMemoryEntry,
  NextVideoStrategy,
  ObservedMetrics,
  VideoOptimizationReport,
  WindowKey,
} from "./types";

export interface StoredVideo {
  videoId: string;
  projectId: string | null;
  title: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  shortForm: boolean;
  genre: string | null;
  structure: string | null;
  narrationStyle: string | null;
  hookText: string | null;
}

export interface StoredMetrics {
  videoId: string;
  windowKey: WindowKey;
  metrics: ObservedMetrics;
}

/** Channel defaults the strategy builder is allowed to use. Never invented. */
export interface ChannelDefaults {
  durationSeconds: number;
  genre: string;
  narrationStyle: string;
  uploadTime: string;
  explorationRatio: number | null;
}

/** channel_profile row, as the brain needs it. Missing values stay null. */
export interface StoredChannelProfile {
  channelId: string | null;
  channelTitle: string | null;
  country: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  /** Raw audience payload as synced. Never fabricated. */
  audienceProfile: Record<string, unknown> | null;
  dataSufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  lastSyncedAt: string | null;
}

export const EMPTY_CHANNEL_PROFILE: StoredChannelProfile = {
  channelId: null,
  channelTitle: null,
  country: null,
  subscriberCount: null,
  viewCount: null,
  videoCount: null,
  audienceProfile: null,
  dataSufficiency: "INSUFFICIENT_DATA",
  lastSyncedAt: null,
};


export interface StoredStrategy {
  id: string;
  version: number;
  active: boolean;
  createdAt: string;
  sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA";
  strategy: NextVideoStrategy;
  /** Structured intelligence summary attached by the Brain orchestrator. */
  intelligence: IntelligenceSummary | null;
}

/** Intelligence-layer metadata carried alongside a stored experiment. */
export interface ExperimentIntel {
  key: string;
  variable: string | null;
  targetMetric: string;
  successCriteria: string;
  baselineDescription: string;
  baselineMedianViews: number | null;
  testPeriodWindow: WindowKey;
}

export interface StoredExperiment {
  id: string;
  videoId: string | null;
  projectId: string | null;
  hypothesis: string;
  whatChanged: string;
  state: string;
  mode: string;
  createdAt: string;
  expectedOutcome: string | null;
  actualOutcome: string | null;
  conclusion: string | null;
  confidence: number;
  nextAction: string | null;
  /** Null for experiments created before the intelligence layer. */
  intel: ExperimentIntel | null;
}

export interface ExperimentPatch {
  state?: string;
  actualOutcome?: string | null;
  conclusion?: string | null;
  confidence?: number;
  nextAction?: string | null;
  metrics?: Record<string, unknown>;
}

export interface LearningRow {
  category: string;
  statement: string;
  state: string;
  confidence: number;
  evidence: Record<string, unknown>;
  source: string;
  videoId: string | null;
  projectId: string | null;
  observedAt: string;
}

export interface SyncLogRow {
  id: string;
  kind: string;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  detail: string | null;
  itemsSynced: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface ChannelStore {
  listVideos(userId: string): Promise<StoredVideo[]>;
  listMetrics(userId: string): Promise<StoredMetrics[]>;
  upsertVideos(userId: string, videos: StoredVideo[]): Promise<number>;
  upsertMetrics(userId: string, rows: StoredMetrics[]): Promise<number>;

  listLearningRows(userId: string): Promise<LearningRow[]>;
  /** Idempotent: replaces every row for (video, categories) before inserting. */
  replaceLearningRows(
    userId: string,
    videoId: string | null,
    categories: string[],
    rows: LearningRow[],
  ): Promise<number>;

  saveBaselines(userId: string, baselines: BaselineStats[]): Promise<number>;
  listBaselines(userId: string): Promise<BaselineStats[]>;

  latestStrategy(userId: string): Promise<StoredStrategy | null>;
  saveStrategy(
    userId: string,
    strategy: NextVideoStrategy,
    extra?: { reuseVersion?: number | null; intelligence?: IntelligenceSummary | null },
  ): Promise<StoredStrategy>;

  listExperiments(userId: string): Promise<StoredExperiment[]>;
  saveExperiment(
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
  ): Promise<StoredExperiment>;
  /** Idempotent update of an experiment's outcome fields. */
  updateExperiment(
    userId: string,
    id: string,
    patch: ExperimentPatch,
  ): Promise<StoredExperiment | null>;

  channelDefaults(userId: string): Promise<ChannelDefaults>;
  productionCount(userId: string): Promise<number>;

  /** Additive: channel-profile access the brain needs. Never invents values. */
  getChannelProfile(userId: string): Promise<StoredChannelProfile | null>;
  saveChannelProfile(
    userId: string,
    patch: Partial<StoredChannelProfile>,
  ): Promise<StoredChannelProfile>;


  startSync(userId: string, kind: string): Promise<string>;
  finishSync(
    id: string,
    status: SyncLogRow["status"],
    detail: string | null,
    itemsSynced: number,
  ): Promise<void>;
  lastSuccessfulSync(userId: string, kind: string): Promise<SyncLogRow | null>;
  listSyncLog(userId: string, limit?: number): Promise<SyncLogRow[]>;

  markChannelSufficiency(
    userId: string,
    sufficiency: "SUFFICIENT" | "INSUFFICIENT_DATA",
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared row shaping (used by both the DB store and the in-memory store)
// ---------------------------------------------------------------------------

export const LEARNING_REPORT_CATEGORY = "video_report";
export const LEARNING_LESSON_CATEGORY = "video_lesson";
export const LEARNING_WEAK_PATTERN_CATEGORY = "weak_pattern";
export const LEARNING_STRENGTH_CATEGORY = "positive_pattern";

const CONFIDENCE_SCORE: Record<Confidence, number> = { LOW: 0.25, MEDIUM: 0.6, HIGH: 0.9 };

export function confidenceScore(confidence: Confidence): number {
  return CONFIDENCE_SCORE[confidence];
}

/** A full VideoOptimizationReport persisted as one durable learning row. */
export function reportToLearningRow(
  report: VideoOptimizationReport,
  observedAt: string,
  projectId: string | null,
): LearningRow {
  return {
    category: LEARNING_REPORT_CATEGORY,
    statement: `${report.performanceState} · ${report.distribution.case}`,
    state: report.performanceState,
    confidence: confidenceScore(report.confidence),
    evidence: {
      performanceState: report.performanceState,
      performanceWindow: report.performanceWindow,
      ageHours: report.ageHours,
      observedMetrics: report.observedMetrics,
      distribution: report.distribution,
      retention: report.retention,
      historicalComparison: report.historicalComparison,
      strengths: report.strengths,
      weaknesses: report.weaknesses,
      lessons: report.lessons,
      recommendedChanges: report.recommendedChanges,
      nextExperiment: report.nextExperiment,
      confidence: report.confidence,
    },
    source: "channel_brain",
    videoId: report.videoId,
    projectId,
    observedAt,
  };
}

export function learningEntryToRow(
  entry: LearningMemoryEntry,
  projectId: string | null,
  category: string = LEARNING_LESSON_CATEGORY,
): LearningRow {
  return {
    category,
    statement: entry.lesson,
    state: entry.detectedIssue,
    confidence: confidenceScore(entry.confidence),
    evidence: {
      detectedIssue: entry.detectedIssue,
      performanceWindow: entry.performanceWindow,
      observedMetrics: entry.observedMetrics,
      evidence: entry.evidence,
      recommendedFutureChange: entry.recommendedFutureChange,
      confidence: entry.confidence,
    },
    source: "channel_brain",
    videoId: entry.videoId,
    projectId,
    observedAt: entry.createdAt,
  };
}

/** Rebuilds learning-memory entries from stored rows (no invention). */
export function rowToLearningEntry(row: LearningRow): LearningMemoryEntry | null {
  if (row.category !== LEARNING_LESSON_CATEGORY) return null;
  const evidence = row.evidence as {
    detectedIssue?: IssueCode;
    performanceWindow?: WindowKey | null;
    observedMetrics?: ObservedMetrics | null;
    evidence?: { label: string; detail: string }[];
    recommendedFutureChange?: string;
    confidence?: Confidence;
  };
  if (!row.videoId || !evidence.detectedIssue) return null;
  return {
    videoId: row.videoId,
    performanceWindow: evidence.performanceWindow ?? null,
    observedMetrics: evidence.observedMetrics ?? null,
    detectedIssue: evidence.detectedIssue,
    evidence: evidence.evidence ?? [],
    confidence: evidence.confidence ?? "LOW",
    lesson: row.statement,
    recommendedFutureChange: evidence.recommendedFutureChange ?? "",
    createdAt: row.observedAt,
  };
}
