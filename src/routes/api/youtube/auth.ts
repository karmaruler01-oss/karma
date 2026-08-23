import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import { callbackRedirectUri } from "@/lib/server/youtube-routes.server";
import { getAuthorizationUrl, YouTubeNotConfiguredError } from "@/lib/server/youtube.server";

export const Route = createFileRoute("/api/youtube/auth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let userId: string;
        try {
          ({ userId } = await requireApiUser(request));
        } catch {
          return unauthorizedResponse();
        }

        try {
          const { url } = await getAuthorizationUrl({
            userId,
            redirectUri: callbackRedirectUri(request),
          });
          return Response.json({ provider: "READY", authorizationUrl: url });
        } catch (error) {
          if (error instanceof YouTubeNotConfiguredError) {
            return Response.json({ provider: "NOT_CONFIGURED" }, { status: 503 });
          }
          console.error("[youtube] authorization url failed");
          return Response.json({ provider: "ERROR" }, { status: 500 });
        }
      },
    },
  },
});
