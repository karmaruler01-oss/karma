// YouTube connection + sync adapter (server only).
//
// Responsibilities:
//   * Google/YouTube OAuth (authorization URL, callback, refresh, disconnect)
//   * channel / video / analytics synchronization into the existing tables
//   * feeding the existing Channel Brain with the real observations
//
// Hard rules:
//   * client id/secret and tokens never leave the server and are never logged
//   * an observed 0 stays 0, an unavailable metric stays null — never coerced
//   * nothing is fabricated: if YouTube does not return it, it is not stored
//   * every sync is idempotent (upserts keyed by user + video [+ window])

import {
  analyzeChannel,
  analyzeVideoPerformance,
  createNextVideoStrategy,
  recalculateChannelBaseline,
  updateChannelBrain,
  type ChannelBrainDeps,
} from "@/lib/channel/brain.server";
import { runBrainCycle } from "@/lib/channel/intel/orchestrator.server";
import type { IntelligenceSummary } from "@/lib/channel/intel/types";
import type { ChannelStore, StoredMetrics, StoredVideo } from "@/lib/channel/store";
import { EMPTY_METRICS, WINDOW_HOURS, WINDOW_KEYS, type ObservedMetrics, type WindowKey } from "@/lib/channel/types";

import { readYouTubeConfig } from "./youtube-config.server";

// ---------------------------------------------------------------------------
// Public state types
// ---------------------------------------------------------------------------

/** Provider (credential/config) level state. Never READY without credentials. */
export type YouTubeProviderState = "NOT_CONFIGURED" | "READY" | "BUSY" | "ERROR";

/** Per-user connection state. Never CONNECTED without a completed OAuth. */
export type YouTubeConnectionState =
  | "NOT_CONFIGURED"
  | "NOT_CONNECTED"
  | "CONNECTED"
  | "NEEDS_RECONNECT"
  | "ERROR";

export interface YouTubeStatus {
  provider: YouTubeProviderState;
  connection: YouTubeConnectionState;
  channelId: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  country: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  scope: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

export class YouTubeNotConfiguredError extends Error {
  constructor() {
    super("YouTube provider is not configured");
    this.name = "YouTubeNotConfiguredError";
  }
}

export class YouTubeAuthError extends Error {
  readonly needsReconnect: boolean;
  constructor(message: string, needsReconnect = true) {
    super(message);
    this.name = "YouTubeAuthError";
    this.needsReconnect = needsReconnect;
  }
}

// ---------------------------------------------------------------------------
// Persistence contracts (kept narrow so tests never touch a database)
// ---------------------------------------------------------------------------

export interface StoredConnection {
  userId: string;
  channelId: string | null;
  channelTitle: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: string | null;
  scope: string | null;
  status: "CONNECTED" | "NEEDS_RECONNECT" | "ERROR";
  error: string | null;
  connectedAt: string | null;
}

export interface OAuthStateRecord {
  state: string;
  userId: string;
  redirectUri: string;
  createdAt: string;
}

/** Lifetime metrics live outside the brain's four comparison windows. */
export interface RawMetricsRow {
  userId: string;
  videoId: string;
  windowKey: string;
  metrics: ObservedMetrics;
}

export interface YouTubeConnectionStore {
  createOAuthState(record: OAuthStateRecord): Promise<void>;
  /** Single use: the row is deleted as it is read. */
  consumeOAuthState(state: string): Promise<OAuthStateRecord | null>;
  getConnection(userId: string): Promise<StoredConnection | null>;
  saveConnection(userId: string, patch: Partial<StoredConnection>): Promise<StoredConnection>;
  deleteConnection(userId: string): Promise<void>;
  saveRawMetrics(rows: RawMetricsRow[]): Promise<number>;
  /** Optional: stores YouTube-only fields the Brain's own store doesn't model. */
  saveVideoExtras?(userId: string, rows: VideoExtrasRow[]): Promise<void>;
}

export interface VideoExtrasRow {
  videoId: string;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  tags: string[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface YouTubeCredentials {
  clientId: string;
  clientSecret: string;
}

export interface YouTubeDeps {
  fetch?: FetchLike;
  now?: () => Date;
  /** null = explicitly unconfigured. undefined = read from the environment. */
  credentials?: YouTubeCredentials | null;
  connections?: YouTubeConnectionStore;
  store?: ChannelStore;
  brainDeps?: ChannelBrainDeps;
  /** Random state generator (overridable for deterministic tests). */
  randomState?: () => string;
}

interface Resolved {
  fetch: FetchLike;
  now: Date;
  credentials: YouTubeCredentials | null;
  connections: YouTubeConnectionStore;
  store: ChannelStore;
  brainDeps: ChannelBrainDeps;
  randomState: () => string;
}

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

export function readCredentials(): YouTubeCredentials | null {
  const config = readYouTubeConfig();
  if (!config) return null;
  return { clientId: config.clientId, clientSecret: config.clientSecret };
}

async function resolve(deps?: YouTubeDeps): Promise<Resolved> {
  const credentials = deps?.credentials === undefined ? readCredentials() : deps.credentials;

  let connections = deps?.connections;
  if (!connections) {
    const { createSupabaseYouTubeConnectionStore } = await import("./youtube-store.server");
    connections = createSupabaseYouTubeConnectionStore();
  }

  let store = deps?.store ?? deps?.brainDeps?.store;
  if (!store) {
    const { createSupabaseChannelStore } = await import("@/lib/channel/store.supabase");
    store = createSupabaseChannelStore();
  }

  const now = deps?.now ?? (() => new Date());
  return {
    fetch: deps?.fetch ?? ((input, init) => fetch(input, init)),
    now: now(),
    credentials,
    connections,
    store,
    brainDeps: { ...(deps?.brainDeps ?? {}), store },
    randomState: deps?.randomState ?? (() => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "")),
  };
}

// ---------------------------------------------------------------------------
// Provider status
// ---------------------------------------------------------------------------

export async function getProviderState(deps?: YouTubeDeps): Promise<YouTubeProviderState> {
  const { credentials, store } = await resolve(deps);
  if (!credentials) return "NOT_CONFIGURED";
  void store;
  return "READY";
}

/** Provider status for one user: BUSY while one of their syncs is running. */
export async function getYouTubeProviderStatus(
  userId?: string,
  deps?: YouTubeDeps,
): Promise<YouTubeProviderState> {
  const { credentials, store } = await resolve(deps);
  if (!credentials) return "NOT_CONFIGURED";
  if (!userId) return "READY";
  try {
    const log = await store.listSyncLog(userId, 5);
    if (log.some((row) => row.status === "RUNNING")) return "BUSY";
    return "READY";
  } catch {
    return "ERROR";
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export async function getAuthorizationUrl(
  input: { userId: string; redirectUri: string },
  deps?: YouTubeDeps,
): Promise<{ url: string; state: string }> {
  const { credentials, connections, now, randomState } = await resolve(deps);
  if (!credentials) throw new YouTubeNotConfiguredError();

  const state = randomState();
  await connections.createOAuthState({
    state,
    userId: input.userId,
    redirectUri: input.redirectUri,
    createdAt: now.toISOString(),
  });

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: YOUTUBE_SCOPES.join(" "),
    state,
  });
  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, state };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function exchange(
  resolved: Resolved,
  body: Record<string, string>,
): Promise<TokenResponse> {
  const response = await resolved.fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || payload.error || !payload.access_token) {
    // Only the error code is surfaced — never the request body or tokens.
    throw new YouTubeAuthError(payload.error ?? `token_request_failed_${response.status}`);
  }
  return payload;
}

export interface CallbackResult {
  userId: string;
  redirectUri: string;
  channelId: string | null;
  channelTitle: string | null;
}

export async function handleCallback(
  input: { code?: string | null; state?: string | null; error?: string | null },
  deps?: YouTubeDeps,
): Promise<CallbackResult> {
  const resolved = await resolve(deps);
  if (!resolved.credentials) throw new YouTubeNotConfiguredError();
  if (input.error) throw new YouTubeAuthError(`authorization_denied:${input.error}`);
  if (!input.state) throw new YouTubeAuthError("missing_state");
  if (!input.code) throw new YouTubeAuthError("missing_code");

  const record = await resolved.connections.consumeOAuthState(input.state);
  if (!record) throw new YouTubeAuthError("invalid_state");
  if (resolved.now.getTime() - Date.parse(record.createdAt) > OAUTH_STATE_TTL_MS) {
    throw new YouTubeAuthError("expired_state");
  }

  const token = await exchange(resolved, {
    code: input.code,
    client_id: resolved.credentials.clientId,
    client_secret: resolved.credentials.clientSecret,
    redirect_uri: record.redirectUri,
    grant_type: "authorization_code",
  });

  await resolved.connections.saveConnection(record.userId, {
    accessToken: token.access_token ?? null,
    refreshToken: token.refresh_token ?? null,
    tokenExpiresAt: token.expires_in
      ? new Date(resolved.now.getTime() + token.expires_in * 1000).toISOString()
      : null,
    scope: token.scope ?? null,
    status: "CONNECTED",
    error: null,
    connectedAt: resolved.now.toISOString(),
  });

  const channel = await syncChannel(record.userId, deps);
  return {
    userId: record.userId,
    redirectUri: record.redirectUri,
    channelId: channel.channelId,
    channelTitle: channel.channelTitle,
  };
}

/** Refreshes the stored access token. Tokens never leave the server. */
export async function refreshAccessToken(
  userId: string,
  deps?: YouTubeDeps,
): Promise<string> {
  const resolved = await resolve(deps);
  if (!resolved.credentials) throw new YouTubeNotConfiguredError();
  const connection = await resolved.connections.getConnection(userId);
  if (!connection?.refreshToken) throw new YouTubeAuthError("not_connected");

  let token: TokenResponse;
  try {
    token = await exchange(resolved, {
      client_id: resolved.credentials.clientId,
      client_secret: resolved.credentials.clientSecret,
      refresh_token: connection.refreshToken,
      grant_type: "refresh_token",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "refresh_failed";
    await resolved.connections.saveConnection(userId, {
      status: "NEEDS_RECONNECT",
      error: code,
      accessToken: null,
      tokenExpiresAt: null,
    });
    throw new YouTubeAuthError(code);
  }

  await resolved.connections.saveConnection(userId, {
    accessToken: token.access_token ?? null,
    tokenExpiresAt: token.expires_in
      ? new Date(resolved.now.getTime() + token.expires_in * 1000).toISOString()
      : null,
    ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
    ...(token.scope ? { scope: token.scope } : {}),
    status: "CONNECTED",
    error: null,
  });
  return token.access_token as string;
}

const TOKEN_EXPIRY_SKEW_MS = 60_000;

async function accessTokenFor(userId: string, deps?: YouTubeDeps): Promise<string> {
  const resolved = await resolve(deps);
  if (!resolved.credentials) throw new YouTubeNotConfiguredError();
  const connection = await resolved.connections.getConnection(userId);
  if (!connection || connection.status === "NEEDS_RECONNECT") {
    throw new YouTubeAuthError(connection ? "needs_reconnect" : "not_connected");
  }
  const expired =
    !connection.accessToken ||
    !connection.tokenExpiresAt ||
    Date.parse(connection.tokenExpiresAt) - TOKEN_EXPIRY_SKEW_MS <= resolved.now.getTime();
  if (!expired) return connection.accessToken as string;
  return refreshAccessToken(userId, deps);
}

async function apiGet<T>(
  userId: string,
  url: string,
  deps: YouTubeDeps | undefined,
  resolved: Resolved,
): Promise<T> {
  const attempt = async (token: string) =>
    resolved.fetch(url, { headers: { authorization: `Bearer ${token}` } });

  let token = await accessTokenFor(userId, deps);
  let response = await attempt(token);
  if (response.status === 401) {
    token = await refreshAccessToken(userId, deps);
    response = await attempt(token);
  }
  if (response.status === 401 || response.status === 403) {
    await resolved.connections.saveConnection(userId, {
      status: "NEEDS_RECONNECT",
      error: `youtube_${response.status}`,
    });
    throw new YouTubeAuthError(`youtube_${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`youtube_request_failed_${response.status}`);
  }
  return (await response.json()) as T;
}

export async function disconnectChannel(userId: string, deps?: YouTubeDeps): Promise<void> {
  const resolved = await resolve(deps);
  const connection = await resolved.connections.getConnection(userId);
  const token = connection?.refreshToken ?? connection?.accessToken;
  if (token) {
    try {
      await resolved.fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch {
      // Revocation is best effort; the local connection is removed regardless.
    }
  }
  await resolved.connections.deleteConnection(userId);
}

// ---------------------------------------------------------------------------
// Status / connected channel
// ---------------------------------------------------------------------------

export async function getConnectedChannel(
  userId: string,
  deps?: YouTubeDeps,
): Promise<YouTubeStatus> {
  const resolved = await resolve(deps);
  const base: YouTubeStatus = {
    provider: resolved.credentials ? "READY" : "NOT_CONFIGURED",
    connection: resolved.credentials ? "NOT_CONNECTED" : "NOT_CONFIGURED",
    channelId: null,
    channelTitle: null,
    thumbnailUrl: null,
    country: null,
    subscriberCount: null,
    viewCount: null,
    videoCount: null,
    scope: null,
    connectedAt: null,
    lastSyncedAt: null,
    error: null,
  };
  if (!resolved.credentials) return base;

  base.provider = await getYouTubeProviderStatus(userId, deps);

  const connection = await resolved.connections.getConnection(userId);
  if (!connection) return base;

  base.connection = connection.status === "CONNECTED" ? "CONNECTED" : connection.status;
  base.channelId = connection.channelId;
  base.channelTitle = connection.channelTitle;
  base.scope = connection.scope;
  base.connectedAt = connection.connectedAt;
  base.error = connection.error;

  const profile = await resolved.store.getChannelProfile(userId);
  if (profile) {
    base.channelId = profile.channelId ?? base.channelId;
    base.channelTitle = profile.channelTitle ?? base.channelTitle;
    base.country = profile.country;
    base.subscriberCount = profile.subscriberCount;
    base.viewCount = profile.viewCount;
    base.videoCount = profile.videoCount;
    base.lastSyncedAt = profile.lastSyncedAt;
    const audience = profile.audienceProfile as { thumbnailUrl?: unknown } | null;
    if (audience && typeof audience["thumbnailUrl"] === "string") {
      base.thumbnailUrl = audience["thumbnailUrl"];
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Mapping helpers — null stays null, 0 stays 0
// ---------------------------------------------------------------------------

/** Returns a finite number (including 0) or null. Never coerces null to 0. */
export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/.exec(value);
  if (!match) return null;
  const [, d, h, m, s] = match;
  if (!d && !h && !m && !s) return null;
  return (
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Math.round(Number(s ?? 0))
  );
}

interface ChannelResource {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    country?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

export interface MappedChannel {
  channelId: string | null;
  channelTitle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  country: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  uploadsPlaylistId: string | null;
}

export function mapChannel(resource: ChannelResource | undefined): MappedChannel {
  const thumbnails = resource?.snippet?.thumbnails ?? {};
  const thumbnail =
    thumbnails["high"]?.url ?? thumbnails["medium"]?.url ?? thumbnails["default"]?.url ?? null;
  return {
    channelId: resource?.id ?? null,
    channelTitle: resource?.snippet?.title ?? null,
    description: resource?.snippet?.description ?? null,
    thumbnailUrl: thumbnail,
    country: resource?.snippet?.country ?? null,
    // Hidden subscriber counts are unavailable, not zero.
    subscriberCount: resource?.statistics?.hiddenSubscriberCount
      ? null
      : numberOrNull(resource?.statistics?.subscriberCount),
    viewCount: numberOrNull(resource?.statistics?.viewCount),
    videoCount: numberOrNull(resource?.statistics?.videoCount),
    uploadsPlaylistId: resource?.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

interface VideoResource {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    tags?: string[];
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: { duration?: string };
  status?: { privacyStatus?: string };
}

export function mapVideo(resource: VideoResource): StoredVideo & {
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  tags: string[];
} {
  const thumbnails = resource.snippet?.thumbnails ?? {};
  const durationSeconds = parseIsoDuration(resource.contentDetails?.duration);
  return {
    videoId: String(resource.id ?? ""),
    projectId: null,
    title: resource.snippet?.title ?? null,
    // Real publish timestamps only. Missing stays null.
    publishedAt: resource.snippet?.publishedAt ?? null,
    durationSeconds,
    shortForm: durationSeconds !== null && durationSeconds <= 60,
    genre: null,
    structure: null,
    narrationStyle: null,
    hookText: null,
    thumbnailUrl:
      thumbnails["high"]?.url ?? thumbnails["medium"]?.url ?? thumbnails["default"]?.url ?? null,
    privacyStatus: resource.status?.privacyStatus ?? null,
    tags: resource.snippet?.tags ?? [],
  };
}

export interface AnalyticsReport {
  columnHeaders?: { name?: string }[];
  rows?: (string | number | null)[][];
}

const METRIC_FIELD: Record<string, keyof ObservedMetrics> = {
  views: "views",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  estimatedMinutesWatched: "watchTimeMinutes",
  averageViewDuration: "averageViewDurationSeconds",
  averageViewPercentage: "averageViewPercentage",
  subscribersGained: "subscribersGained",
  impressions: "impressions",
  impressionClickThroughRate: "impressionCtr",
};

/**
 * Maps one YouTube Analytics report row onto ObservedMetrics.
 * Metrics YouTube did not return stay null; returned zeros stay 0.
 */
export function mapAnalyticsReport(report: AnalyticsReport | null | undefined): ObservedMetrics {
  const metrics: ObservedMetrics = { ...EMPTY_METRICS };
  const headers = report?.columnHeaders ?? [];
  const row = report?.rows?.[0];
  if (!row) return metrics;
  headers.forEach((header, index) => {
    const field = header?.name ? METRIC_FIELD[header.name] : undefined;
    if (!field) return;
    const value = numberOrNull(row[index]);
    (metrics as unknown as Record<string, unknown>)[field] = value;
  });
  return metrics;
}

/** dimensions=insightTrafficSourceType report → { SOURCE: views }. */
export function mapTrafficSources(
  report: AnalyticsReport | null | undefined,
): Record<string, number> | null {
  const headers = report?.columnHeaders ?? [];
  const rows = report?.rows ?? [];
  if (!rows.length) return null;
  const dimensionIndex = headers.findIndex((h) => h?.name === "insightTrafficSourceType");
  const viewsIndex = headers.findIndex((h) => h?.name === "views");
  if (dimensionIndex < 0 || viewsIndex < 0) return null;
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = row[dimensionIndex];
    const views = numberOrNull(row[viewsIndex]);
    if (typeof key === "string" && views !== null) out[key] = views;
  }
  return Object.keys(out).length ? out : null;
}

/** dimensions=country report → US share of views (percent) or null. */
export function mapUsShare(report: AnalyticsReport | null | undefined): number | null {
  const headers = report?.columnHeaders ?? [];
  const rows = report?.rows ?? [];
  if (!rows.length) return null;
  const countryIndex = headers.findIndex((h) => h?.name === "country");
  const viewsIndex = headers.findIndex((h) => h?.name === "views");
  if (countryIndex < 0 || viewsIndex < 0) return null;
  let total = 0;
  let us = 0;
  for (const row of rows) {
    const views = numberOrNull(row[viewsIndex]);
    if (views === null) continue;
    total += views;
    if (row[countryIndex] === "US") us += views;
  }
  if (total <= 0) return null;
  return (us / total) * 100;
}

// ---------------------------------------------------------------------------
// Sync: channel
// ---------------------------------------------------------------------------

export interface ChannelSyncResult extends MappedChannel {
  synced: boolean;
}

export async function syncChannel(userId: string, deps?: YouTubeDeps): Promise<ChannelSyncResult> {
  const resolved = await resolve(deps);
  const syncId = await resolved.store.startSync(userId, "channel");
  try {
    const payload = await apiGet<{ items?: ChannelResource[] }>(
      userId,
      `${YOUTUBE_DATA_API}/channels?part=snippet,statistics,contentDetails&mine=true`,
      deps,
      resolved,
    );
    const channel = mapChannel(payload.items?.[0]);

    await resolved.store.saveChannelProfile(userId, {
      channelId: channel.channelId,
      channelTitle: channel.channelTitle,
      country: channel.country,
      subscriberCount: channel.subscriberCount,
      viewCount: channel.viewCount,
      videoCount: channel.videoCount,
      audienceProfile: {
        thumbnailUrl: channel.thumbnailUrl,
        description: channel.description,
        uploadsPlaylistId: channel.uploadsPlaylistId,
      },
      lastSyncedAt: resolved.now.toISOString(),
    });
    if (channel.channelId || channel.channelTitle) {
      await resolved.connections.saveConnection(userId, {
        channelId: channel.channelId,
        channelTitle: channel.channelTitle,
      });
    }
    await resolved.store.finishSync(syncId, "SUCCESS", "channel", 1);
    return { ...channel, synced: true };
  } catch (error) {
    await resolved.store.finishSync(syncId, "FAILED", errorCode(error), 0);
    throw error;
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "unknown_error";
}

// ---------------------------------------------------------------------------
// Sync: videos
// ---------------------------------------------------------------------------

interface PlaylistItemsResponse {
  items?: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }[];
  nextPageToken?: string;
}

export interface VideoSyncResult {
  videoIds: string[];
  synced: number;
  incremental: boolean;
  since: string | null;
}

export async function syncVideos(
  userId: string,
  options?: { full?: boolean; maxVideos?: number },
  deps?: YouTubeDeps,
): Promise<VideoSyncResult> {
  const resolved = await resolve(deps);
  const lastSync = options?.full ? null : await resolved.store.lastSuccessfulSync(userId, "videos");
  const since = lastSync?.startedAt ?? null;
  const maxVideos = options?.maxVideos ?? 200;
  const syncId = await resolved.store.startSync(userId, "videos");

  try {
    const channelPayload = await apiGet<{ items?: ChannelResource[] }>(
      userId,
      `${YOUTUBE_DATA_API}/channels?part=contentDetails&mine=true`,
      deps,
      resolved,
    );
    const uploads = mapChannel(channelPayload.items?.[0]).uploadsPlaylistId;
    if (!uploads) {
      await resolved.store.finishSync(syncId, "SKIPPED", "no_uploads_playlist", 0);
      return { videoIds: [], synced: 0, incremental: since !== null, since };
    }

    const ids: string[] = [];
    let pageToken: string | undefined;
    let reachedKnown = false;
    do {
      const url =
        `${YOUTUBE_DATA_API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const page = await apiGet<PlaylistItemsResponse>(userId, url, deps, resolved);
      for (const item of page.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        if (!videoId) continue;
        const publishedAt = item.contentDetails?.videoPublishedAt;
        // Incremental: stop once we reach videos published before the last sync.
        if (since && publishedAt && Date.parse(publishedAt) < Date.parse(since)) {
          reachedKnown = true;
          break;
        }
        ids.push(videoId);
        if (ids.length >= maxVideos) break;
      }
      pageToken = page.nextPageToken;
    } while (pageToken && !reachedKnown && ids.length < maxVideos);

    const videos: StoredVideo[] = [];
    const extras: { videoId: string; thumbnailUrl: string | null; privacyStatus: string | null; tags: string[] }[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const payload = await apiGet<{ items?: VideoResource[] }>(
        userId,
        `${YOUTUBE_DATA_API}/videos?part=snippet,contentDetails,status&id=${chunk.join(",")}`,
        deps,
        resolved,
      );
      for (const resource of payload.items ?? []) {
        const { thumbnailUrl, privacyStatus, tags, ...video } = mapVideo(resource);
        if (!video.videoId) continue;
        videos.push(video);
        extras.push({ videoId: video.videoId, thumbnailUrl, privacyStatus, tags });
      }
    }

    // Idempotent: keyed on (user_id, video_id).
    const synced = await resolved.store.upsertVideos(userId, videos);
    await applyVideoExtras(resolved, userId, extras);
    await resolved.store.finishSync(syncId, "SUCCESS", since ? "incremental" : "full", synced);
    return {
      videoIds: videos.map((v) => v.videoId),
      synced,
      incremental: since !== null,
      since,
    };
  } catch (error) {
    await resolved.store.finishSync(syncId, "FAILED", errorCode(error), 0);
    throw error;
  }
}

async function applyVideoExtras(
  resolved: Resolved,
  userId: string,
  extras: VideoExtrasRow[],
): Promise<void> {
  if (!extras.length) return;
  await resolved.connections.saveVideoExtras?.(userId, extras);
}

// ---------------------------------------------------------------------------
// Sync: analytics
// ---------------------------------------------------------------------------

const CORE_METRICS =
  "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained";
const IMPRESSION_METRICS = "impressions,impressionClickThroughRate";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function analyticsReport(
  userId: string,
  params: Record<string, string>,
  deps: YouTubeDeps | undefined,
  resolved: Resolved,
  optional: boolean,
): Promise<AnalyticsReport | null> {
  const url = `${YOUTUBE_ANALYTICS_API}?${new URLSearchParams(params).toString()}`;
  try {
    return await apiGet<AnalyticsReport>(userId, url, deps, resolved);
  } catch (error) {
    if (error instanceof YouTubeAuthError) throw error;
    // Unsupported metric combinations simply mean "not available" — not zero.
    if (optional) return null;
    throw error;
  }
}

export interface AnalyticsSyncResult {
  videoIds: string[];
  rows: number;
  lifetimeRows: number;
  windows: WindowKey[];
}

export async function syncAnalytics(
  userId: string,
  options?: { videoIds?: string[] },
  deps?: YouTubeDeps,
): Promise<AnalyticsSyncResult> {
  const resolved = await resolve(deps);
  const syncId = await resolved.store.startSync(userId, "analytics");
  try {
    const stored = await resolved.store.listVideos(userId);
    const targets = options?.videoIds?.length
      ? stored.filter((v) => options.videoIds!.includes(v.videoId))
      : stored;

    const metricRows: StoredMetrics[] = [];
    const lifetimeRows: RawMetricsRow[] = [];
    const windowsUsed = new Set<WindowKey>();

    for (const video of targets) {
      if (!video.publishedAt) continue; // cannot judge without a real publish date
      const published = new Date(video.publishedAt);
      const ageHours = (resolved.now.getTime() - published.getTime()) / 3_600_000;

      for (const windowKey of WINDOW_KEYS) {
        const hours = WINDOW_HOURS[windowKey];
        // Age-aware: only completed windows are collected.
        if (ageHours < hours) continue;
        const end = new Date(published.getTime() + hours * 3_600_000);
        const metrics = await collectMetrics(
          userId,
          video.videoId,
          isoDate(published),
          isoDate(end),
          deps,
          resolved,
        );
        metricRows.push({ videoId: video.videoId, windowKey, metrics });
        windowsUsed.add(windowKey);
      }

      // Lifetime, when available. Stored outside the comparison windows.
      const lifetime = await collectMetrics(
        userId,
        video.videoId,
        isoDate(published),
        isoDate(resolved.now),
        deps,
        resolved,
      );
      lifetimeRows.push({
        userId,
        videoId: video.videoId,
        windowKey: "lifetime",
        metrics: lifetime,
      });
    }

    // Idempotent: keyed on (user_id, video_id, window_key).
    const rows = await resolved.store.upsertMetrics(userId, metricRows);
    const lifetimeSaved = await resolved.connections.saveRawMetrics(lifetimeRows);
    await resolved.store.finishSync(syncId, "SUCCESS", "analytics", rows);
    return {
      videoIds: targets.map((v) => v.videoId),
      rows,
      lifetimeRows: lifetimeSaved,
      windows: [...windowsUsed],
    };
  } catch (error) {
    await resolved.store.finishSync(syncId, "FAILED", errorCode(error), 0);
    throw error;
  }
}

async function collectMetrics(
  userId: string,
  videoId: string,
  startDate: string,
  endDate: string,
  deps: YouTubeDeps | undefined,
  resolved: Resolved,
): Promise<ObservedMetrics> {
  const base = {
    ids: "channel==MINE",
    startDate,
    endDate,
    filters: `video==${videoId}`,
  };

  const core = await analyticsReport(
    userId,
    { ...base, metrics: CORE_METRICS },
    deps,
    resolved,
    false,
  );
  const metrics = mapAnalyticsReport(core);

  const impressions = await analyticsReport(
    userId,
    { ...base, metrics: IMPRESSION_METRICS },
    deps,
    resolved,
    true,
  );
  if (impressions) {
    const mapped = mapAnalyticsReport(impressions);
    metrics.impressions = mapped.impressions;
    metrics.impressionCtr = mapped.impressionCtr;
  }

  const traffic = await analyticsReport(
    userId,
    { ...base, metrics: "views", dimensions: "insightTrafficSourceType" },
    deps,
    resolved,
    true,
  );
  metrics.trafficSources = mapTrafficSources(traffic);

  const geography = await analyticsReport(
    userId,
    { ...base, metrics: "views", dimensions: "country" },
    deps,
    resolved,
    true,
  );
  metrics.usShare = mapUsShare(geography);

  return metrics;
}

// ---------------------------------------------------------------------------
// Full sync + Brain feedback loop
// ---------------------------------------------------------------------------

export interface FullSyncResult {
  channel: ChannelSyncResult;
  videos: VideoSyncResult;
  analytics: AnalyticsSyncResult;
  brain: {
    videosAnalyzed: number;
    baselines: number;
    strategyVersion: number;
    mode: string;
    sufficiency: string;
  };
  /** Structured understanding produced by the intelligence layer. */
  intelligence: {
    status: IntelligenceSummary["status"];
    sufficiency: IntelligenceSummary["sufficiency"];
    findings: number;
    learnings: number;
    experimentsCreated: number;
    experimentsUpdated: number;
    confidence: IntelligenceSummary["confidence"];
  };
}

/**
 * YouTube → channel_profile → channel_videos → channel_video_metrics →
 * analyzeVideoPerformance → analyzeChannel → recalculateChannelBaseline →
 * updateChannelBrain → createNextVideoStrategy → runBrainCycle.
 *
 * The Brain itself is untouched: this only feeds it real observations.
 */
export async function syncAll(
  userId: string,
  options?: { full?: boolean },
  deps?: YouTubeDeps,
): Promise<FullSyncResult> {
  const resolved = await resolve(deps);
  const channel = await syncChannel(userId, deps);
  const videos = await syncVideos(userId, { full: options?.full ?? false }, deps);
  const analytics = await syncAnalytics(userId, undefined, deps);

  const brainDeps = resolved.brainDeps;
  for (const videoId of analytics.videoIds) {
    await analyzeVideoPerformance(userId, videoId, brainDeps);
  }
  await analyzeChannel(userId, brainDeps);
  const baselines = await recalculateChannelBaseline(userId, brainDeps);
  const update = await updateChannelBrain(userId, brainDeps);
  const strategy = await createNextVideoStrategy(userId, brainDeps);

  // Intelligence layer runs last: it reads everything the steps above stored
  // and attaches its summary to the strategy version they just produced.
  const cycle = await runBrainCycle(userId, {
    ...brainDeps,
    ...(options?.full === true ? { rebuild: true } : {}),
  });

  return {
    channel,
    videos,
    analytics,
    brain: {
      videosAnalyzed: analytics.videoIds.length,
      baselines: baselines.persisted,
      strategyVersion: strategy.stored.version,
      mode: update.mode,
      sufficiency: update.sufficiency,
    },
    intelligence: {
      status: cycle.summary.status,
      sufficiency: cycle.summary.sufficiency,
      findings: cycle.summary.strongestFindings.length,
      learnings: cycle.summary.learnings.length,
      experimentsCreated: cycle.persisted.experimentsCreated,
      experimentsUpdated: cycle.persisted.experimentsUpdated,
      confidence: cycle.summary.confidence,
    },
  };
}
