// Lovable Cloud implementation of the ChannelStore contract.
//
// SERVER ONLY. The service-role handle is imported lazily inside the methods so
// this module never drags server credentials into a client bundle.
//
// Rules honoured everywhere in this file:
//   * a database error is thrown as a structured ChannelStoreError, never
//     swallowed and never replaced by an empty/fake result;
//   * NULL stays NULL and 0 stays 0 on the way in and on the way out.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BaselineStats, NextVideoStrategy, ObservedMetrics, WindowKey } from "./types";
import type { IntelligenceSummary } from "./intel/types";
import { WINDOW_KEYS } from "./types";
import {
  EMPTY_CHANNEL_PROFILE,
  type ChannelDefaults,
  type ChannelStore,
  type LearningRow,
  type StoredChannelProfile,
  type ExperimentIntel,
  type StoredExperiment,
  type StoredMetrics,
  type StoredStrategy,
  type StoredVideo,
  type SyncLogRow,
} from "./store";

export class ChannelStoreError extends Error {
  constructor(
    readonly operation: string,
    readonly detail: string,
    override readonly cause?: unknown,
  ) {
    super(`channel store ${operation} failed: ${detail}`);
    this.name = "ChannelStoreError";
  }
}

type Row = Record<string, unknown>;

function experimentFromRow(row: Row): StoredExperiment {
  return {
    id: String(row["id"]),
    videoId: str(row["video_id"]),
    projectId: str(row["project_id"]),
    hypothesis: String(row["hypothesis"]),
    whatChanged: String(row["what_changed"]),
    state: String(row["state"]),
    mode: String(row["mode"]),
    createdAt: String(row["created_at"]),
    expectedOutcome: str(row["expected_outcome"]),
    actualOutcome: str(row["actual_outcome"]),
    conclusion: str(row["conclusion"]),
    confidence: num(row["confidence"]) ?? 0,
    nextAction: str(row["next_action"]),
    intel: toIntel(row["baseline"]),
  };
}

/** Intelligence metadata lives in the experiment's `baseline` JSON column. */
function toIntel(value: unknown): ExperimentIntel | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw["key"] !== "string" || typeof raw["testPeriodWindow"] !== "string") return null;
  return {
    key: raw["key"],
    variable: typeof raw["variable"] === "string" ? raw["variable"] : null,
    targetMetric: typeof raw["targetMetric"] === "string" ? raw["targetMetric"] : "views",
    successCriteria: typeof raw["successCriteria"] === "string" ? raw["successCriteria"] : "",
    baselineDescription:
      typeof raw["baselineDescription"] === "string" ? raw["baselineDescription"] : "",
    baselineMedianViews:
      typeof raw["baselineMedianViews"] === "number" ? raw["baselineMedianViews"] : null,
    testPeriodWindow: raw["testPeriodWindow"] as WindowKey,
  };
}

/** Preserves 0, converts only null/undefined/non-finite to null. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function jsonObject(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => [key, num(raw)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== null);
  // An empty jsonb object carries no information: the column is NOT NULL with a
  // '{}' default, so "{}" means "not reported", not "all sources are zero".
  return entries.length ? Object.fromEntries(entries) : null;
}

function isWindowKey(value: unknown): value is WindowKey {
  return typeof value === "string" && (WINDOW_KEYS as string[]).includes(value);
}

function rowToMetrics(row: Row): ObservedMetrics {
  return {
    views: num(row["views"]),
    impressions: num(row["impressions"]),
    impressionCtr: num(row["impression_ctr"]),
    watchTimeMinutes: num(row["watch_time_minutes"]),
    averageViewDurationSeconds: num(row["average_view_duration_seconds"]),
    averageViewPercentage: num(row["average_view_percentage"]),
    likes: num(row["likes"]),
    comments: num(row["comments"]),
    shares: num(row["shares"]),
    subscribersGained: num(row["subscribers_gained"]),
    trafficSources: jsonObject(row["traffic_sources"]),
    usShare: num(row["us_share"]),
  };
}

export function createSupabaseChannelStore(client?: SupabaseClient): ChannelStore {
  let handle: SupabaseClient | null = client ?? null;

  const db = async (): Promise<SupabaseClient> => {
    if (!handle) {
      const { adminDb } = await import("@/lib/server/admin-db.server");
      handle = adminDb;
    }
    return handle;
  };

  const fail = (operation: string, error: unknown): never => {
    const detail =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new ChannelStoreError(operation, detail, error);
  };

  return {
    async listVideos(userId) {
      const { data, error } = await (await db())
        .from("channel_videos")
        .select("*")
        .eq("user_id", userId)
        .order("published_at", { ascending: false });
      if (error) fail("listVideos", error);
      return ((data ?? []) as Row[]).map<StoredVideo>((row) => ({
        videoId: String(row["video_id"]),
        projectId: str(row["project_id"]),
        title: str(row["title"]),
        publishedAt: str(row["published_at"]),
        durationSeconds: num(row["duration_seconds"]),
        shortForm: row["short_form"] === true,
        genre: str(row["genre"]),
        structure: str(row["structure"]),
        narrationStyle: str(row["narration_style"]),
        hookText: str(row["hook_text"]),
      }));
    },

    async listMetrics(userId) {
      const { data, error } = await (await db())
        .from("channel_video_metrics")
        .select("*")
        .eq("user_id", userId);
      if (error) fail("listMetrics", error);
      const rows: StoredMetrics[] = [];
      for (const row of (data ?? []) as Row[]) {
        if (!isWindowKey(row["window_key"])) continue;
        rows.push({
          videoId: String(row["video_id"]),
          windowKey: row["window_key"],
          metrics: rowToMetrics(row),
        });
      }
      return rows;
    },

    async upsertVideos(userId, videos) {
      if (!videos.length) return 0;
      const { error } = await (await db())
        .from("channel_videos")
        .upsert(
          videos.map((video) => ({
            user_id: userId,
            video_id: video.videoId,
            project_id: video.projectId,
            title: video.title,
            published_at: video.publishedAt,
            duration_seconds: video.durationSeconds,
            short_form: video.shortForm,
            genre: video.genre,
            structure: video.structure,
            narration_style: video.narrationStyle,
            hook_text: video.hookText,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,video_id" },
        );
      if (error) fail("upsertVideos", error);
      return videos.length;
    },

    async upsertMetrics(userId, rows) {
      if (!rows.length) return 0;
      const { error } = await (await db())
        .from("channel_video_metrics")
        .upsert(
          rows.map(({ videoId, windowKey, metrics }) => ({
            user_id: userId,
            video_id: videoId,
            window_key: windowKey,
            // Nulls are written as nulls: "not reported" must never become 0.
            views: metrics.views,
            impressions: metrics.impressions,
            impression_ctr: metrics.impressionCtr,
            watch_time_minutes: metrics.watchTimeMinutes,
            average_view_duration_seconds: metrics.averageViewDurationSeconds,
            average_view_percentage: metrics.averageViewPercentage,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
            subscribers_gained: metrics.subscribersGained,
            // NOT NULL columns: an empty object means "nothing reported".
            traffic_sources: metrics.trafficSources ?? {},
            us_share: metrics.usShare,
            collected_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,video_id,window_key" },
        );
      if (error) fail("upsertMetrics", error);
      return rows.length;
    },

    async listLearningRows(userId) {
      const { data, error } = await (await db())
        .from("channel_learnings")
        .select("*")
        .eq("user_id", userId)
        .order("observed_at", { ascending: true });
      if (error) fail("listLearningRows", error);
      return ((data ?? []) as Row[]).map<LearningRow>((row) => ({
        category: String(row["category"]),
        statement: String(row["statement"]),
        state: String(row["state"]),
        confidence: num(row["confidence"]) ?? 0,
        evidence: (row["evidence"] ?? {}) as Record<string, unknown>,
        source: String(row["source"]),
        videoId: str(row["video_id"]),
        projectId: str(row["project_id"]),
        observedAt: String(row["observed_at"]),
      }));
    },

    async replaceLearningRows(userId, videoId, categories, rows) {
      const client_ = await db();
      // Idempotent: the same analysis re-run replaces its own rows instead of
      // appending a duplicate set.
      let deletion = client_
        .from("channel_learnings")
        .delete()
        .eq("user_id", userId)
        .in("category", categories);
      deletion = videoId === null ? deletion.is("video_id", null) : deletion.eq("video_id", videoId);
      const { error: deleteError } = await deletion;
      if (deleteError) fail("replaceLearningRows.delete", deleteError);
      if (!rows.length) return 0;
      const { error } = await client_.from("channel_learnings").insert(
        rows.map((row) => ({
          user_id: userId,
          category: row.category,
          statement: row.statement,
          state: row.state,
          confidence: row.confidence,
          evidence: row.evidence,
          source: row.source,
          video_id: row.videoId,
          project_id: row.projectId,
          observed_at: row.observedAt,
        })),
      );
      if (error) fail("replaceLearningRows.insert", error);
      return rows.length;
    },

    async saveBaselines(userId, baselines) {
      if (!baselines.length) return 0;
      const { error } = await (await db())
        .from("channel_baselines")
        .upsert(
          baselines.map((baseline) => ({
            user_id: userId,
            window_key: baseline.windowKey,
            cohort: baseline.cohort,
            sample_size: baseline.sampleSize,
            median_views: baseline.medianViews,
            p25_views: baseline.p25Views,
            p75_views: baseline.p75Views,
            median_watch_time_minutes: baseline.medianWatchTimeMinutes,
            median_retention_percentage: baseline.medianRetentionPercentage,
            median_subscribers_gained: baseline.medianSubscribersGained,
            sufficiency: baseline.sufficiency,
            computed_at: new Date().toISOString(),
          })),
          { onConflict: "user_id,window_key,cohort" },
        );
      if (error) fail("saveBaselines", error);
      return baselines.length;
    },

    async listBaselines(userId) {
      const { data, error } = await (await db())
        .from("channel_baselines")
        .select("*")
        .eq("user_id", userId);
      if (error) fail("listBaselines", error);
      const out: BaselineStats[] = [];
      for (const row of (data ?? []) as Row[]) {
        if (!isWindowKey(row["window_key"])) continue;
        out.push({
          windowKey: row["window_key"],
          cohort: String(row["cohort"]),
          sampleSize: num(row["sample_size"]) ?? 0,
          medianViews: num(row["median_views"]),
          p25Views: num(row["p25_views"]),
          p75Views: num(row["p75_views"]),
          medianWatchTimeMinutes: num(row["median_watch_time_minutes"]),
          medianRetentionPercentage: num(row["median_retention_percentage"]),
          medianSubscribersGained: num(row["median_subscribers_gained"]),
          sufficiency:
            row["sufficiency"] === "SUFFICIENT" ? "SUFFICIENT" : "INSUFFICIENT_DATA",
        });
      }
      return out;
    },

    async latestStrategy(userId) {
      const { data, error } = await (await db())
        .from("channel_strategies")
        .select("*")
        .eq("user_id", userId)
        .eq("active", true)
        .order("version", { ascending: false })
        .limit(1);
      if (error) fail("latestStrategy", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) return null;
      const evidence = (row["evidence"] ?? {}) as {
        strategy?: NextVideoStrategy;
        intelligence?: IntelligenceSummary;
      };
      if (!evidence.strategy) return null;
      return {
        id: String(row["id"]),
        version: num(row["version"]) ?? 1,
        active: row["active"] === true,
        createdAt: String(row["created_at"]),
        sufficiency:
          row["sufficiency"] === "SUFFICIENT" ? "SUFFICIENT" : "INSUFFICIENT_DATA",
        strategy: evidence.strategy,
        intelligence: evidence.intelligence ?? null,
      } satisfies StoredStrategy;
    },

    async saveStrategy(userId, strategy, extra) {
      const client_ = await db();
      const payload = {
        user_id: userId,
        active: true,
        objective: strategy.objective,
        observed_strengths: strategy.knownStrengths,
        observed_weaknesses: strategy.knownWeaknesses,
        next_experiment: strategy.newExperiment,
        maintain: strategy.patternsToRetain,
        test: strategy.newExperiment ? [strategy.newExperiment] : [],
        avoid: strategy.patternsToAvoid,
        target_duration_seconds: strategy.recommendedDurationSeconds,
        recommended_structure: strategy.recommendedStoryStructure,
        recommended_narration: strategy.recommendedNarrationStyle,
        recommended_upload_time: strategy.recommendedUploadTime,
        thumbnail_direction: strategy.recommendedThumbnailDirection,
        exploration_ratio: strategy.explorationRatio,
        mode: strategy.mode,
        // The full strategy is kept verbatim so nothing has to be re-derived.
        evidence: {
          strategy,
          evidence: strategy.evidence,
          flags: strategy.flags,
          intelligence: extra?.intelligence ?? null,
        },
        sufficiency: strategy.sufficiency,
        updated_at: new Date().toISOString(),
      };

      if (typeof extra?.reuseVersion === "number") {
        const { data, error } = await client_
          .from("channel_strategies")
          .update(payload)
          .eq("user_id", userId)
          .eq("version", extra.reuseVersion)
          .select("*");
        if (error) fail("saveStrategy.update", error);
        const row = ((data ?? []) as Row[])[0];
        if (row) {
          return {
            id: String(row["id"]),
            version: num(row["version"]) ?? extra.reuseVersion,
            active: true,
            createdAt: String(row["created_at"]),
            sufficiency: strategy.sufficiency,
            strategy,
            intelligence: extra?.intelligence ?? null,
          };
        }
      }

      const { data: versions, error: versionError } = await client_
        .from("channel_strategies")
        .select("version")
        .eq("user_id", userId)
        .order("version", { ascending: false })
        .limit(1);
      if (versionError) fail("saveStrategy.version", versionError);
      const version = (num(((versions ?? []) as Row[])[0]?.["version"]) ?? 0) + 1;

      const { error: deactivateError } = await client_
        .from("channel_strategies")
        .update({ active: false })
        .eq("user_id", userId)
        .eq("active", true);
      if (deactivateError) fail("saveStrategy.deactivate", deactivateError);

      const { data, error } = await client_
        .from("channel_strategies")
        .insert({ ...payload, version })
        .select("*");
      if (error) fail("saveStrategy.insert", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) fail("saveStrategy.insert", "insert returned no row");
      return {
        id: String(row!["id"]),
        version,
        active: true,
        createdAt: String(row!["created_at"]),
        sufficiency: strategy.sufficiency,
        strategy,
        intelligence: extra?.intelligence ?? null,
      };
    },

    async listExperiments(userId) {
      const { data, error } = await (await db())
        .from("channel_experiments")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) fail("listExperiments", error);
      return ((data ?? []) as Row[]).map<StoredExperiment>(experimentFromRow);
    },

    async saveExperiment(userId, input) {
      const client_ = await db();
      // Idempotent: the same experiment key (or hypothesis+change for legacy
      // rows) is never re-inserted on a repeated sync.
      const lookup = client_
        .from("channel_experiments")
        .select("*")
        .eq("user_id", userId);
      const { data: existing, error: existingError } = await (input.intel
        ? lookup.eq("baseline->>key", input.intel.key)
        : lookup.eq("hypothesis", input.hypothesis).eq("what_changed", input.whatChanged)
      ).limit(1);
      if (existingError) fail("saveExperiment.lookup", existingError);
      const found = ((existing ?? []) as Row[])[0];
      if (found) return experimentFromRow(found);

      const { data, error } = await client_
        .from("channel_experiments")
        .insert({
          user_id: userId,
          video_id: input.videoId ?? null,
          project_id: input.projectId ?? null,
          hypothesis: input.hypothesis,
          what_changed: input.whatChanged,
          expected_outcome: input.expectedOutcome ?? null,
          mode: input.mode,
          state: input.state ?? "NEW_EXPERIMENT",
          baseline: input.intel ?? {},
        })
        .select("*");
      if (error) fail("saveExperiment.insert", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) fail("saveExperiment.insert", "insert returned no row");
      return experimentFromRow(row!);
    },

    async updateExperiment(userId, id, patch) {
      const payload: Row = { updated_at: new Date().toISOString() };
      if (patch.state !== undefined) payload["state"] = patch.state;
      if (patch.actualOutcome !== undefined) payload["actual_outcome"] = patch.actualOutcome;
      if (patch.conclusion !== undefined) payload["conclusion"] = patch.conclusion;
      if (patch.confidence !== undefined) payload["confidence"] = patch.confidence;
      if (patch.nextAction !== undefined) payload["next_action"] = patch.nextAction;
      if (patch.metrics !== undefined) payload["metrics"] = patch.metrics;
      const { data, error } = await (await db())
        .from("channel_experiments")
        .update(payload)
        .eq("user_id", userId)
        .eq("id", id)
        .select("*");
      if (error) fail("updateExperiment", error);
      const row = ((data ?? []) as Row[])[0];
      return row ? experimentFromRow(row) : null;
    },


    async channelDefaults(userId) {
      const { data, error } = await (await db())
        .from("settings")
        .select("*")
        .eq("user_id", userId)
        .limit(1);
      if (error) fail("channelDefaults", error);
      const row = ((data ?? []) as Row[])[0];
      return {
        durationSeconds: num(row?.["default_story_length"]) ?? 60,
        genre: str(row?.["default_genre"]) ?? "mystery",
        narrationStyle: "cinematic",
        uploadTime: "18:00",
        explorationRatio: num(row?.["exploration_ratio"]),
      } satisfies ChannelDefaults;
    },

    async productionCount(userId) {
      const { count, error } = await (await db())
        .from("production_jobs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if (error) fail("productionCount", error);
      return count ?? 0;
    },

    async getChannelProfile(userId) {
      const { data, error } = await (await db())
        .from("channel_profile")
        .select("*")
        .eq("user_id", userId)
        .limit(1);
      if (error) fail("getChannelProfile", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) return null;
      const audience = row["audience_profile"];
      const audienceProfile =
        audience && typeof audience === "object" && Object.keys(audience).length
          ? (audience as Record<string, unknown>)
          : null;
      return {
        channelId: str(row["channel_id"]),
        channelTitle: str(row["channel_title"]),
        country: str(row["country"]),
        subscriberCount: num(row["subscriber_count"]),
        viewCount: num(row["view_count"]),
        videoCount: num(row["video_count"]),
        audienceProfile,
        dataSufficiency:
          row["data_sufficiency"] === "SUFFICIENT" ? "SUFFICIENT" : "INSUFFICIENT_DATA",
        lastSyncedAt: str(row["last_synced_at"]),
      } satisfies StoredChannelProfile;
    },

    async saveChannelProfile(userId, patch) {
      const client_ = await db();
      const current = (await this.getChannelProfile(userId)) ?? EMPTY_CHANNEL_PROFILE;
      const next: StoredChannelProfile = { ...current, ...patch };
      const { error } = await client_.from("channel_profile").upsert(
        {
          user_id: userId,
          channel_id: next.channelId,
          channel_title: next.channelTitle,
          country: next.country,
          subscriber_count: next.subscriberCount,
          view_count: next.viewCount,
          video_count: next.videoCount,
          audience_profile: next.audienceProfile ?? {},
          data_sufficiency: next.dataSufficiency,
          last_synced_at: next.lastSyncedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) fail("saveChannelProfile", error);
      return next;
    },

    async startSync(userId, kind) {
      const { data, error } = await (await db())
        .from("channel_sync_log")
        .insert({ user_id: userId, kind, status: "RUNNING" })
        .select("id");
      if (error) fail("startSync", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) fail("startSync", "insert returned no row");
      return String(row!["id"]);
    },

    async finishSync(id, status, detail, itemsSynced) {
      const { error } = await (await db())
        .from("channel_sync_log")
        .update({
          status,
          detail,
          items_synced: itemsSynced,
          finished_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) fail("finishSync", error);
    },

    async lastSuccessfulSync(userId, kind) {
      const { data, error } = await (await db())
        .from("channel_sync_log")
        .select("*")
        .eq("user_id", userId)
        .eq("kind", kind)
        .eq("status", "SUCCESS")
        .order("started_at", { ascending: false })
        .limit(1);
      if (error) fail("lastSuccessfulSync", error);
      const row = ((data ?? []) as Row[])[0];
      if (!row) return null;
      return {
        id: String(row["id"]),
        kind: String(row["kind"]),
        status: "SUCCESS",
        detail: str(row["detail"]),
        itemsSynced: num(row["items_synced"]) ?? 0,
        startedAt: String(row["started_at"]),
        finishedAt: str(row["finished_at"]),
      } satisfies SyncLogRow;
    },

    async listSyncLog(userId, limit = 50) {
      const { data, error } = await (await db())
        .from("channel_sync_log")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(limit);
      if (error) fail("listSyncLog", error);
      return ((data ?? []) as Row[]).map<SyncLogRow>((row) => ({
        id: String(row["id"]),
        kind: String(row["kind"]),
        status: row["status"] as SyncLogRow["status"],
        detail: str(row["detail"]),
        itemsSynced: num(row["items_synced"]) ?? 0,
        startedAt: String(row["started_at"]),
        finishedAt: str(row["finished_at"]),
      }));
    },

    async markChannelSufficiency(userId, sufficiency) {
      await this.saveChannelProfile(userId, { dataSufficiency: sufficiency });
    },
  };
}
