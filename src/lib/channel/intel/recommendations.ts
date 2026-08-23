// Recommendation builder.
//
// Every recommendation must cite the evidence it came from. Nothing is
// recommended on vibes: a learning that is only a CANDIDATE becomes a *test*,
// not an instruction.

import type { Evidence } from "../types";
import { activeLearnings } from "./learnings";
import type {
  DataQualityReport,
  LearningRecord,
  Recommendation,
  RecommendationType,
  VideoDiagnosis,
} from "./types";

const TYPE_MAP: Record<LearningRecord["type"], RecommendationType> = {
  TOPIC: "CONTENT",
  TITLE: "TITLE",
  FORMAT: "FORMAT",
  PUBLISHING: "PUBLISHING",
};

function impactFor(record: LearningRecord): Recommendation["impact"] {
  if (record.status === "CONFIRMED" && record.confidenceScore >= 0.7) return "HIGH";
  if (record.confidenceScore >= 0.5) return "MEDIUM";
  return "LOW";
}

export function buildRecommendations(
  learnings: LearningRecord[],
  diagnoses: VideoDiagnosis[],
  quality: DataQualityReport,
): Recommendation[] {
  const out: Recommendation[] = [];

  if (quality.smallSample) {
    out.push({
      key: "DATA:small-sample",
      type: "DATA",
      title: "Keep publishing — the sample is still too small for firm conclusions",
      explanation: `Only ${quality.videosWithMetrics} video(s) have usable analytics. Patterns found now are candidates, not rules.`,
      evidence: [
        { label: "Videos with metrics", detail: String(quality.videosWithMetrics) },
        { label: "Videos synced", detail: String(quality.videosTotal) },
      ],
      confidence: "HIGH",
      confidenceScore: 0.9,
      impact: "HIGH",
      nextAction: "Publish and sync a few more videos before changing strategy.",
    });
  }

  for (const record of activeLearnings(learnings)) {
    const verb = record.direction === "POSITIVE" ? "Do more of" : "Avoid";
    out.push({
      key: `LEARNING:${record.key}`,
      type: TYPE_MAP[record.type],
      title: `${verb}: ${record.observation.split(" performed")[0]}`,
      explanation: record.observation,
      evidence: record.evidence,
      confidence: record.confidence,
      confidenceScore: record.confidenceScore,
      impact: impactFor(record),
      nextAction:
        record.status === "CONFIRMED"
          ? record.direction === "POSITIVE"
            ? "Apply this on the next upload."
            : "Stop repeating this on upcoming uploads."
          : "Test this deliberately on the next upload and re-measure.",
    });
  }

  const winners = diagnoses.filter((d) => d.status === "OUTPERFORMING");
  if (winners[0]) {
    const evidence: Evidence[] = winners
      .slice(0, 3)
      .map((d) => ({ label: d.title ?? d.videoId, detail: d.explanation }));
    out.push({
      key: "CONTENT:repeat-winners",
      type: "CONTENT",
      title: "Repeat the angle of your best-performing uploads",
      explanation: `${winners.length} video(s) beat their comparable baselines.`,
      evidence,
      confidence: winners[0].confidence,
      confidenceScore: winners[0].confidenceScore,
      impact: "HIGH",
      nextAction: `Model the next video on “${winners[0].title ?? winners[0].videoId}”.`,
    });
  }

  const losers = diagnoses.filter((d) => d.status === "UNDERPERFORMING");
  if (losers[0]) {
    out.push({
      key: "CONTENT:fix-losers",
      type: "CONTENT",
      title: "Fix the weakest observed signal on underperforming uploads",
      explanation: `${losers.length} video(s) fell short of comparable baselines. Weakest signal: ${losers[0].negativeSignals[0] ?? losers[0].explanation}`,
      evidence: losers
        .slice(0, 3)
        .map((d) => ({ label: d.title ?? d.videoId, detail: d.explanation })),
      confidence: losers[0].confidence,
      confidenceScore: losers[0].confidenceScore,
      impact: "MEDIUM",
      nextAction: losers[0].recommendedAction,
    });
  }

  return out.sort((a, b) => b.confidenceScore - a.confidenceScore);
}
