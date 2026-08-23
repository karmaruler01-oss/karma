import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import { getConnectedChannel } from "@/lib/server/youtube.server";

export const Route = createFileRoute("/api/youtube/status")({
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
          // Contains no tokens by construction.
          return Response.json(await getConnectedChannel(userId));
        } catch {
          console.error("[youtube] status failed");
          return Response.json({ provider: "ERROR", connection: "ERROR" }, { status: 500 });
        }
      },
    },
  },
});
