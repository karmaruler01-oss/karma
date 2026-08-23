import { describe, expect, it } from "vitest";

import { createMemoryChannelStore } from "@/lib/channel/store.memory";
import { EMPTY_METRICS } from "@/lib/channel/types";
import { createMemoryYouTubeStore } from "./youtube-store.memory";
import {
  getAuthorizationUrl,
  getConnectedChannel,
  getYouTubeProviderStatus,
  handleCallback,
  mapAnalyticsReport,
  mapChannel,
  mapTrafficSources,
  mapUsShare,
  mapVideo,
  numberOrNull,
  parseIsoDuration,
  refreshAccessToken,
  syncAll,
  syncAnalytics,
  syncChannel,
  syncVideos,
  disconnectChannel,
  YouTubeAuthError,
  YouTubeNotConfiguredError,
  type YouTubeDeps,
} from "./youtube.server";

const USER = "user-1";
const NOW = new Date("2026-03-01T00:00:00.000Z");
const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret" };
const REDIRECT = "https://app.example/api/public/youtube/callback";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Harness {
  deps: YouTubeDeps;
  channelStore: ReturnType<typeof createMemoryChannelStore>;
  youtubeStore: ReturnType<typeof createMemoryYouTubeStore>;
  calls: string[];
}

type Route = (url: string, init?: RequestInit) => Response | undefined;

function harness(routes: Route[], overrides?: Partial<YouTubeDeps>): Harness {
  const channelStore = createMemoryChannelStore(() => NOW.toISOString());
  const youtubeStore = createMemoryYouTubeStore();
  const calls: string[] = [];

  const deps: YouTubeDeps = {
    credentials: CREDENTIALS,
    now: () => NOW,
    store: channelStore,
    connections: youtubeStore,
    randomState: () => "fixed-state",
    fetch: async (url, init) => {
      calls.push(url);
      for (const route of routes) {
        const response = route(url, init);
        if (response) return response;
      }
      return json({ error: "unexpected_request", url }, 404);
    },
    ...overrides,
  };
  return { deps, channelStore, youtubeStore, calls };
}

// Canonical fake YouTube surface -------------------------------------------

const CHANNEL_ROUTE: Route = (url) =>
  url.includes("/channels?")
    ? json({
        items: [
          {
            id: "UC123",
            snippet: {
              title: "Story Channel",
              description: "desc",
              country: "US",
              thumbnails: { high: { url: "https://img/high.jpg" } },
            },
            statistics: { subscriberCount: "0", viewCount: "1200", videoCount: "2" },
            contentDetails: { relatedPlaylists: { uploads: "UU123" } },
          },
        ],
      })
    : undefined;

const PLAYLIST_ROUTE: Route = (url) =>
  url.includes("/playlistItems?")
    ? json({
        items: [
          {
            contentDetails: { videoId: "vid-new", videoPublishedAt: "2026-02-20T00:00:00.000Z" },
          },
          {
            contentDetails: { videoId: "vid-old", videoPublishedAt: "2025-12-01T00:00:00.000Z" },
          },
        ],
      })
    : undefined;

const VIDEOS_ROUTE: Route = (url) =>
  url.includes("/videos?")
    ? json({
        items: (new URL(url).searchParams.get("id") ?? "").split(",").map((id) => ({
          id,
          snippet: {
            title: `Title ${id}`,
            description: "body",
            publishedAt: id === "vid-old" ? "2025-12-01T00:00:00.000Z" : "2026-02-20T00:00:00.000Z",
            tags: ["mystery"],
            thumbnails: { high: { url: `https://img/${id}.jpg` } },
          },
          contentDetails: { duration: "PT45S" },
          status: { privacyStatus: "public" },
        })),
      })
    : undefined;

const ANALYTICS_ROUTE: Route = (url) => {
  if (!url.startsWith("https://youtubeanalytics.googleapis.com")) return undefined;
  const params = new URL(url).searchParams;
  const metrics = params.get("metrics") ?? "";
  const dimensions = params.get("dimensions");
  if (metrics.includes("impressions")) {
    // Impressions are frequently unavailable — must stay null, not 0.
    return json({ error: { message: "unsupported metric" } }, 400);
  }
  if (dimensions === "insightTrafficSourceType") {
    return json({
      columnHeaders: [{ name: "insightTrafficSourceType" }, { name: "views" }],
      rows: [["BROWSE", 4]],
    });
  }
  if (dimensions === "country") {
    return json({
      columnHeaders: [{ name: "country" }, { name: "views" }],
      rows: [
        ["US", 3],
        ["IN", 1],
      ],
    });
  }
  return json({
    columnHeaders: [
      { name: "views" },
      { name: "estimatedMinutesWatched" },
      { name: "averageViewDuration" },
      { name: "averageViewPercentage" },
      { name: "likes" },
      { name: "comments" },
      { name: "shares" },
      { name: "subscribersGained" },
    ],
    rows: [[0, 0, 0, 0, 0, 0, 0, 0]],
  });
};

const TOKEN_ROUTE: Route = (url) =>
  url === "https://oauth2.googleapis.com/token"
    ? json({
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.readonly",
      })
    : undefined;

const ALL_ROUTES = [TOKEN_ROUTE, CHANNEL_ROUTE, PLAYLIST_ROUTE, VIDEOS_ROUTE, ANALYTICS_ROUTE];

async function connect(h: Harness) {
  await getAuthorizationUrl({ userId: USER, redirectUri: REDIRECT }, h.deps);
  return handleCallback({ code: "code-1", state: "fixed-state" }, h.deps);
}

// ---------------------------------------------------------------------------

describe("provider configuration", () => {
  it("reports NOT_CONFIGURED without credentials and never fakes a connection", async () => {
    const h = harness(ALL_ROUTES, { credentials: null });
    expect(await getYouTubeProviderStatus(USER, h.deps)).toBe("NOT_CONFIGURED");
    const status = await getConnectedChannel(USER, h.deps);
    expect(status.provider).toBe("NOT_CONFIGURED");
    expect(status.connection).toBe("NOT_CONFIGURED");
    expect(status.channelId).toBeNull();
    await expect(
      getAuthorizationUrl({ userId: USER, redirectUri: REDIRECT }, h.deps),
    ).rejects.toBeInstanceOf(YouTubeNotConfiguredError);
  });

  it("is READY with credentials but NOT_CONNECTED before OAuth", async () => {
    const h = harness(ALL_ROUTES);
    const status = await getConnectedChannel(USER, h.deps);
    expect(status.provider).toBe("READY");
    expect(status.connection).toBe("NOT_CONNECTED");
  });
});

describe("oauth state handling", () => {
  it("binds the state to the user and consumes it exactly once", async () => {
    const h = harness(ALL_ROUTES);
    const { url, state } = await getAuthorizationUrl(
      { userId: USER, redirectUri: REDIRECT },
      h.deps,
    );
    expect(url).toContain("accounts.google.com");
    expect(url).toContain(`state=${state}`);
    expect(url).not.toContain(CREDENTIALS.clientSecret);
    expect(h.youtubeStore.states.get(state)?.userId).toBe(USER);

    const result = await handleCallback({ code: "code-1", state }, h.deps);
    expect(result.userId).toBe(USER);
    expect(h.youtubeStore.states.size).toBe(0);

    // Replaying the same state must fail (CSRF / replay protection).
    await expect(handleCallback({ code: "code-1", state }, h.deps)).rejects.toBeInstanceOf(
      YouTubeAuthError,
    );
  });

  it("rejects unknown, missing and expired state", async () => {
    const h = harness(ALL_ROUTES);
    await expect(handleCallback({ code: "c", state: "nope" }, h.deps)).rejects.toThrow(
      "invalid_state",
    );
    await expect(handleCallback({ code: "c" }, h.deps)).rejects.toThrow("missing_state");

    await getAuthorizationUrl({ userId: USER, redirectUri: REDIRECT }, h.deps);
    const later: YouTubeDeps = {
      ...h.deps,
      now: () => new Date(NOW.getTime() + 3600_000),
    };
    await expect(
      handleCallback({ code: "c", state: "fixed-state" }, later),
    ).rejects.toThrow("expired_state");
  });

  it("does not let one user's callback touch another user's connection", async () => {
    const h = harness(ALL_ROUTES);
    await getAuthorizationUrl({ userId: "user-a", redirectUri: REDIRECT }, h.deps);
    await handleCallback({ code: "code-1", state: "fixed-state" }, h.deps);
    expect(h.youtubeStore.connections.has("user-a")).toBe(true);
    expect(h.youtubeStore.connections.has("user-b")).toBe(false);
  });
});

describe("mapping", () => {
  it("keeps NULL as NULL and 0 as 0", () => {
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrNull("0")).toBe(0);
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
    expect(numberOrNull("")).toBeNull();

    const mapped = mapAnalyticsReport({
      columnHeaders: [{ name: "views" }, { name: "likes" }],
      rows: [[0, null]],
    });
    expect(mapped.views).toBe(0);
    expect(mapped.likes).toBeNull();
    // Metrics YouTube never returned stay null.
    expect(mapped.impressions).toBeNull();
    expect(mapped.impressionCtr).toBeNull();
    expect(mapAnalyticsReport(null)).toEqual(EMPTY_METRICS);
  });

  it("maps a channel without inventing hidden values", () => {
    const mapped = mapChannel({
      id: "UC1",
      snippet: { title: "T", country: "US", thumbnails: { default: { url: "u" } } },
      statistics: { hiddenSubscriberCount: true, viewCount: "0" },
    });
    expect(mapped.channelId).toBe("UC1");
    expect(mapped.country).toBe("US");
    expect(mapped.subscriberCount).toBeNull();
    expect(mapped.viewCount).toBe(0);
    expect(mapped.videoCount).toBeNull();
    expect(mapped.thumbnailUrl).toBe("u");
  });

  it("maps videos with real timestamps and durations", () => {
    expect(parseIsoDuration("PT1M5S")).toBe(65);
    expect(parseIsoDuration("bogus")).toBeNull();
    const mapped = mapVideo({
      id: "v1",
      snippet: { title: "T", publishedAt: "2026-01-02T03:04:05Z" },
      contentDetails: { duration: "PT45S" },
      status: { privacyStatus: "unlisted" },
    });
    expect(mapped.publishedAt).toBe("2026-01-02T03:04:05Z");
    expect(mapped.durationSeconds).toBe(45);
    expect(mapped.shortForm).toBe(true);
    expect(mapped.privacyStatus).toBe("unlisted");
    expect(mapVideo({ id: "v2" }).publishedAt).toBeNull();
  });

  it("maps traffic sources and US share only when present", () => {
    expect(mapTrafficSources(null)).toBeNull();
    expect(
      mapTrafficSources({
        columnHeaders: [{ name: "insightTrafficSourceType" }, { name: "views" }],
        rows: [["BROWSE", 10]],
      }),
    ).toEqual({ BROWSE: 10 });
    expect(mapUsShare(null)).toBeNull();
    expect(
      mapUsShare({
        columnHeaders: [{ name: "country" }, { name: "views" }],
        rows: [
          ["US", 3],
          ["IN", 1],
        ],
      }),
    ).toBe(75);
  });
});

describe("channel + video sync", () => {
  it("persists the connected channel into channel_profile", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    const profile = await h.channelStore.getChannelProfile(USER);
    expect(profile?.channelId).toBe("UC123");
    expect(profile?.channelTitle).toBe("Story Channel");
    expect(profile?.country).toBe("US");
    expect(profile?.subscriberCount).toBe(0);
    const status = await getConnectedChannel(USER, h.deps);
    expect(status.connection).toBe("CONNECTED");
    expect(status.thumbnailUrl).toBe("https://img/high.jpg");
    expect(JSON.stringify(status)).not.toContain("access-1");
  });

  it("runs an initial full sync, then an incremental one", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);

    const first = await syncVideos(USER, { full: true }, h.deps);
    expect(first.incremental).toBe(false);
    expect(first.videoIds.sort()).toEqual(["vid-new", "vid-old"]);

    const second = await syncVideos(USER, undefined, h.deps);
    expect(second.incremental).toBe(true);
    // Videos published before the previous successful sync are not re-fetched.
    expect(second.videoIds).toEqual([]);
    expect((await h.channelStore.listVideos(USER)).length).toBe(2);
  });

  it("is idempotent across repeated syncs", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    await syncChannel(USER, h.deps);
    await syncVideos(USER, { full: true }, h.deps);
    await syncVideos(USER, { full: true }, h.deps);
    await syncAnalytics(USER, undefined, h.deps);
    await syncAnalytics(USER, undefined, h.deps);

    expect((await h.channelStore.listVideos(USER)).length).toBe(2);
    const metrics = await h.channelStore.listMetrics(USER);
    const keys = metrics.map((m) => `${m.videoId}:${m.windowKey}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(h.youtubeStore.rawMetrics.length).toBe(2);
  });
});

describe("analytics sync", () => {
  it("stores observed zeros as 0 and unavailable metrics as NULL", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    await syncVideos(USER, { full: true }, h.deps);
    const result = await syncAnalytics(USER, undefined, h.deps);
    expect(result.rows).toBeGreaterThan(0);

    const metrics = await h.channelStore.listMetrics(USER);
    const row = metrics.find((m) => m.videoId === "vid-new" && m.windowKey === "24h");
    expect(row).toBeDefined();
    expect(row!.metrics.views).toBe(0);
    expect(row!.metrics.likes).toBe(0);
    // The impressions request failed → unavailable, never coerced to zero.
    expect(row!.metrics.impressions).toBeNull();
    expect(row!.metrics.impressionCtr).toBeNull();
    expect(row!.metrics.trafficSources).toEqual({ BROWSE: 4 });
    expect(row!.metrics.usShare).toBe(75);
  });

  it("only collects age-complete windows", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    await syncVideos(USER, { full: true }, h.deps);
    await syncAnalytics(USER, undefined, h.deps);
    const windows = (await h.channelStore.listMetrics(USER))
      .filter((m) => m.videoId === "vid-new")
      .map((m) => m.windowKey)
      .sort();
    // vid-new is 9 days old at NOW: 24h/48h/7d complete, 28d not yet.
    expect(windows).toEqual(["24h", "48h", "7d"]);
  });
});

describe("token refresh and revocation", () => {
  it("refreshes an expired access token server-side", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    await h.youtubeStore.saveConnection(USER, {
      tokenExpiresAt: new Date(NOW.getTime() - 60_000).toISOString(),
      accessToken: "stale",
    });
    const token = await refreshAccessToken(USER, h.deps);
    expect(token).toBe("access-1");
    expect(h.youtubeStore.connections.get(USER)?.status).toBe("CONNECTED");
  });

  it("marks the connection NEEDS_RECONNECT when authorization was revoked", async () => {
    const revoked: Route = (url) =>
      url === "https://oauth2.googleapis.com/token"
        ? json({ error: "invalid_grant" }, 400)
        : undefined;
    const h = harness([revoked, CHANNEL_ROUTE]);
    await h.youtubeStore.saveConnection(USER, {
      accessToken: "old",
      refreshToken: "refresh-1",
      tokenExpiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      status: "CONNECTED",
    });
    await expect(refreshAccessToken(USER, h.deps)).rejects.toBeInstanceOf(YouTubeAuthError);
    expect(h.youtubeStore.connections.get(USER)?.status).toBe("NEEDS_RECONNECT");

    const status = await getConnectedChannel(USER, h.deps);
    expect(status.connection).toBe("NEEDS_RECONNECT");
    await expect(syncChannel(USER, h.deps)).rejects.toBeInstanceOf(YouTubeAuthError);
  });

  it("disconnects and forgets the stored credentials", async () => {
    const h = harness([
      ...ALL_ROUTES,
      (url) => (url === "https://oauth2.googleapis.com/revoke" ? json({}) : undefined),
    ]);
    await connect(h);
    await disconnectChannel(USER, h.deps);
    expect(h.youtubeStore.connections.has(USER)).toBe(false);
    expect((await getConnectedChannel(USER, h.deps)).connection).toBe("NOT_CONNECTED");
  });
});

describe("brain feedback loop", () => {
  it("feeds real observations into the existing Brain", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    const result = await syncAll(USER, { full: true }, h.deps);

    expect(result.videos.synced).toBe(2);
    expect(result.analytics.rows).toBeGreaterThan(0);
    expect(result.brain.videosAnalyzed).toBe(2);
    expect(result.brain.strategyVersion).toBeGreaterThanOrEqual(1);

    const strategy = await h.channelStore.latestStrategy(USER);
    expect(strategy).not.toBeNull();
    // 0 views with completed observation windows must reach the brain as a
    // real observation rather than as missing data.
    const learnings = await h.channelStore.listLearningRows(USER);
    expect(learnings.length).toBeGreaterThan(0);

    const sync = await h.channelStore.listSyncLog(USER);
    expect(sync.some((row) => row.kind === "analytics" && row.status === "SUCCESS")).toBe(true);
  });

  it("does not duplicate learning rows or baselines when run twice", async () => {
    const h = harness(ALL_ROUTES);
    await connect(h);
    await syncAll(USER, { full: true }, h.deps);
    const afterFirst = {
      learnings: (await h.channelStore.listLearningRows(USER)).length,
      baselines: (await h.channelStore.listBaselines(USER)).length,
      videos: (await h.channelStore.listVideos(USER)).length,
      metrics: (await h.channelStore.listMetrics(USER)).length,
    };
    await syncAll(USER, { full: true }, h.deps);
    expect({
      learnings: (await h.channelStore.listLearningRows(USER)).length,
      baselines: (await h.channelStore.listBaselines(USER)).length,
      videos: (await h.channelStore.listVideos(USER)).length,
      metrics: (await h.channelStore.listMetrics(USER)).length,
    }).toEqual(afterFirst);
  });
});
