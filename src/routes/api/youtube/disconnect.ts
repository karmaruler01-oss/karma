import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import { disconnectChannel, getConnectedChannel } from "@/lib/server/youtube.server";

export const Route = createFileRoute("/api/youtube/disconnect")({
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
          await disconnectChannel(userId);
          return Response.json(await getConnectedChannel(userId));
        } catch {
          console.error("[youtube] disconnect failed");
          return Response.json({ provider: "ERROR", connection: "ERROR" }, { status: 500 });
        }
      },
    },
  },
});
