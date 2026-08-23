// Normalized metric model with explicit provenance.
//
// Rules:
//   * a value reported by the YouTube APIs is REAL (0 is a real observation),
//   * a value computed only from REAL values is DERIVED,
//   * anything else is UNAVAILABLE with a null value — never a guessed number.

import { hoursBetween } from "../brain";
import type { ObservedMetrics, VideoFacts, WindowKey } from "../types";
import type { MetricValue, NormalizedMetrics } from "./types";

function real(value: number | null | undefined): MetricValue {
  return typeof value === "number" && Number.isFinite(value)
    ? { value, provenance: "REAL" }
    : { value: null, provenance: "UNAVAILABLE" };
}

function unavailable(note: string): MetricValue {
  return { value: null, provenance: "UNAVAILABLE", note };
}

/** Ratio helper: only DERIVED when both inputs are real and the base is > 0. */
function ratio(
  numerator: MetricValue,
  denominator: MetricValue,
  note: string,
  scale = 100,
): MetricValue {
  const n = numerator.value;
  const d = denominator.value;
  if (n === null || d === null) return unavailable(note);
  if (d <= 0) return unavailable(`${note} (no views to divide by)`);
  return { value: round((n / d) * scale), provenance: "DERIVED", note };
}

export function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const REPORTED_FIELDS: (keyof ObservedMetrics)[] = [
  "views",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "watchTimeMinutes",
  "averageViewDurationSeconds",
  "averageViewPercentage",
  "impressions",
  "impressionCtr",
];

export function metricCompleteness(metrics: ObservedMetrics | null): number {
  if (!metrics) return 0;
  const present = REPORTED_FIELDS.filter((key) => typeof metrics[key] === "number").length;
  return round(present / REPORTED_FIELDS.length, 3);
}

/**
 * Builds the normalized model for one video in one observation window.
 * `metrics` may be null (window not collected) — the result is then entirely
 * UNAVAILABLE rather than zero-filled.
 */
export function normalizeMetrics(
  video: VideoFacts,
  windowKey: WindowKey | null,
  now: string,
): NormalizedMetrics {
  const metrics: ObservedMetrics | null = windowKey ? (video.metrics[windowKey] ?? null) : null;
  const ageHours = round(Math.max(0, hoursBetween(video.publishedAt, now)), 2);

  const views = real(metrics?.views);
  const likes = real(metrics?.likes);
  const comments = real(metrics?.comments);
  const shares = real(metrics?.shares);
  const subscribersGained = real(metrics?.subscribersGained);

  const engagementBase =
    likes.value === null && comments.value === null && shares.value === null
      ? null
      : (likes.value ?? 0) + (comments.value ?? 0) + (shares.value ?? 0);

  const viewsPerHour: MetricValue =
    views.value === null || ageHours <= 0
      ? unavailable("views / hours since publish")
      : { value: round(views.value / ageHours), provenance: "DERIVED", note: "views / hours since publish" };

  return {
    videoId: video.videoId,
    windowKey,
    publishedAt: video.publishedAt,
    ageHours,
    completeness: metricCompleteness(metrics),

    views,
    likes,
    comments,
    shares,
    subscribersGained,
    // The YouTube Analytics sync does not collect subscribersLost, so it is
    // explicitly unavailable rather than silently reported as 0.
    subscribersLost: unavailable("not collected by the current analytics sync"),
    watchTimeMinutes: real(metrics?.watchTimeMinutes),
    averageViewDurationSeconds: real(metrics?.averageViewDurationSeconds),
    averageViewPercentage: real(metrics?.averageViewPercentage),
    impressions: real(metrics?.impressions),
    impressionCtr: real(metrics?.impressionCtr),
    durationSeconds: real(video.durationSeconds),
    usShare: real(metrics?.usShare),

    viewsPerHour,
    viewsPerDay:
      viewsPerHour.value === null
        ? unavailable("views / days since publish")
        : {
            value: round(viewsPerHour.value * 24),
            provenance: "DERIVED",
            note: "views / days since publish",
          },
    engagementRate: ratio(
      { value: engagementBase, provenance: engagementBase === null ? "UNAVAILABLE" : "REAL" },
      views,
      "(likes + comments + shares) / views %",
    ),
    likeRate: ratio(likes, views, "likes / views %"),
    commentRate: ratio(comments, views, "comments / views %"),
    subscriberConversionRate: ratio(subscribersGained, views, "subscribers gained / views %"),
  };
}

/** Convenience: every field that is UNAVAILABLE for this video. */
export function unavailableFields(normalized: NormalizedMetrics): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(normalized)) {
    if (value && typeof value === "object" && "provenance" in value) {
      if ((value as MetricValue).provenance === "UNAVAILABLE") out.push(key);
    }
  }
  return out;
}
