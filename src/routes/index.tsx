import { createFileRoute, Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Channel Intelligence Engine — YouTube analytics brain" },
      {
        name: "description",
        content:
          "Connect your YouTube channel, sync real retention, CTR and traffic data, and let the Channel Brain turn it into your next video strategy.",
      },
      { property: "og:title", content: "Channel Intelligence Engine" },
      {
        property: "og:description",
        content: "Real YouTube analytics, synced and turned into a data-driven video strategy.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Your channel, learned from its own numbers
      </h1>
      <p className="mt-4 max-w-xl text-muted-foreground">
        Connect YouTube once. Every sync pulls real views, watch time, retention, impressions and
        traffic sources, then updates the Channel Brain and your next video strategy.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg">
          <Link to="/settings">Connect your channel</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
