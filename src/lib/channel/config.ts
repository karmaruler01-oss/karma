// Channel AI Brain — configurable thresholds.
//
// Every detection threshold in the brain is configurable so the reasoning can
// be tuned per channel without editing algorithm code. Nothing here invents
// data: these are only the boundaries used to interpret real observations.

export interface BrainConfig {
  /** A video younger than this cannot be judged at all. */
  minObservationHours: number;
  /** A video must be at least this old before "stalled" is even considered. */
  stallMinAgeHours: number;
  /** Below this share of the channel median the video counts as stalled. */
  stallBaselineRatio: number;
  /** Minimum relative view growth between two consecutive windows. */
  stallMinWindowGrowthRatio: number;
  /** Absolute view floor under which a completed window is always weak. */
  stallAbsoluteViewFloor: number;
  /** Fewer baseline samples than this ⇒ INSUFFICIENT_DATA. */
  minBaselineSample: number;
  /** Fewer analyzed videos than this ⇒ the channel itself is INSUFFICIENT_DATA. */
  minChannelSample: number;
  /** Impressions under this are treated as "YouTube barely showed it". */
  lowImpressions: number;
  /** Impression CTR (%) under this is a weak title/thumbnail signal. */
  weakCtrPercent: number;
  /** Retention (%) under this is weak. */
  weakRetentionPercent: number;
  /** Retention (%) at or above this is strong. */
  strongRetentionPercent: number;
  /** views / median ≥ this ⇒ ABOVE baseline. */
  aboveBaselineRatio: number;
  /** views / median < this ⇒ BELOW baseline. */
  belowBaselineRatio: number;
  /** Same weak pattern seen this many times ⇒ REPEATED_WEAK_PATTERN. */
  repeatedWeakPatternThreshold: number;
  /** Consecutive weak recent videos that trigger Recovery Mode. */
  recoveryConsecutiveWeak: number;
  /** Exploration ratio while in Recovery Mode. */
  recoveryExplorationRatio: number;
  /** Default exploration ratio (exploration vs exploitation). */
  explorationRatio: number;
  /** Exploration ratio while the channel has insufficient data. */
  coldStartExplorationRatio: number;

  // --- Intelligence layer (Step 4) -----------------------------------------
  /** Minimum videos inside a cohort before it may be compared at all. */
  minCohortSample: number;
  /** Minimum videos sharing a trait before a pattern may be reported. */
  minPatternSample: number;
  /** Minimum |delta| vs the comparison baseline (%) for a pattern to count. */
  patternMinDeltaPercent: number;
  /** Repeated observations before a learning becomes EMERGING. */
  learningEmergingOccurrences: number;
  /** Repeated observations before a learning may become CONFIRMED. */
  learningConfirmedOccurrences: number;
  /** Days without re-observation before a learning goes STALE. */
  learningStaleDays: number;
  /** How many of the newest uploads form the "recent uploads" cohort. */
  recentUploadCohortSize: number;
  /** |deviation| (%) vs baseline before a video is OUTPERFORMING/UNDERPERFORMING. */
  diagnosticDeviationPercent: number;
  /** Days after which synced metrics are treated as stale data. */
  staleDataDays: number;
}


export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  minObservationHours: 24,
  stallMinAgeHours: 48,
  stallBaselineRatio: 0.4,
  stallMinWindowGrowthRatio: 0.15,
  stallAbsoluteViewFloor: 50,
  minBaselineSample: 5,
  minChannelSample: 3,
  lowImpressions: 500,
  weakCtrPercent: 4,
  weakRetentionPercent: 30,
  strongRetentionPercent: 50,
  aboveBaselineRatio: 1.2,
  belowBaselineRatio: 0.8,
  repeatedWeakPatternThreshold: 3,
  recoveryConsecutiveWeak: 3,
  recoveryExplorationRatio: 0.6,
  explorationRatio: 0.2,
  coldStartExplorationRatio: 1,
  minCohortSample: 3,
  minPatternSample: 3,
  patternMinDeltaPercent: 15,
  learningEmergingOccurrences: 2,
  learningConfirmedOccurrences: 3,
  learningStaleDays: 45,
  recentUploadCohortSize: 10,
  diagnosticDeviationPercent: 20,
  staleDataDays: 14,
};


export type BrainConfigOverrides = Partial<BrainConfig>;

/** Merge user overrides over the defaults, ignoring non-finite values. */
export function resolveBrainConfig(overrides?: BrainConfigOverrides | null): BrainConfig {
  const resolved: BrainConfig = { ...DEFAULT_BRAIN_CONFIG };
  if (!overrides) return resolved;
  for (const key of Object.keys(DEFAULT_BRAIN_CONFIG) as (keyof BrainConfig)[]) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      resolved[key] = value;
    }
  }
  return resolved;
}
