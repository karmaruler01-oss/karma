import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import {
  getConnectedChannel,
  refreshAccessToken,
  YouTubeAuthError,
  YouTubeNotConfiguredError,
} from "@/lib/server/youtube.server";

// Explicitly refreshes the stored access token server-side. The new token is
// persisted but never returned — the response is the token-free status DTO.
export const Route = createFileRoute("/api/youtube/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          ({ userId } = await requireApiUser(request));
        } catch {
          return unauthorizedResponse();
        }

        try {
          await refreshAccessToken(userId);
          return Response.json(await getConnectedChannel(userId));
        } catch (error) {
          if (error instanceof YouTubeNotConfiguredError) {
            return Response.json({ provider: "NOT_CONFIGURED" }, { status: 503 });
          }
          if (error instanceof YouTubeAuthError) {
            return Response.json(
              { status: "NEEDS_RECONNECT", connection: await getConnectedChannel(userId) },
              { status: 409 },
            );
          }
          console.error("[youtube] token refresh failed");
          return Response.json({ provider: "ERROR", connection: "ERROR" }, { status: 500 });
        }
      },
    },
  },
});
