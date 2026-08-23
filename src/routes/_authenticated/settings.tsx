import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BrainSummaryCard, type BrainApiResponse } from "@/components/brain/BrainSummaryCard";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "YouTube connection — Channel Intelligence Engine" },
      {
        name: "description",
        content:
          "Connect your YouTube channel, sync real analytics and feed the Channel Brain with fresh performance data.",
      },
      { property: "og:title", content: "YouTube connection — Channel Intelligence Engine" },
      {
        property: "og:description",
        content: "Connect YouTube and sync analytics into the Channel Brain.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

interface YouTubeStatus {
  provider: string;
  connection: string;
  channelId: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  country: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  return { ok: response.ok, status: response.status, body };
}

const fmt = (value: number | null) => (value === null ? "—" : value.toLocaleString());
const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Never";

function SettingsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const status = useQuery({
    queryKey: ["youtube-status"],
    queryFn: async () => {
      const { ok, body } = await authedFetch("/api/youtube/status");
      if (!ok) throw new Error("Could not load connection status");
      return body as YouTubeStatus;
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("youtube") === "connected") toast.success("YouTube channel connected.");
    if (params.get("youtube") === "error") {
      toast.error(`YouTube connection failed: ${params.get("reason") ?? "unknown error"}`);
    }
    if (params.get("youtube") === "not_configured") {
      toast.error("YouTube isn't configured yet.");
    }
    if (params.has("youtube")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const connect = useMutation({
    mutationFn: async () => {
      const { ok, body } = await authedFetch("/api/youtube/auth");
      const data = body as { authorizationUrl?: string; provider?: string };
      if (!ok || !data?.authorizationUrl) {
        throw new Error(
          data?.provider === "NOT_CONFIGURED"
            ? "YouTube isn't configured yet — add the Google client credentials first."
            : "Could not start the YouTube connection",
        );
      }
      window.location.href = data.authorizationUrl;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const { ok } = await authedFetch("/api/youtube/disconnect", { method: "POST" });
      if (!ok) throw new Error("Could not disconnect");
    },
    onSuccess: () => {
      toast.success("Disconnected.");
      queryClient.invalidateQueries({ queryKey: ["youtube-status"] });
      queryClient.invalidateQueries({ queryKey: ["youtube-brain"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sync = useMutation({
    mutationFn: async (full: boolean) => {
      const { ok, body } = await authedFetch("/api/youtube/sync", {
        method: "POST",
        body: JSON.stringify({ full }),
      });
      const data = body as { status?: string };
      if (!ok) {
        throw new Error(
          data?.status === "NEEDS_RECONNECT"
            ? "Your YouTube authorization expired — reconnect the channel."
            : data?.status === "NOT_CONFIGURED"
              ? "YouTube isn't configured yet."
              : "Sync failed",
        );
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Sync complete — the Channel Brain has been updated.");
      queryClient.invalidateQueries({ queryKey: ["youtube-status"] });
      queryClient.invalidateQueries({ queryKey: ["youtube-brain"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = status.data;
  const connected = data?.connection === "CONNECTED";

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Channel connection</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect YouTube so the Channel Brain learns from your real analytics.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            await supabase.auth.signOut();
            queryClient.clear();
            navigate({ to: "/auth" });
          }}
        >
          Sign out
        </Button>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>YouTube</CardTitle>
              <CardDescription>
                {status.isPending
                  ? "Checking connection…"
                  : connected
                    ? (data?.channelTitle ?? "Connected channel")
                    : "No channel connected yet"}
              </CardDescription>
            </div>
            <Badge variant={connected ? "default" : "secondary"}>
              {status.isPending ? "…" : (data?.connection ?? "UNKNOWN")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {data?.provider === "NOT_CONFIGURED" && (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              The YouTube provider isn't configured. Add the Google OAuth client ID and secret to
              enable real connections.
            </p>
          )}
          {data?.error && <p className="text-sm text-destructive">{data.error}</p>}

          {connected && (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Subscribers" value={fmt(data?.subscriberCount ?? null)} />
                <Stat label="Views" value={fmt(data?.viewCount ?? null)} />
                <Stat label="Videos" value={fmt(data?.videoCount ?? null)} />
                <Stat label="Country" value={data?.country ?? "—"} />
              </div>
              <Separator />
              <div className="grid gap-1 text-sm text-muted-foreground">
                <span>Connected: {fmtDate(data?.connectedAt ?? null)}</span>
                <span>Last sync: {fmtDate(data?.lastSyncedAt ?? null)}</span>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            {connected ? (
              <>
                <Button onClick={() => sync.mutate(false)} disabled={sync.isPending}>
                  {sync.isPending ? "Syncing…" : "Sync now"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => sync.mutate(true)}
                  disabled={sync.isPending}
                >
                  Full resync
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? "Redirecting…" : "Connect YouTube"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <BrainSummaryCard
        notConfigured={data?.provider === "NOT_CONFIGURED"}
        fetcher={async () => {
          const { ok, body } = await authedFetch("/api/youtube/brain");
          if (!ok && !body) throw new Error("Could not load the Brain summary");
          return body as BrainApiResponse;
        }}
      />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
