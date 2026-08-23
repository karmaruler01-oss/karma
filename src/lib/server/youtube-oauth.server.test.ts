// Step 3 coverage: user isolation, graceful failures, OAuth denial,
// rate limiting and "not configured" sync behavior. The canonical YouTube
// surface is faked — no network, no database, no real credentials.

import { describe, expect, it } from "vitest";

import { createMemoryChannelStore } from "@/lib/channel/store.memory";
import { createMemoryYouTubeStore } from "./youtube-store.memory";
import {
  disconnectChannel,
  getAuthorizationUrl,
  getConnectedChannel,
  handleCallback,
  refreshAccessToken,
  syncAll,
  syncChannel,
  YouTubeAuthError,
  YouTubeNotConfiguredError,
  type YouTubeDeps,
} from "./youtube.server";

const NOW = new Date("2026-03-01T00:00:00.000Z");
const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret" };
const REDIRECT = "https://app.example/api/public/youtube/callback";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Route = (url: string, init?: RequestInit) => Response | undefined;

function harness(routes: Route[], overrides?: Partial<YouTubeDeps>) {
  const channelStore = createMemoryChannelStore(() => NOW.toISOString());
  const youtubeStore = createMemoryYouTubeStore();
  const deps: YouTubeDeps = {
    credentials: CREDENTIALS,
    now: () => NOW,
    store: channelStore,
    connections: youtubeStore,
    randomState: () => "fixed-state",
    fetch: async (url, init) => {
      for (const route of routes) {
        const response = route(url, init);
        if (response) return response;
      }
      return json({ error: "unexpected_request", url }, 404);
    },
    ...overrides,
  };
  return { deps, channelStore, youtubeStore };
}

const TOKEN_ROUTE: Route = (url) =>
  url === "https://oauth2.googleapis.com/token"
    ? json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 })
    : undefined;

const CHANNEL_ROUTE: Route = (url) =>
  url.includes("/channels?")
    ? json({
        items: [
          {
            id: "UC-A",
            snippet: { title: "Channel A", thumbnails: {} },
            statistics: { subscriberCount: "5", viewCount: "10", videoCount: "1" },
            contentDetails: { relatedPlaylists: { uploads: "UU-A" } },
          },
        ],
      })
    : undefined;

async function connectUser(h: ReturnType<typeof harness>, userId: string) {
  await getAuthorizationUrl({ userId, redirectUri: REDIRECT }, h.deps);
  return handleCallback({ code: "code-1", state: "fixed-state" }, h.deps);
}

describe("user isolation", () => {
  it("keeps connections, status and sync strictly per user", async () => {
    const h = harness([TOKEN_ROUTE, CHANNEL_ROUTE]);
    await connectUser(h, "user-a");

    const a = await getConnectedChannel("user-a", h.deps);
    expect(a.connection).toBe("CONNECTED");
    expect(a.channelId).toBe("UC-A");

    // Another user sees none of user-a's data.
    const b = await getConnectedChannel("user-b", h.deps);
    expect(b.connection).toBe("NOT_CONNECTED");
    expect(b.channelId).toBeNull();
    expect(b.subscriberCount).toBeNull();
    expect(h.youtubeStore.connections.has("user-b")).toBe(false);

    // And cannot sync or refresh without their own completed OAuth.
    await expect(syncChannel("user-b", h.deps)).rejects.toBeInstanceOf(YouTubeAuthError);
    await expect(refreshAccessToken("user-b", h.deps)).rejects.toThrow("not_connected");

    // Disconnecting user-a leaves no trace and does not affect the flow for
    // a fresh user.
    await disconnectChannel("user-a", h.deps);
    expect((await getConnectedChannel("user-a", h.deps)).connection).toBe("NOT_CONNECTED");
  });
});

describe("oauth denial and validation", () => {
  it("surfaces a user-safe error when authorization is denied at Google", async () => {
    const h = harness([TOKEN_ROUTE, CHANNEL_ROUTE]);
    await getAuthorizationUrl({ userId: "user-a", redirectUri: REDIRECT }, h.deps);
    await expect(
      handleCallback({ error: "access_denied", state: "fixed-state" }, h.deps),
    ).rejects.toThrow("authorization_denied");
    // Nothing was stored for the denied attempt.
    expect(h.youtubeStore.connections.has("user-a")).toBe(false);
  });

  it("rejects a callback when the provider is not configured at all", async () => {
    const h = harness([], { credentials: null });
    await expect(
      handleCallback({ code: "c", state: "s" }, h.deps),
    ).rejects.toBeInstanceOf(YouTubeNotConfiguredError);
  });
});

describe("sync when YouTube is unavailable", () => {
  it("fails gracefully with NOT_CONFIGURED when credentials are missing", async () => {
    const h = harness([], { credentials: null });
    await expect(syncAll("user-a", { full: true }, h.deps)).rejects.toBeInstanceOf(
      YouTubeNotConfiguredError,
    );
    // Status stays a clean configuration state — never a crash, never fake data.
    const status = await getConnectedChannel("user-a", h.deps);
    expect(status.provider).toBe("NOT_CONFIGURED");
    expect(status.connection).toBe("NOT_CONFIGURED");
  });
});

describe("youtube api failures", () => {
  it("treats rate limiting as a retryable error, not a lost authorization", async () => {
    const rateLimited: Route = (url) =>
      url.includes("/channels?") ? json({ error: { message: "quota" } }, 429) : undefined;
    const h = harness([TOKEN_ROUTE, rateLimited]);
    await h.youtubeStore.saveConnection("user-a", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenExpiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
      status: "CONNECTED",
    });

    await expect(syncChannel("user-a", h.deps)).rejects.toThrow("youtube_request_failed_429");

    // The connection must NOT be downgraded to NEEDS_RECONNECT on a 429.
    expect(h.youtubeStore.connections.get("user-a")?.status).toBe("CONNECTED");

    // The failed sync is recorded honestly in the sync log.
    const log = await h.channelStore.listSyncLog("user-a", 5);
    expect(log.some((row) => row.status === "FAILED")).toBe(true);
    expect(log.some((row) => row.status === "SUCCESS")).toBe(false);
  });

  it("marks the connection NEEDS_RECONNECT on repeated 401/403 from YouTube", async () => {
    const forbidden: Route = (url) =>
      url.includes("/channels?") ? json({ error: { message: "forbidden" } }, 403) : undefined;
    const h = harness([TOKEN_ROUTE, forbidden]);
    await h.youtubeStore.saveConnection("user-a", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      tokenExpiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
      status: "CONNECTED",
    });

    await expect(syncChannel("user-a", h.deps)).rejects.toBeInstanceOf(YouTubeAuthError);
    expect(h.youtubeStore.connections.get("user-a")?.status).toBe("NEEDS_RECONNECT");
  });
});

describe("disconnect", () => {
  it("is safe to call when nothing is connected", async () => {
    const h = harness([]);
    await expect(disconnectChannel("user-a", h.deps)).resolves.toBeUndefined();
    expect((await getConnectedChannel("user-a", h.deps)).connection).toBe("NOT_CONNECTED");
  });
});
