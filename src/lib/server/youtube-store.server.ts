// Server-only persistence for the YouTube connection tables.
//
// youtube_connections and youtube_oauth_states hold OAuth credentials, so they
// have no RLS policies at all: they are reachable exclusively through the
// service-role handle used here. Tokens are never returned to the browser.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  OAuthStateRecord,
  RawMetricsRow,
  StoredConnection,
  VideoExtrasRow,
  YouTubeConnectionStore,
} from "./youtube.server";

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toConnection(row: Row): StoredConnection {
  const status = str(row["status"]);
  return {
    userId: String(row["user_id"]),
    channelId: str(row["channel_id"]),
    channelTitle: str(row["channel_title"]),
    accessToken: str(row["access_token"]),
    refreshToken: str(row["refresh_token"]),
    tokenExpiresAt: str(row["token_expires_at"]),
    scope: str(row["scope"]),
    status:
      status === "NEEDS_RECONNECT" || status === "ERROR" ? status : "CONNECTED",
    error: str(row["error"]),
    connectedAt: str(row["connected_at"]),
  };
}

const COLUMN: Record<keyof StoredConnection, string> = {
  userId: "user_id",
  channelId: "channel_id",
  channelTitle: "channel_title",
  accessToken: "access_token",
  refreshToken: "refresh_token",
  tokenExpiresAt: "token_expires_at",
  scope: "scope",
  status: "status",
  error: "error",
  connectedAt: "connected_at",
};

export function createSupabaseYouTubeConnectionStore(
  client?: SupabaseClient,
): YouTubeConnectionStore {
  let handle: SupabaseClient | null = client ?? null;
  const db = async (): Promise<SupabaseClient> => {
    if (!handle) {
      const { adminDb } = await import("./admin-db.server");
      handle = adminDb;
    }
    return handle;
  };

  const fail = (operation: string, error: unknown): never => {
    const detail =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    throw new Error(`youtube_store_${operation}: ${detail}`);
  };

  return {
    async createOAuthState(record: OAuthStateRecord) {
      const { error } = await (await db()).from("youtube_oauth_states").insert({
        state: record.state,
        user_id: record.userId,
        redirect_uri: record.redirectUri,
        created_at: record.createdAt,
      });
      if (error) fail("createOAuthState", error);
    },

    async consumeOAuthState(state: string) {
      const client_ = await db();
      const { data, error } = await client_
        .from("youtube_oauth_states")
        .delete()
        .eq("state", state)
        .select("*");
      if (error) fail("consumeOAuthState", error);
      const row = (data ?? [])[0] as Row | undefined;
      if (!row) return null;
      return {
        state: String(row["state"]),
        userId: String(row["user_id"]),
        redirectUri: String(row["redirect_uri"]),
        createdAt: String(row["created_at"]),
      };
    },

    async getConnection(userId: string) {
      const { data, error } = await (await db())
        .from("youtube_connections")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) fail("getConnection", error);
      return data ? toConnection(data as Row) : null;
    },

    async saveConnection(userId: string, patch: Partial<StoredConnection>) {
      const payload: Row = { user_id: userId };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "userId" || value === undefined) continue;
        payload[COLUMN[key as keyof StoredConnection]] = value;
      }
      const { data, error } = await (await db())
        .from("youtube_connections")
        .upsert(payload, { onConflict: "user_id" })
        .select("*")
        .single();
      if (error) fail("saveConnection", error);
      return toConnection(data as Row);
    },

    async deleteConnection(userId: string) {
      const { error } = await (await db())
        .from("youtube_connections")
        .delete()
        .eq("user_id", userId);
      if (error) fail("deleteConnection", error);
    },

    async saveRawMetrics(rows: RawMetricsRow[]) {
      if (!rows.length) return 0;
      const payload = rows.map((row) => ({
        user_id: row.userId,
        video_id: row.videoId,
        window_key: row.windowKey,
        views: row.metrics.views,
        likes: row.metrics.likes,
        comments: row.metrics.comments,
        shares: row.metrics.shares,
        watch_time_minutes: row.metrics.watchTimeMinutes,
        average_view_duration_seconds: row.metrics.averageViewDurationSeconds,
        average_view_percentage: row.metrics.averageViewPercentage,
        subscribers_gained: row.metrics.subscribersGained,
        impressions: row.metrics.impressions,
        impression_ctr: row.metrics.impressionCtr,
        traffic_sources: row.metrics.trafficSources ?? {},
        us_share: row.metrics.usShare,
        source: "youtube_analytics_api",
      }));
      const { error } = await (await db())
        .from("channel_video_metrics")
        .upsert(payload, { onConflict: "user_id,video_id,window_key" });
      if (error) fail("saveRawMetrics", error);
      return payload.length;
    },

    async saveVideoExtras(userId: string, extras: VideoExtrasRow[]) {
      const client_ = await db();
      for (const extra of extras) {
        const { error } = await client_
          .from("channel_videos")
          .update({
            thumbnail_url: extra.thumbnailUrl,
            privacy_status: extra.privacyStatus,
            tags: extra.tags,
          })
          .eq("user_id", userId)
          .eq("video_id", extra.videoId);
        if (error) fail("saveVideoExtras", error);
      }
    },
  } satisfies YouTubeConnectionStore;
}
