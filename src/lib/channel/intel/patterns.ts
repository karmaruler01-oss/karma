// Content pattern detection.
//
// A pattern is only reported when it is backed by real videos: at least
// `minPatternSample` uploads share the trait, and the group's median views
// differ from the rest of the channel by at least `patternMinDeltaPercent`.

import { median } from "../brain";
import type { BrainConfig } from "../config";
import type { Evidence, VideoFacts, WindowKey } from "../types";
import { durationBand } from "./cohorts";
import { scoreConfidence } from "./confidence";
import type { PatternFinding, PatternType } from "./types";

export interface TitleFeatures {
  length: number;
  wordCount: number;
  hasQuestion: boolean;
  hasNumber: boolean;
  hasColon: boolean;
  hasAllCapsWord: boolean;
  lengthBand: "short" | "medium" | "long";
}

export function titleFeatures(title: string): TitleFeatures {
  const trimmed = title.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  return {
    length: trimmed.length,
    wordCount: words.length,
    hasQuestion: trimmed.includes("?"),
    hasNumber: /\d/.test(trimmed),
    hasColon: trimmed.includes(":"),
    hasAllCapsWord: words.some((word) => word.length >= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)),
    lengthBand: trimmed.length <= 40 ? "short" : trimmed.length <= 60 ? "medium" : "long",
  };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hourBucket(hour: number): string {
  if (hour < 6) return "00:00-06:00 UTC";
  if (hour < 12) return "06:00-12:00 UTC";
  if (hour < 18) return "12:00-18:00 UTC";
  return "18:00-24:00 UTC";
}

interface Trait {
  key: string;
  type: PatternType;
  label: string;
}

function traitsFor(video: VideoFacts): Trait[] {
  const traits: Trait[] = [];

  if (video.genre) {
    traits.push({ key: `TOPIC:${video.genre}`, type: "TOPIC", label: `Topic “${video.genre}”` });
  }
  if (video.structure) {
    traits.push({
      key: `FORMAT:structure:${video.structure}`,
      type: "FORMAT",
      label: `“${video.structure}” structure`,
    });
  }
  if (video.narrationStyle) {
    traits.push({
      key: `FORMAT:narration:${video.narrationStyle}`,
      type: "FORMAT",
      label: `“${video.narrationStyle}” narration`,
    });
  }
  traits.push({
    key: `FORMAT:${video.shortForm ? "short" : "long"}`,
    type: "FORMAT",
    label: video.shortForm ? "Short-form uploads" : "Long-form uploads",
  });
  const band = durationBand(video.durationSeconds);
  if (band) {
    traits.push({ key: `FORMAT:duration:${band}`, type: "FORMAT", label: `Videos ${band} long` });
  }

  if (video.title) {
    const features = titleFeatures(video.title);
    traits.push({
      key: `TITLE:length:${features.lengthBand}`,
      type: "TITLE",
      label: `${features.lengthBand} titles (${features.lengthBand === "short" ? "≤40" : features.lengthBand === "medium" ? "41–60" : ">60"} chars)`,
    });
    if (features.hasQuestion) {
      traits.push({ key: "TITLE:question", type: "TITLE", label: "Question titles" });
    }
    if (features.hasNumber) {
      traits.push({ key: "TITLE:number", type: "TITLE", label: "Titles containing a number" });
    }
    if (features.hasColon) {
      traits.push({ key: "TITLE:colon", type: "TITLE", label: "Titles using a colon" });
    }
    if (features.hasAllCapsWord) {
      traits.push({ key: "TITLE:allcaps", type: "TITLE", label: "Titles with an ALL-CAPS word" });
    }
  }

  const published = Date.parse(video.publishedAt);
  if (Number.isFinite(published)) {
    const date = new Date(published);
    const weekday = WEEKDAYS[date.getUTCDay()] ?? "Unknown";
    traits.push({
      key: `PUBLISHING:day:${weekday}`,
      type: "PUBLISHING",
      label: `Published on ${weekday}`,
    });
    const bucket = hourBucket(date.getUTCHours());
    traits.push({
      key: `PUBLISHING:hour:${bucket}`,
      type: "PUBLISHING",
      label: `Published ${bucket}`,
    });
  }

  return traits;
}

export function detectPatterns(
  videos: VideoFacts[],
  windowKey: WindowKey,
  config: BrainConfig,
  now: string,
): PatternFinding[] {
  const withViews = videos.filter(
    (video) => typeof video.metrics[windowKey]?.views === "number",
  );
  if (withViews.length < config.minPatternSample + 1) return [];

  const viewsOf = (video: VideoFacts) => video.metrics[windowKey]?.views ?? 0;

  const groups = new Map<string, { trait: Trait; videos: VideoFacts[] }>();
  for (const video of withViews) {
    for (const trait of traitsFor(video)) {
      const bucket = groups.get(trait.key) ?? { trait, videos: [] };
      bucket.videos.push(video);
      groups.set(trait.key, bucket);
    }
  }

  const findings: PatternFinding[] = [];
  for (const [key, bucket] of groups) {
    if (bucket.videos.length < config.minPatternSample) continue;
    const ids = new Set(bucket.videos.map((video) => video.videoId));
    const rest = withViews.filter((video) => !ids.has(video.videoId));
    if (rest.length === 0) continue;

    const groupMedian = median(bucket.videos.map(viewsOf));
    const restMedian = median(rest.map(viewsOf));
    if (groupMedian === null || restMedian === null || restMedian <= 0) continue;

    const deltaPercent = Math.round(((groupMedian - restMedian) / restMedian) * 1000) / 10;
    if (Math.abs(deltaPercent) < config.patternMinDeltaPercent) continue;

    const direction = deltaPercent > 0 ? "POSITIVE" : "NEGATIVE";
    const consistent = bucket.videos.filter((video) =>
      direction === "POSITIVE" ? viewsOf(video) >= restMedian : viewsOf(video) <= restMedian,
    ).length;

    const newest = bucket.videos.reduce((latest, video) => {
      const ts = Date.parse(video.publishedAt);
      return Number.isFinite(ts) && ts > latest ? ts : latest;
    }, 0);
    const recencyDays = newest > 0 ? (Date.parse(now) - newest) / 86_400_000 : undefined;

    const confidence = scoreConfidence({
      sampleSize: bucket.videos.length,
      consistency: consistent / bucket.videos.length,
      effectPercent: deltaPercent,
      completeness: 1,
      ...(recencyDays === undefined ? {} : { recencyDays }),
    });

    const evidence: Evidence[] = [
      {
        label: "Sample",
        detail: `${bucket.videos.length} video(s) with this trait vs ${rest.length} without, ${windowKey} window`,
      },
      {
        label: "Median views",
        detail: `${Math.round(groupMedian)} with the trait vs ${Math.round(restMedian)} without`,
      },
      {
        label: "Consistency",
        detail: `${consistent} of ${bucket.videos.length} videos move in the same direction`,
      },
    ];

    findings.push({
      key,
      type: bucket.trait.type,
      label: bucket.trait.label,
      direction,
      observation: `${bucket.trait.label} performed ${deltaPercent > 0 ? "+" : ""}${deltaPercent}% vs the rest of the channel (median views, ${windowKey}).`,
      sampleSize: bucket.videos.length,
      groupMedianViews: Math.round(groupMedian),
      comparisonMedianViews: Math.round(restMedian),
      deltaPercent,
      windowKey,
      videoIds: bucket.videos.map((video) => video.videoId),
      confidence: confidence.level,
      confidenceScore: confidence.score,
      evidence,
    });
  }

  return findings.sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent));
}
