// Performance baselines / cohorts.
//
// A video is never compared to an absolute number: it is compared to the
// channel's own history inside the same observation window, and to cohorts of
// comparable videos (format, duration band, topic, recent uploads).

import { median, percentile } from "../brain";
import type { BrainConfig } from "../config";
import type { BaselineStats, VideoFacts, WindowKey } from "../types";
import type { CohortComparison, CohortStats } from "./types";

export interface CohortSample {
  videoId: string;
  publishedAt: string;
  views: number;
  retention: number | null;
}

export function durationBand(durationSeconds: number | null | undefined): string | null {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) return null;
  if (durationSeconds <= 60) return "0-60s";
  if (durationSeconds <= 180) return "1-3min";
  if (durationSeconds <= 480) return "3-8min";
  if (durationSeconds <= 1200) return "8-20min";
  return "20min+";
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Chronological trend: median of the older half vs the newer half. */
export function cohortTrend(samples: CohortSample[]): CohortStats["trend"] {
  if (samples.length < 4) return "INSUFFICIENT_DATA";
  const sorted = [...samples].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );
  const half = Math.floor(sorted.length / 2);
  const older = median(sorted.slice(0, half).map((s) => s.views));
  const newer = median(sorted.slice(sorted.length - half).map((s) => s.views));
  if (older === null || newer === null || older <= 0) return "INSUFFICIENT_DATA";
  const delta = (newer - older) / older;
  if (delta >= 0.15) return "RISING";
  if (delta <= -0.15) return "FALLING";
  return "FLAT";
}

function statsFor(
  key: string,
  kind: CohortStats["kind"],
  label: string,
  windowKey: WindowKey,
  samples: CohortSample[],
  config: BrainConfig,
): CohortStats {
  const views = samples.map((s) => s.views);
  const retentions = samples
    .map((s) => s.retention)
    .filter((value): value is number => typeof value === "number");
  return {
    key,
    kind,
    label,
    windowKey,
    sampleSize: samples.length,
    medianViews: median(views),
    meanViews: mean(views),
    p25Views: percentile(views, 25),
    p75Views: percentile(views, 75),
    medianRetentionPercentage: median(retentions),
    trend: cohortTrend(samples),
    sufficiency: samples.length >= config.minCohortSample ? "SUFFICIENT" : "INSUFFICIENT_DATA",
    videoIds: samples.map((s) => s.videoId),
  };
}

/** Extracts the comparable samples for one window (videos without views drop out). */
export function samplesForWindow(videos: VideoFacts[], windowKey: WindowKey): CohortSample[] {
  const out: CohortSample[] = [];
  for (const video of videos) {
    const metrics = video.metrics[windowKey];
    if (!metrics || typeof metrics.views !== "number") continue;
    out.push({
      videoId: video.videoId,
      publishedAt: video.publishedAt,
      views: metrics.views,
      retention:
        typeof metrics.averageViewPercentage === "number"
          ? metrics.averageViewPercentage
          : null,
    });
  }
  return out;
}

/**
 * Builds every cohort the Brain knows how to reason about for one window.
 * Cohorts with too few samples are still returned, flagged INSUFFICIENT_DATA,
 * so the UI can explain *why* no comparison was made.
 */
export function buildCohorts(
  videos: VideoFacts[],
  windowKey: WindowKey,
  config: BrainConfig,
): CohortStats[] {
  const samples = samplesForWindow(videos, windowKey);
  const byId = new Map(videos.map((video) => [video.videoId, video] as const));
  const cohorts: CohortStats[] = [
    statsFor("all", "ALL", "All videos", windowKey, samples, config),
  ];

  const recent = [...samples]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, config.recentUploadCohortSize);
  cohorts.push(
    statsFor(
      `recent:${config.recentUploadCohortSize}`,
      "RECENT",
      `Last ${config.recentUploadCohortSize} uploads`,
      windowKey,
      recent,
      config,
    ),
  );

  const groups = new Map<string, { kind: CohortStats["kind"]; label: string; items: CohortSample[] }>();
  const push = (key: string, kind: CohortStats["kind"], label: string, sample: CohortSample) => {
    const bucket = groups.get(key) ?? { kind, label, items: [] };
    bucket.items.push(sample);
    groups.set(key, bucket);
  };

  for (const sample of samples) {
    const video = byId.get(sample.videoId);
    if (!video) continue;
    const format = video.shortForm ? "short" : "long";
    push(`format:${format}`, "FORMAT", format === "short" ? "Short-form" : "Long-form", sample);
    const band = durationBand(video.durationSeconds);
    if (band) push(`duration:${band}`, "DURATION", `Duration ${band}`, sample);
    if (video.genre) push(`topic:${video.genre}`, "TOPIC", `Topic “${video.genre}”`, sample);
  }

  for (const [key, bucket] of groups) {
    cohorts.push(statsFor(key, bucket.kind, bucket.label, windowKey, bucket.items, config));
  }

  return cohorts;
}

export function compareToCohort(
  videoViews: number | null,
  cohort: CohortStats,
  config: BrainConfig,
  excludeVideoId?: string,
): CohortComparison {
  // A video must never be compared against a baseline that includes itself
  // when that is the only sample — that would always read as "exactly average".
  const selfOnly =
    excludeVideoId !== undefined &&
    cohort.videoIds.length <= 1 &&
    cohort.videoIds[0] === excludeVideoId;

  const base = {
    cohortKey: cohort.key,
    label: cohort.label,
    windowKey: cohort.windowKey,
    sampleSize: cohort.sampleSize,
    videoViews,
    cohortMedianViews: cohort.medianViews,
  };

  if (
    selfOnly ||
    cohort.sufficiency === "INSUFFICIENT_DATA" ||
    videoViews === null ||
    cohort.medianViews === null ||
    cohort.medianViews <= 0
  ) {
    return { ...base, ratio: null, deviationPercent: null, verdict: "INSUFFICIENT_DATA" };
  }

  const ratio = videoViews / cohort.medianViews;
  const deviationPercent = Math.round((ratio - 1) * 1000) / 10;
  const threshold = config.diagnosticDeviationPercent;
  const verdict: CohortComparison["verdict"] =
    deviationPercent >= threshold ? "ABOVE" : deviationPercent <= -threshold ? "BELOW" : "AROUND";

  return { ...base, ratio: Math.round(ratio * 1000) / 1000, deviationPercent, verdict };
}

/** Cohort stats persisted through the existing channel_baselines table. */
export function cohortToBaselineStats(cohort: CohortStats): BaselineStats {
  return {
    windowKey: cohort.windowKey,
    cohort: cohort.key,
    sampleSize: cohort.sampleSize,
    medianViews: cohort.medianViews,
    p25Views: cohort.p25Views,
    p75Views: cohort.p75Views,
    medianWatchTimeMinutes: null,
    medianRetentionPercentage: cohort.medianRetentionPercentage,
    medianSubscribersGained: null,
    sufficiency: cohort.sufficiency,
  };
}
