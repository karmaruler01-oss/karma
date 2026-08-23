import { createFileRoute } from "@tanstack/react-router";

import { settingsRedirect } from "@/lib/server/youtube-routes.server";
import {
  handleCallback,
  YouTubeAuthError,
  YouTubeNotConfiguredError,
} from "@/lib/server/youtube.server";

// Public only in the routing sense: Google performs this redirect. The user
// association is proven by the single-use, expiring OAuth state row.
export const Route = createFileRoute("/api/public/youtube/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        try {
          const result = await handleCallback({
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
            error: url.searchParams.get("error"),
          });
          return settingsRedirect(request, {
            youtube: "connected",
            ...(result.channelTitle ? { channel: result.channelTitle } : {}),
          });
        } catch (error) {
          if (error instanceof YouTubeNotConfiguredError) {
            return settingsRedirect(request, { youtube: "not_configured" });
          }
          const reason =
            error instanceof YouTubeAuthError ? error.message : "connection_failed";
          console.error(`[youtube] callback failed: ${reason}`);
          return settingsRedirect(request, { youtube: "error", reason });
        }
      },
    },
  },
});
