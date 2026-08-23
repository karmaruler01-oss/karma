// Brain intelligence orchestrator.
//
// One entry point that turns everything already synced into a persisted,
// structured understanding of the channel:
//
//   facts → normalized metrics → cohorts → diagnostics → patterns →
//   learnings → experiments → strategy summary → persistence
//
// Guarantees:
//   * pure analysis modules stay pure — this file owns all IO,
//   * running it twice over unchanged data produces the same stored state
//     (no duplicate learnings, no duplicate experiments, no new strategy
//     version),
//   * nothing is invented: when evidence is missing the summary says
//     INSUFFICIENT_DATA and explains what is missing.

import { resolveBrainConfig, type BrainConfig, type BrainConfigOverrides } from "../config";
import { selectWindow } from "../brain";
import type { ChannelStore, ExperimentIntel, StoredExperiment } from "../store";
import type { VideoFacts, WindowKey } from "../types";
import { buildCohorts } from "./cohorts";
import { diagnoseVideo } from "./diagnostics";
import {
  EXPERIMENT_KEY_PREFIX,
  evaluateExperiment,
  proposeExperiments,
  type EvaluableExperiment,
} from "./experiments";
import {
  INTEL_LEARNING_CATEGORY,
  learningRecordToRow,
  mergeLearnings,
  rowToLearningRecord,
} from "./learnings";
import { detectPatterns } from "./patterns";
import { buildRecommendations } from "./recommendations";
import { assessDataQuality, buildIntelligenceSummary, buildStrategySummary } from "./strategy";
import type {
  ExperimentPlan,
  ExperimentStatus,
  IntelligenceSummary,
  LearningRecord,
  StoredExperimentView,
  VideoDiagnosis,
} from "./types";

export interface BrainCycleDeps {
  store?: ChannelStore;
  now?: Date | string;
  config?: BrainConfigOverrides | null;
  /** Discards previously derived learnings and rebuilds them from scratch. */
  rebuild?: boolean;
}

export interface BrainCycleResult {
  summary: IntelligenceSummary;
  diagnoses: VideoDiagnosis[];
  persisted: {
    learningRows: number;
    experimentsCreated: number;
    experimentsUpdated: number;
    strategyVersion: number | null;
  };
}

interface Resolved {
  store: ChannelStore;
  now: string;
  config: BrainConfig;
}

async function resolve(deps?: BrainCycleDeps): Promise<Resolved> {
  const now =
    deps?.now === undefined
      ? new Date().toISOString()
      : typeof deps.now === "string"
        ? deps.now
        : deps.now.toISOString();
  let store = deps?.store;
  if (!store) {
    const { createSupabaseChannelStore } = await import("../store.supabase");
    store = createSupabaseChannelStore();
  }
  return { store, now, config: resolveBrainConfig(deps?.config ?? null) };
}

const STATUS_VALUES: ExperimentStatus[] = [
  "PROPOSED",
  "ACTIVE",
  "COMPLETED",
  "INCONCLUSIVE",
  "REJECTED",
];

function toStatus(state: string): ExperimentStatus {
  return (STATUS_VALUES as string[]).includes(state)
    ? (state as ExperimentStatus)
    : state === "NEW_EXPERIMENT" || state === "INITIAL_EXPERIMENT"
      ? "PROPOSED"
      : "ACTIVE";
}

function confidenceLevel(score: number): StoredExperimentView["confidence"] {
  if (score >= 0.75) return "HIGH";
  if (score >= 0.45) return "MEDIUM";
  return "LOW";
}

/** Only experiments created by the intelligence layer carry `intel`. */
function toExperimentView(
  row: StoredExperiment,
  fallbackWindow: WindowKey,
): StoredExperimentView {
  const intel = row.intel;
  return {
    id: row.id,
    key: intel?.key ?? `${EXPERIMENT_KEY_PREFIX}legacy:${row.id}`,
    hypothesis: row.hypothesis,
    whatChanged: row.whatChanged,
    variable: intel?.variable ?? null,
    status: toStatus(row.state),
    targetMetric: intel?.targetMetric ?? "views",
    successCriteria: intel?.successCriteria ?? "No success criteria was recorded.",
    baselineMedianViews: intel?.baselineMedianViews ?? null,
    testPeriodWindow: intel?.testPeriodWindow ?? fallbackWindow,
    actualOutcome: row.actualOutcome,
    conclusion: row.conclusion,
    confidence: confidenceLevel(row.confidence),
    confidenceScore: row.confidence,
    startedAt: row.createdAt,
  };
}

function toEvaluable(view: StoredExperimentView): EvaluableExperiment {
  return {
    id: view.id,
    key: view.key,
    hypothesis: view.hypothesis,
    whatChanged: view.whatChanged,
    variable: view.variable,
    status: view.status,
    baselineMedianViews: view.baselineMedianViews,
    targetMetric: view.targetMetric,
    successCriteria: view.successCriteria,
    testPeriodWindow: view.testPeriodWindow,
    startedAt: view.startedAt,
  };
}

function planToIntel(plan: ExperimentPlan): ExperimentIntel {
  return {
    key: plan.key,
    variable: plan.variable,
    targetMetric: plan.targetMetric,
    successCriteria: plan.successCriteria,
    baselineDescription: plan.baselineDescription,
    baselineMedianViews: plan.baselineMedianViews,
    testPeriodWindow: plan.testPeriodWindow,
  };
}

/** The window most videos can actually be judged in; falls back to "24h". */
function dominantWindow(
  videos: VideoFacts[],
  now: string,
  config: BrainConfig,
): WindowKey | null {
  const counts = new Map<WindowKey, number>();
  for (const video of videos) {
    const selection = selectWindow(video, now, config);
    if (!selection.windowKey) continue;
    counts.set(selection.windowKey, (counts.get(selection.windowKey) ?? 0) + 1);
  }
  let best: WindowKey | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Runs one full intelligence cycle for a user and persists the result.
 * Safe to call after every sync.
 */
export async function runBrainCycle(
  userId: string,
  deps?: BrainCycleDeps,
): Promise<BrainCycleResult> {
  const { store, now, config } = await resolve(deps);
  const rebuild = deps?.rebuild === true;

  const [videos, metricRows, learningRows, profile, storedExperiments, strategyRow] =
    await Promise.all([
      store.listVideos(userId),
      store.listMetrics(userId),
      store.listLearningRows(userId),
      store.getChannelProfile(userId),
      store.listExperiments(userId),
      store.latestStrategy(userId),
    ]);

  const { buildFacts } = await import("../brain.server");
  const bundle = buildFacts(videos, metricRows);
  const facts = bundle.facts;

  const quality = assessDataQuality({
    videos: facts,
    unusableVideoIds: bundle.unusableVideoIds,
    lastSyncedAt: profile?.lastSyncedAt ?? null,
    now,
    config,
  });

  const windowKey = dominantWindow(facts, now, config);
  const effectiveWindow: WindowKey = windowKey ?? "24h";

  // --- cohorts + per-video diagnostics ------------------------------------
  const cohorts = windowKey ? buildCohorts(facts, windowKey, config) : [];
  const diagnoses: VideoDiagnosis[] = facts.map((video) => {
    const selection = selectWindow(video, now, config);
    const videoWindow = selection.windowKey;
    const cohortsForVideo =
      videoWindow === null
        ? []
        : videoWindow === windowKey
          ? cohorts
          : buildCohorts(facts, videoWindow, config);
    return diagnoseVideo(video, cohortsForVideo, videoWindow, config, now);
  });

  // --- patterns → learnings ------------------------------------------------
  const findings = windowKey ? detectPatterns(facts, windowKey, config, now) : [];
  const previousLearnings: LearningRecord[] = rebuild
    ? []
    : learningRows
        .filter((row) => row.category === INTEL_LEARNING_CATEGORY)
        .map((row) =>
          rowToLearningRecord({
            statement: row.statement,
            state: row.state,
            confidence: row.confidence,
            evidence: row.evidence,
            observedAt: row.observedAt,
          }),
        )
        .filter((record): record is LearningRecord => record !== null);

  const learnings = mergeLearnings(previousLearnings, findings, config, now);

  const persistedLearningRows = await store.replaceLearningRows(
    userId,
    null,
    [INTEL_LEARNING_CATEGORY],
    learnings.map((record) => ({
      ...learningRecordToRow(record),
      source: "channel_brain_intel",
      videoId: null,
      projectId: null,
    })),
  );

  // --- experiments: evaluate what is open, propose what is missing ---------
  const views = storedExperiments.map((row) => toExperimentView(row, effectiveWindow));
  let experimentsUpdated = 0;
  const evaluatedViews: StoredExperimentView[] = [];
  for (const view of views) {
    if (view.status !== "PROPOSED" && view.status !== "ACTIVE") {
      evaluatedViews.push(view);
      continue;
    }
    const evaluation = evaluateExperiment(toEvaluable(view), facts, config);
    const changed =
      evaluation.status !== view.status ||
      evaluation.conclusion !== view.conclusion ||
      evaluation.actualOutcome !== view.actualOutcome;
    if (changed && view.id) {
      await store.updateExperiment(userId, view.id, {
        state: evaluation.status,
        actualOutcome: evaluation.actualOutcome,
        conclusion: evaluation.conclusion,
        confidence: evaluation.confidenceScore,
        nextAction:
          evaluation.status === "COMPLETED"
            ? "Apply this change again and confirm it holds."
            : evaluation.status === "REJECTED"
              ? "Stop applying this change."
              : "Keep the change in place until enough uploads exist to judge it.",
      });
      experimentsUpdated += 1;
    }
    evaluatedViews.push({
      ...view,
      status: evaluation.status,
      actualOutcome: evaluation.actualOutcome,
      conclusion: evaluation.conclusion,
      confidence: evaluation.confidence,
      confidenceScore: evaluation.confidenceScore,
    });
  }

  const openKeys = new Set(
    evaluatedViews
      .filter((view) => view.status === "PROPOSED" || view.status === "ACTIVE")
      .map((view) => view.key),
  );
  const proposals = proposeExperiments({
    learnings,
    findings,
    cohorts,
    quality,
    windowKey: effectiveWindow,
    config,
  }).filter((plan) => !openKeys.has(plan.key));

  let experimentsCreated = 0;
  const createdViews: StoredExperimentView[] = [];
  for (const plan of proposals) {
    const saved = await store.saveExperiment(userId, {
      hypothesis: plan.hypothesis,
      whatChanged: plan.whatChanged,
      expectedOutcome: plan.successCriteria,
      mode: quality.smallSample ? "EXPLORATION" : "EXPLOITATION",
      state: "PROPOSED",
      intel: planToIntel(plan),
    });
    if (!views.some((view) => view.id === saved.id)) experimentsCreated += 1;
    createdViews.push(toExperimentView(saved, effectiveWindow));
  }

  const allExperiments = [...evaluatedViews, ...createdViews];

  // --- summaries ------------------------------------------------------------
  const strategySummary = buildStrategySummary({
    now,
    diagnoses,
    findings,
    learnings,
    experiments: allExperiments,
    quality,
    windowKey,
  });

  const recommendations = buildRecommendations(learnings, diagnoses, quality);

  const status: IntelligenceSummary["status"] =
    quality.videosTotal === 0
      ? "SYNC_REQUIRED"
      : strategySummary.sufficiency === "INSUFFICIENT_DATA"
        ? "INSUFFICIENT_DATA"
        : "READY";

  const summary = buildIntelligenceSummary({
    now,
    status,
    diagnoses,
    findings,
    learnings,
    experiments: allExperiments,
    quality,
    windowKey,
    strategySummary,
    recommendations,
    proposals: [],
    lastAnalysisAt: strategyRow?.intelligence?.generatedAt ?? null,
  });

  // The summary rides along with the *existing* strategy version so repeated
  // syncs never inflate strategy history.
  let strategyVersion: number | null = null;
  if (strategyRow) {
    const saved = await store.saveStrategy(userId, strategyRow.strategy, {
      reuseVersion: strategyRow.version,
      intelligence: summary,
    });
    strategyVersion = saved.version;
  }

  return {
    summary,
    diagnoses,
    persisted: {
      learningRows: persistedLearningRows,
      experimentsCreated,
      experimentsUpdated,
      strategyVersion,
    },
  };
}

/** Read-only accessor used by the Brain read API and the Settings UI. */
export async function readBrainSummary(
  userId: string,
  deps?: BrainCycleDeps,
): Promise<IntelligenceSummary | null> {
  const { store } = await resolve(deps);
  const strategy = await store.latestStrategy(userId);
  return strategy?.intelligence ?? null;
}
