import { createFileRoute } from "@tanstack/react-router";

import { requireApiUser, unauthorizedResponse } from "@/lib/server/api-auth.server";
import { readBrainSummary } from "@/lib/channel/intel/orchestrator.server";

/**
 * Read-only view of what the Brain currently understands about the signed-in
 * user's channel. Never triggers a sync and never returns tokens; when nothing
 * has been analyzed yet it says so explicitly instead of inventing a summary.
 */
export const Route = createFileRoute("/api/youtube/brain")({
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
          const summary = await readBrainSummary(userId);
          if (!summary) {
            return Response.json(
              {
                status: "SYNC_REQUIRED",
                summary: null,
                message:
                  "No analysis has been stored yet. Run a sync to let the Brain observe the channel.",
              },
              { headers: { "Cache-Control": "private, no-store" } },
            );
          }
          return Response.json(
            { status: summary.status, summary, message: null },
            { headers: { "Cache-Control": "private, no-store" } },
          );
        } catch {
          console.error("[youtube] brain summary failed");
          return Response.json(
            { status: "ERROR", summary: null, message: "Brain summary unavailable." },
            { status: 500 },
          );
        }
      },
    },
  },
});
