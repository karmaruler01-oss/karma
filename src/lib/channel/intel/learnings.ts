// Learning lifecycle.
//
// Patterns observed in one sync are only *candidates*. A statement graduates to
// EMERGING and then CONFIRMED when repeated syncs keep observing it, gets
// CONTRADICTED when the direction flips, and goes STALE when the channel stops
// producing evidence for it.

import type { BrainConfig } from "../config";
import type { Evidence } from "../types";
import { levelFromScore } from "./confidence";
import type { LearningRecord, LearningStatus, PatternFinding, PatternType } from "./types";

export const INTEL_LEARNING_CATEGORY = "intel_learning";

const PATTERN_TYPES: PatternType[] = ["TOPIC", "TITLE", "FORMAT", "PUBLISHING"];

function isPatternType(value: unknown): value is PatternType {
  return typeof value === "string" && (PATTERN_TYPES as string[]).includes(value);
}

function isStatus(value: unknown): value is LearningStatus {
  return (
    value === "CANDIDATE" ||
    value === "EMERGING" ||
    value === "CONFIRMED" ||
    value === "CONTRADICTED" ||
    value === "STALE"
  );
}

/** Rebuilds a learning record from a persisted row (never invents fields). */
export function rowToLearningRecord(row: {
  statement: string;
  state: string;
  confidence: number;
  evidence: Record<string, unknown>;
  observedAt: string;
}): LearningRecord | null {
  const evidence = row.evidence as Partial<LearningRecord> & { evidence?: Evidence[] };
  if (typeof evidence.key !== "string" || !isPatternType(evidence.type)) return null;
  const status = isStatus(row.state) ? row.state : "CANDIDATE";
  return {
    key: evidence.key,
    type: evidence.type,
    observation: row.statement,
    evidence: Array.isArray(evidence.evidence) ? evidence.evidence : [],
    confidence: levelFromScore(row.confidence),
    confidenceScore: row.confidence,
    status,
    direction: evidence.direction === "NEGATIVE" ? "NEGATIVE" : "POSITIVE",
    sampleSize: typeof evidence.sampleSize === "number" ? evidence.sampleSize : 0,
    occurrences: typeof evidence.occurrences === "number" ? evidence.occurrences : 1,
    contradictions: typeof evidence.contradictions === "number" ? evidence.contradictions : 0,
    sourceVideos: Array.isArray(evidence.sourceVideos) ? evidence.sourceVideos : [],
    createdAt: typeof evidence.createdAt === "string" ? evidence.createdAt : row.observedAt,
    updatedAt: typeof evidence.updatedAt === "string" ? evidence.updatedAt : row.observedAt,
    lastObservedAt:
      typeof evidence.lastObservedAt === "string" ? evidence.lastObservedAt : row.observedAt,
    fingerprint: typeof evidence.fingerprint === "string" ? evidence.fingerprint : null,
  };
}

/**
 * Stable signature of the evidence behind a finding. Two runs over unchanged
 * data produce the same fingerprint, which is how repeated syncs avoid
 * inflating occurrence counts.
 */
export function findingFingerprint(finding: PatternFinding): string {
  return [
    finding.key,
    finding.direction,
    finding.sampleSize,
    finding.deltaPercent,
    [...finding.videoIds].sort().join(","),
  ].join("|");
}

/** Serializes a learning record into the persisted learning-row shape. */
export function learningRecordToRow(record: LearningRecord): {
  category: string;
  statement: string;
  state: LearningStatus;
  confidence: number;
  evidence: Record<string, unknown>;
  observedAt: string;
} {
  return {
    category: INTEL_LEARNING_CATEGORY,
    statement: record.observation,
    state: record.status,
    confidence: record.confidenceScore,
    evidence: {
      key: record.key,
      type: record.type,
      direction: record.direction,
      sampleSize: record.sampleSize,
      occurrences: record.occurrences,
      contradictions: record.contradictions,
      sourceVideos: record.sourceVideos,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastObservedAt: record.lastObservedAt,
      fingerprint: record.fingerprint,
      evidence: record.evidence,
    },
    observedAt: record.lastObservedAt,
  };
}


function nextStatus(
  occurrences: number,
  confidenceScore: number,
  config: BrainConfig,
): LearningStatus {
  if (occurrences >= config.learningConfirmedOccurrences && confidenceScore >= 0.6) {
    return "CONFIRMED";
  }
  if (occurrences >= config.learningEmergingOccurrences) return "EMERGING";
  return "CANDIDATE";
}

/**
 * Merges the patterns observed in this run with everything learned before.
 * Pure and idempotent-by-key: the same run applied twice produces the same
 * statuses given the same `now`, except for the occurrence counter which is
 * intentionally evidence-driven (one increment per observation run).
 */
export function mergeLearnings(
  previous: LearningRecord[],
  findings: PatternFinding[],
  config: BrainConfig,
  now: string,
): LearningRecord[] {
  const byKey = new Map(previous.map((record) => [record.key, record] as const));
  const seen = new Set<string>();
  const out: LearningRecord[] = [];

  for (const finding of findings) {
    seen.add(finding.key);
    const prior = byKey.get(finding.key);
    const fingerprint = findingFingerprint(finding);

    // Unchanged evidence is not a new observation: re-running a sync over the
    // same data must not inflate occurrences or reset the clock.
    if (prior && prior.fingerprint === fingerprint) {
      out.push(prior);
      continue;
    }

    if (!prior) {
      out.push({
        key: finding.key,
        type: finding.type,
        observation: finding.observation,
        evidence: finding.evidence,
        confidence: finding.confidence,
        confidenceScore: finding.confidenceScore,
        status: nextStatus(1, finding.confidenceScore, config),
        direction: finding.direction,
        sampleSize: finding.sampleSize,
        occurrences: 1,
        contradictions: 0,
        sourceVideos: finding.videoIds,
        createdAt: now,
        updatedAt: now,
        lastObservedAt: now,
        fingerprint,
      });
      continue;
    }

    const flipped = prior.direction !== finding.direction;
    const occurrences = flipped ? 1 : prior.occurrences + 1;
    const contradictions = prior.contradictions + (flipped ? 1 : 0);
    const status: LearningStatus = flipped
      ? "CONTRADICTED"
      : nextStatus(occurrences, finding.confidenceScore, config);

    out.push({
      key: finding.key,
      type: finding.type,
      observation: finding.observation,
      evidence: finding.evidence,
      confidence: finding.confidence,
      confidenceScore: finding.confidenceScore,
      status,
      direction: finding.direction,
      sampleSize: finding.sampleSize,
      occurrences,
      contradictions,
      sourceVideos: finding.videoIds,
      createdAt: prior.createdAt,
      updatedAt: now,
      lastObservedAt: now,
      fingerprint,
    });
  }

  // Statements not re-observed this run: keep them, but age them out.
  const staleMs = config.learningStaleDays * 86_400_000;
  for (const record of previous) {
    if (seen.has(record.key)) continue;
    const age = Date.parse(now) - Date.parse(record.lastObservedAt);
    const stale = Number.isFinite(age) && age > staleMs;
    out.push({
      ...record,
      status: stale ? "STALE" : record.status,
      updatedAt: stale ? now : record.updatedAt,
    });
  }

  return out.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

export function activeLearnings(records: LearningRecord[]): LearningRecord[] {
  return records.filter(
    (record) => record.status === "CONFIRMED" || record.status === "EMERGING",
  );
}
