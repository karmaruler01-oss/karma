import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { IntelligenceSummary } from "@/lib/channel/intel/types";

export interface BrainApiResponse {
  status: string;
  summary: IntelligenceSummary | null;
  message: string | null;
}

/** UI-level state, derived from the connection state plus the Brain payload. */
export type BrainSurfaceState =
  | "LOADING"
  | "NOT_CONFIGURED"
  | "NOT_SYNCED"
  | "INSUFFICIENT_DATA"
  | "READY"
  | "ERROR";

const STATE_LABEL: Record<BrainSurfaceState, string> = {
  LOADING: "…",
  NOT_CONFIGURED: "NOT CONFIGURED",
  NOT_SYNCED: "NOT SYNCED",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA",
  READY: "READY",
  ERROR: "ERROR",
};

const STATE_COPY: Record<BrainSurfaceState, string> = {
  LOADING: "Reading what the Brain currently knows…",
  NOT_CONFIGURED:
    "YouTube isn't configured for this environment yet, so the Brain has nothing real to observe.",
  NOT_SYNCED:
    "No analysis has been stored yet. Run a sync so the Brain can observe your real channel data.",
  INSUFFICIENT_DATA:
    "The Brain has data but not enough of it to draw trustworthy conclusions yet.",
  READY: "Conclusions below are derived only from analytics your channel actually reported.",
  ERROR: "The Brain summary could not be loaded.",
};

export function deriveBrainState(input: {
  isPending: boolean;
  isError: boolean;
  notConfigured: boolean;
  payload: BrainApiResponse | undefined;
}): BrainSurfaceState {
  if (input.notConfigured) return "NOT_CONFIGURED";
  if (input.isPending) return "LOADING";
  if (input.isError || input.payload?.status === "ERROR") return "ERROR";
  const status = input.payload?.status;
  if (!input.payload?.summary) {
    return status === "NOT_CONNECTED" || status === "SYNC_REQUIRED" ? "NOT_SYNCED" : "ERROR";
  }
  if (status === "INSUFFICIENT_DATA") return "INSUFFICIENT_DATA";
  if (status === "SYNC_REQUIRED" || status === "NOT_CONNECTED") return "NOT_SYNCED";
  if (status === "READY") return "READY";
  return "INSUFFICIENT_DATA";
}

const fmtDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Never";

export function BrainSummaryCard({
  notConfigured,
  fetcher,
}: {
  notConfigured: boolean;
  fetcher: () => Promise<BrainApiResponse>;
}) {
  const brain = useQuery({
    queryKey: ["youtube-brain"],
    queryFn: fetcher,
    enabled: !notConfigured,
    retry: false,
  });

  const state = deriveBrainState({
    isPending: brain.isPending,
    isError: brain.isError,
    notConfigured,
    payload: brain.data,
  });
  const summary = state === "READY" || state === "INSUFFICIENT_DATA" ? brain.data?.summary : null;
  const quality = summary?.dataQuality;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Brain summary</CardTitle>
            <CardDescription>{STATE_COPY[state]}</CardDescription>
          </div>
          <Badge variant={state === "READY" ? "default" : "secondary"}>{STATE_LABEL[state]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {state === "ERROR" && brain.data?.message && (
          <p className="text-sm text-destructive">{brain.data.message}</p>
        )}

        {summary && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Videos analyzed" value={String(summary.videosAnalyzed)} />
              <Stat label="With metrics" value={String(summary.videosWithMetrics)} />
              <Stat label="Confidence" value={summary.confidence} />
              <Stat label="Window" value={summary.windowKey ?? "—"} />
            </div>

            <div className="grid gap-1 text-sm text-muted-foreground">
              <span>Last analysis: {fmtDate(summary.lastAnalysisAt ?? summary.generatedAt)}</span>
              <span>Last observation: {fmtDate(quality?.lastObservationAt ?? null)}</span>
            </div>

            <Separator />

            <Section title="Data quality">
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>
                  {quality?.videosWithMetrics ?? 0} of {quality?.videosTotal ?? 0} videos have
                  usable metrics
                  {quality?.smallSample ? " · small sample" : ""}
                  {quality?.staleData ? " · data is stale" : ""}
                </li>
                {(quality?.unavailableFields.length ?? 0) > 0 && (
                  <li>Not reported by YouTube: {quality?.unavailableFields.join(", ")}</li>
                )}
                {quality?.notes.map((note) => <li key={note}>{note}</li>)}
              </ul>
            </Section>

            <ListSection
              title="Key learnings"
              empty="No learnings confirmed yet."
              items={summary.learnings.map((learning) => ({
                key: learning.key,
                primary: learning.observation,
                secondary: `${learning.status} · ${learning.confidence} confidence · ${learning.occurrences} observation(s) · sample ${learning.sampleSize}`,
              }))}
            />

            <ListSection
              title="Strongest findings"
              empty="No repeated patterns detected yet."
              items={summary.strongestFindings.map((finding) => ({
                key: finding.key,
                primary: finding.observation,
                secondary: `${finding.label} · ${finding.direction} · sample ${finding.sampleSize}`,
              }))}
            />

            <ListSection
              title="Active experiments"
              empty="No experiments are running."
              items={summary.activeExperiments.map((experiment) => ({
                key: experiment.key,
                primary: experiment.hypothesis,
                secondary: `${experiment.status} · target ${experiment.targetMetric} · ${experiment.successCriteria}`,
              }))}
            />

            {summary.proposedExperiments.length > 0 && (
              <ListSection
                title="Proposed experiments"
                empty=""
                items={summary.proposedExperiments.map((experiment) => ({
                  key: experiment.key,
                  primary: experiment.hypothesis,
                  secondary: experiment.whatChanged,
                }))}
              />
            )}

            <Section title="Current strategy">
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {summary.strategySummary.sufficiency === "SUFFICIENT"
                    ? `Based on ${summary.strategySummary.videosAnalyzed} analyzed video(s).`
                    : "Not enough evidence for a strategy yet."}
                </p>
                <StrategyList label="Priorities" values={summary.strategySummary.priorities} />
                <StrategyList
                  label="Strongest themes"
                  values={summary.strategySummary.strongestThemes}
                />
                <StrategyList
                  label="Promising formats"
                  values={summary.strategySummary.promisingFormats}
                />
                <StrategyList label="Weak formats" values={summary.strategySummary.weakFormats} />
                <StrategyList
                  label="Titles to test"
                  values={summary.strategySummary.titlePatternsToTest}
                />
                <StrategyList
                  label="Publishing"
                  values={summary.strategySummary.publishingObservations}
                />
              </div>
            </Section>

            <ListSection
              title="Recommendations"
              empty="No recommendations yet."
              items={summary.recommendations.map((recommendation) => ({
                key: recommendation.key,
                primary: recommendation.title,
                secondary: `${recommendation.explanation} — next: ${recommendation.nextAction} (${recommendation.impact} impact, ${recommendation.confidence} confidence)`,
              }))}
            />

            {summary.notes.length > 0 && (
              <p className="text-xs text-muted-foreground">{summary.notes.join(" · ")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ListSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { key: string; primary: string; secondary: string }[];
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        empty ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : null
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.key} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium break-words">{item.primary}</p>
              <p className="mt-1 text-xs text-muted-foreground break-words">{item.secondary}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function StrategyList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <p>
      <span className="font-medium text-foreground">{label}:</span> {values.join("; ")}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold break-words">{value}</p>
    </div>
  );
}
