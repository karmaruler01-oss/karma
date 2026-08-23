import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import {
  getConnectedChannel,
  syncAll,
  YouTubeAuthError,
  YouTubeNotConfiguredError,
} from "@/lib/server/youtube.server";

export const Route = createFileRoute("/api/youtube/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let userId: string;
        try {
          ({ userId } = await requireApiUser(request));
        } catch {
          return unauthorizedResponse();
        }

        let full = false;
        try {
          const body = (await request.json()) as { full?: boolean } | null;
          full = body?.full === true;
        } catch {
          full = false;
        }

        try {
          const result = await syncAll(userId, { full });
          return Response.json({ status: "SUCCESS", ...result });
        } catch (error) {
          if (error instanceof YouTubeNotConfiguredError) {
            return Response.json({ status: "NOT_CONFIGURED" }, { status: 503 });
          }
          if (error instanceof YouTubeAuthError) {
            // Never pretend a sync succeeded when authorization is gone.
            return Response.json(
              { status: "NEEDS_RECONNECT", connection: await getConnectedChannel(userId) },
              { status: 409 },
            );
          }
          console.error("[youtube] sync failed");
          return Response.json({ status: "ERROR" }, { status: 500 });
        }
      },
    },
  },
});
