// Confidence scoring.
//
// One scorer for the whole intelligence layer so a "HIGH confidence" learning
// always means the same thing: enough samples, a consistent signal, a large
// enough effect, recent data and reasonably complete metrics.

import type { Confidence } from "../types";

export interface ConfidenceInput {
  /** How many real videos back the statement. */
  sampleSize: number;
  /** Share of those videos pointing the same way, 0..1. */
  consistency?: number;
  /** |effect| expressed as a percentage difference vs the comparison group. */
  effectPercent?: number;
  /** Share of expected metric fields that were actually reported, 0..1. */
  completeness?: number;
  /** Days since the newest supporting observation. */
  recencyDays?: number;
  /** True when a deliberate experiment produced the evidence. */
  experimentBacked?: boolean;
}

export interface ConfidenceResult {
  score: number; // 0..1
  level: Confidence;
  reasons: string[];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  const sample = clamp01(input.sampleSize / 8);
  reasons.push(`${input.sampleSize} supporting video(s)`);

  const consistency = clamp01(input.consistency ?? 0.5);
  if (input.consistency !== undefined) {
    reasons.push(`${Math.round(consistency * 100)}% of them point the same way`);
  }

  const effect = clamp01(Math.abs(input.effectPercent ?? 0) / 60);
  if (input.effectPercent !== undefined) {
    reasons.push(`effect size ${Math.round(input.effectPercent)}%`);
  }

  const completeness = clamp01(input.completeness ?? 0.5);
  const recency =
    input.recencyDays === undefined ? 0.5 : clamp01(1 - input.recencyDays / 90);
  if (input.recencyDays !== undefined) {
    reasons.push(`newest evidence ${Math.round(input.recencyDays)} day(s) old`);
  }

  let score =
    sample * 0.35 + consistency * 0.25 + effect * 0.2 + completeness * 0.1 + recency * 0.1;

  if (input.experimentBacked) {
    score = clamp01(score + 0.1);
    reasons.push("verified by a deliberate experiment");
  }

  // A statement backed by fewer than three videos can never be HIGH.
  const level: Confidence =
    input.sampleSize < 3 || score < 0.4 ? "LOW" : score < 0.7 ? "MEDIUM" : "HIGH";

  return { score: Math.round(clamp01(score) * 1000) / 1000, level, reasons };
}

export function levelFromScore(score: number): Confidence {
  return score < 0.4 ? "LOW" : score < 0.7 ? "MEDIUM" : "HIGH";
}
