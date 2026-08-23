// Per-video diagnostics: is this video outperforming, normal or underperforming
// *for this channel*, and which observable signal explains it?

import type { BrainConfig } from "../config";
import type { VideoFacts } from "../types";
import { scoreConfidence } from "./confidence";
import { compareToCohort, durationBand } from "./cohorts";
import { normalizeMetrics } from "./metrics";
import type { CohortComparison, CohortStats, DiagnosisStatus, VideoDiagnosis } from "./types";

function pickCohorts(video: VideoFacts, cohorts: CohortStats[]): CohortStats[] {
  const wanted = new Set<string>(["all"]);
  for (const cohort of cohorts) if (cohort.kind === "RECENT") wanted.add(cohort.key);
  wanted.add(`format:${video.shortForm ? "short" : "long"}`);
  const band = durationBand(video.durationSeconds);
  if (band) wanted.add(`duration:${band}`);
  if (video.genre) wanted.add(`topic:${video.genre}`);
  return cohorts.filter((cohort) => wanted.has(cohort.key));
}

export function diagnoseVideo(
  video: VideoFacts,
  cohorts: CohortStats[],
  windowKey: CohortStats["windowKey"] | null,
  config: BrainConfig,
  now: string,
): VideoDiagnosis {
  const metrics = normalizeMetrics(video, windowKey, now);
  const comparisons: CohortComparison[] = windowKey
    ? pickCohorts(video, cohorts)
        .filter((cohort) => cohort.windowKey === windowKey)
        .map((cohort) => compareToCohort(metrics.views.value, cohort, config, video.videoId))
        .sort((a, b) => b.sampleSize - a.sampleSize)
    : [];

  const usable = comparisons.filter((c) => c.verdict !== "INSUFFICIENT_DATA");
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const retention = metrics.averageViewPercentage.value;
  if (retention !== null) {
    if (retention >= config.strongRetentionPercent) {
      positiveSignals.push(`Retention ${retention}% is strong for this channel's threshold.`);
    } else if (retention < config.weakRetentionPercent) {
      negativeSignals.push(`Retention ${retention}% is below the weak-retention threshold.`);
    }
  }

  const ctr = metrics.impressionCtr.value;
  if (ctr !== null) {
    if (ctr < config.weakCtrPercent) {
      negativeSignals.push(`Impression CTR ${ctr}% is weak — title/thumbnail signal.`);
    } else {
      positiveSignals.push(`Impression CTR ${ctr}% is at or above the weak-CTR threshold.`);
    }
  }

  const impressions = metrics.impressions.value;
  if (impressions !== null && impressions < config.lowImpressions) {
    negativeSignals.push(
      `Only ${impressions} impressions — YouTube barely distributed this video.`,
    );
  }

  const engagement = metrics.engagementRate.value;
  if (engagement !== null && engagement >= 5) {
    positiveSignals.push(`Engagement rate ${engagement}% (likes + comments + shares / views).`);
  }

  for (const comparison of usable) {
    const text = `${comparison.label}: ${comparison.deviationPercent}% vs median (${comparison.sampleSize} videos)`;
    if (comparison.verdict === "ABOVE") positiveSignals.push(text);
    if (comparison.verdict === "BELOW") negativeSignals.push(text);
  }

  let status: DiagnosisStatus = "INSUFFICIENT_DATA";
  let explanation = "Not enough comparable history to judge this video yet.";
  let recommendedAction = "Keep collecting data — no change is justified by evidence yet.";

  if (metrics.ageHours < config.minObservationHours) {
    explanation = `Published ${Math.round(metrics.ageHours)}h ago — below the ${config.minObservationHours}h minimum observation time.`;
  } else if (usable.length > 0) {
    const above = usable.filter((c) => c.verdict === "ABOVE").length;
    const below = usable.filter((c) => c.verdict === "BELOW").length;
    if (above > below) {
      status = "OUTPERFORMING";
      explanation = `Beats ${above} of ${usable.length} comparable baselines in the ${windowKey} window.`;
      recommendedAction = "Repeat what this video did: same topic angle, format and packaging.";
    } else if (below > above) {
      status = "UNDERPERFORMING";
      explanation = `Falls short of ${below} of ${usable.length} comparable baselines in the ${windowKey} window.`;
      recommendedAction =
        negativeSignals[0] !== undefined
          ? `Address the weakest observed signal — ${negativeSignals[0]}`
          : "Change one variable (topic, title or thumbnail) on the next upload and compare.";
    } else {
      status = "NORMAL";
      explanation = `Performs in line with comparable videos in the ${windowKey} window.`;
      recommendedAction = "Nothing broken here — use this video as part of the baseline.";
    }
  }

  const confidence = scoreConfidence({
    sampleSize: usable.reduce((max, c) => Math.max(max, c.sampleSize), 0),
    consistency:
      usable.length === 0
        ? 0
        : Math.max(
            usable.filter((c) => c.verdict === "ABOVE").length,
            usable.filter((c) => c.verdict === "BELOW").length,
            usable.filter((c) => c.verdict === "AROUND").length,
          ) / usable.length,
    effectPercent: usable[0]?.deviationPercent ?? 0,
    completeness: metrics.completeness,
    recencyDays: metrics.ageHours / 24,
  });

  return {
    videoId: video.videoId,
    title: video.title ?? null,
    status,
    windowKey,
    metrics,
    comparisons,
    positiveSignals,
    negativeSignals,
    confidence: status === "INSUFFICIENT_DATA" ? "LOW" : confidence.level,
    confidenceScore: status === "INSUFFICIENT_DATA" ? 0 : confidence.score,
    explanation,
    recommendedAction,
  };
}
