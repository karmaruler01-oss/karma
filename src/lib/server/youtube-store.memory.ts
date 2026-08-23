// In-memory YouTube connection store. Used by unit tests only — no network,
// no database, no real credentials.

import type {
  OAuthStateRecord,
  RawMetricsRow,
  StoredConnection,
  YouTubeConnectionStore,
} from "./youtube.server";

export interface MemoryYouTubeStore extends YouTubeConnectionStore {
  saveVideoExtras: NonNullable<YouTubeConnectionStore["saveVideoExtras"]>;
  states: Map<string, OAuthStateRecord>;
  connections: Map<string, StoredConnection>;
  rawMetrics: RawMetricsRow[];
  videoExtras: Map<string, { thumbnailUrl: string | null; privacyStatus: string | null; tags: string[] }>;
}

export function createMemoryYouTubeStore(): MemoryYouTubeStore {
  const states = new Map<string, OAuthStateRecord>();
  const connections = new Map<string, StoredConnection>();
  const rawMetrics: RawMetricsRow[] = [];
  const videoExtras = new Map<
    string,
    { thumbnailUrl: string | null; privacyStatus: string | null; tags: string[] }
  >();

  return {
    states,
    connections,
    rawMetrics,
    videoExtras,

    async createOAuthState(record) {
      states.set(record.state, record);
    },

    async consumeOAuthState(state) {
      const record = states.get(state) ?? null;
      states.delete(state);
      return record;
    },

    async getConnection(userId) {
      return connections.get(userId) ?? null;
    },

    async saveConnection(userId, patch) {
      const current: StoredConnection = connections.get(userId) ?? {
        userId,
        channelId: null,
        channelTitle: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        scope: null,
        status: "CONNECTED",
        error: null,
        connectedAt: null,
      };
      const next: StoredConnection = { ...current };
      for (const [key, value] of Object.entries(patch)) {
        if (key === "userId" || value === undefined) continue;
        (next as unknown as Record<string, unknown>)[key] = value;
      }
      connections.set(userId, next);
      return next;
    },

    async deleteConnection(userId) {
      connections.delete(userId);
    },

    async saveRawMetrics(rows) {
      for (const row of rows) {
        const index = rawMetrics.findIndex(
          (existing) =>
            existing.userId === row.userId &&
            existing.videoId === row.videoId &&
            existing.windowKey === row.windowKey,
        );
        if (index >= 0) rawMetrics[index] = row;
        else rawMetrics.push(row);
      }
      return rows.length;
    },

    async saveVideoExtras(userId, extras) {
      for (const extra of extras) {
        videoExtras.set(`${userId}:${extra.videoId}`, {
          thumbnailUrl: extra.thumbnailUrl,
          privacyStatus: extra.privacyStatus,
          tags: extra.tags,
        });
      }
    },
  };
}
