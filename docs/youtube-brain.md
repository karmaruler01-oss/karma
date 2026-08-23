# YouTube Channel Brain — implemented architecture

This document describes what is actually implemented today. Anything not listed
here does not exist yet; see [Current limitations](#current-limitations).

## 1. Brain data flow

```text
YouTube Data API + YouTube Analytics API
        │  (server only, per user, OAuth tokens)
        ▼
syncChannel → syncVideos → syncAnalytics        src/lib/server/youtube.server.ts
        ▼  persisted facts + observed metrics
channel store (Supabase, RLS scoped)            src/lib/channel/store.supabase.ts
        ▼
Step 3 brain: analyzeVideoPerformance → analyzeChannel →
recalculateChannelBaseline → updateChannelBrain →
createNextVideoStrategy                          src/lib/channel/brain*.ts
        ▼
Step 4 intelligence cycle (runBrainCycle)        src/lib/channel/intel/orchestrator.server.ts
  normalized metrics → cohorts/baselines → diagnostics → patterns →
  learnings → experiments → strategy summary → recommendations
        ▼
IntelligenceSummary persisted on the current strategy row
        ▼
GET /api/youtube/brain  →  Settings "Brain summary" card
```

`syncAll()` runs the whole chain; the intelligence cycle always runs last so it
observes everything the earlier steps stored.

## 2. Normalized metrics

`src/lib/channel/intel/metrics.ts` converts raw observations into
`NormalizedMetrics`, where every field carries a provenance:

- `REAL` — reported by a YouTube API (`0` is a real observation).
- `DERIVED` — computed only from `REAL` values (ratios, per-hour rates).
- `UNAVAILABLE` — value is `null` with a note. Never a guessed number.

Reported fields: views, likes, comments, shares, subscribers gained/lost, watch
time, average view duration, average view percentage, impressions, impression
CTR, duration, US share. Derived fields: views/hour, views/day, engagement rate,
like rate, comment rate, subscriber conversion rate. Each record also stores the
observation window, publish date, age in hours and a `completeness` share.

## 3. Baselines and cohorts

`src/lib/channel/intel/cohorts.ts` never compares a video to an absolute target;
it compares it to the channel's own history inside the same observation window.

Cohort kinds: `ALL`, `RECENT` (newest N uploads), `FORMAT`, `DURATION`
(`0-60s`, `1-3min`, `3-8min`, `8-20min`, `20min+`) and `TOPIC`.

Each cohort reports sample size, median/mean views, p25/p75, median retention, a
chronological trend (`RISING` / `FLAT` / `FALLING` / `INSUFFICIENT_DATA`, older
half vs newer half) and a sufficiency flag. Cohorts below `minCohortSample` are
marked `INSUFFICIENT_DATA` and are not used for verdicts.

## 4. Diagnostics

`src/lib/channel/intel/diagnostics.ts` produces a `VideoDiagnosis` per video:
status (`OUTPERFORMING` / `NORMAL` / `UNDERPERFORMING` / `INSUFFICIENT_DATA`),
the cohort comparisons behind it, positive and negative signals (CTR, retention,
impressions, engagement), a confidence level and score, a plain-language
explanation and a recommended action. Videos younger than
`minObservationHours` are never judged.

## 5. Pattern detection

`src/lib/channel/intel/patterns.ts` looks for repeated traits across real
uploads in four families: `TOPIC`, `TITLE`, `FORMAT`, `PUBLISHING`.

Title features extracted: length, word count, question mark, number, colon,
all-caps word, length band. Publishing features: weekday and hour bucket.

A pattern is only emitted when at least `minPatternSample` videos share the
trait and the group's median views differ from the rest of the channel by at
least `patternMinDeltaPercent`. Each finding has a stable key (e.g.
`TITLE:question`) so it is recognizable across syncs.

## 6. Learning lifecycle

`src/lib/channel/intel/learnings.ts` turns findings into durable statements
persisted in `channel_learnings` under the `intel_learning` category:

```text
CANDIDATE → EMERGING → CONFIRMED
     ↘ CONTRADICTED (direction flipped)
     ↘ STALE (no re-observation for learningStaleDays)
```

Promotion is driven by repeated observations across syncs
(`learningEmergingOccurrences`, `learningConfirmedOccurrences`). Each record
keeps evidence, occurrences, contradictions, source videos, timestamps and an
evidence fingerprint.

## 7. Confidence scoring

`src/lib/channel/intel/confidence.ts` is the single scorer for the whole layer,
so "HIGH confidence" always means the same thing. Inputs: sample size,
consistency, effect size, metric completeness, recency, and whether an
experiment produced the evidence. Output: a 0..1 score, a level
(`LOW` / `MEDIUM` / `HIGH`) and human-readable reasons.

## 8. Experiments

`src/lib/channel/intel/experiments.ts` proposes single-variable changes with a
baseline actually measured on the channel, and evaluates them later:

- every experiment key is stable (`EXP:` prefix) so repeated syncs never
  duplicate proposals;
- statuses: `PROPOSED`, `ACTIVE`, `COMPLETED`, `INCONCLUSIVE`, `REJECTED`;
- only uploads published after the experiment started count as test videos;
- with too few post-change videos the verdict stays `INCONCLUSIVE`/`ACTIVE`;
  causation is never claimed.

## 9. Strategy

`src/lib/channel/intel/strategy.ts` builds the `BrainStrategySummary` and the
`IntelligenceSummary`: diagnosis counts, strongest themes, promising and weak
formats, title patterns to test, publishing observations, audience signals,
confirmed learnings, active experiments and priorities. When evidence is
missing, the sufficiency is `INSUFFICIENT_DATA` rather than a zero-value
finding. `recommendations.ts` derives prioritized, evidence-linked next actions.

## 10. Brain orchestrator

`runBrainCycle(userId, deps)` owns all IO; the analysis modules stay pure. It
loads videos, metrics, learning rows, profile, experiments and the latest
strategy, runs the full pipeline, then persists learnings, experiment updates
and the summary. `readBrainSummary(userId)` is the read-only accessor used by
the Brain API and the Settings UI — it never triggers a sync.

Summary status values: `READY`, `INSUFFICIENT_DATA`, `SYNC_REQUIRED`,
`NOT_CONNECTED`, `ERROR`.

## 11. Sync Now and Full Resync

`POST /api/youtube/sync` (authenticated) runs `syncAll`:

- **Sync Now** (`{ "full": false }`) — incremental video refresh plus analytics
  and a full intelligence cycle.
- **Full Resync** (`{ "full": true }`) — re-reads the video catalogue and runs
  the cycle with `rebuild: true`, discarding previously derived learnings and
  rebuilding them from current evidence.

Responses: `SUCCESS`, `NOT_CONFIGURED` (503), `NEEDS_RECONNECT` (409) when
authorization is gone, `ERROR` (500). A failed sync is never reported as
success.

## 12. Idempotency

Running a sync twice over unchanged data produces the same stored state:

- videos and metrics are upserted on stable keys;
- learnings are merged by pattern key + fingerprint, not appended;
- experiments are matched by stable key, so no duplicate proposals;
- the summary rides along with the existing strategy version
  (`reuseVersion`), so repeated syncs never inflate strategy history.

## 13. Data quality

`assessDataQuality` reports videos total, videos with metrics, videos missing a
publish date, fields YouTube did not report, small-sample and stale-data flags,
the last observation timestamp and explanatory notes. The UI shows this verbatim
so users can judge how much to trust the conclusions.

## 14. Multi-user isolation

Every Brain table is keyed by `user_id`, has RLS enabled and a
`auth.uid() = user_id` policy for `authenticated`, with grants issued per table.
API routes resolve the user with `requireApiUser(request)` from the bearer token
and pass that id to every store call; no route accepts a user id from the
client. OAuth tokens live in `youtube_connections`, which is service-role only
and never returned by any endpoint.

## 15. Brain read API

`GET /api/youtube/brain` — authenticated, `Cache-Control: private, no-store`.

```jsonc
{ "status": "READY", "summary": { /* IntelligenceSummary */ }, "message": null }
```

When nothing has been analyzed it returns `status: "SYNC_REQUIRED"` with a null
summary and an explanatory message; on failure, `status: "ERROR"` (500).
Unauthenticated requests get 401. Tokens and secrets are never included.

## 16. Settings UI

`src/routes/_authenticated/settings.tsx` renders the connection card and, below
it, the Brain summary card (`src/components/brain/BrainSummaryCard.tsx`). The
card reads `GET /api/youtube/brain` and maps the response to five states:

| State | When |
| --- | --- |
| `NOT_CONFIGURED` | provider has no Google OAuth client configured |
| `NOT_SYNCED` | no stored analysis / channel not connected |
| `INSUFFICIENT_DATA` | analysis exists but evidence is too thin |
| `READY` | a usable summary exists |
| `ERROR` | request failed or the API returned an error |

When `READY`/`INSUFFICIENT_DATA` it shows videos analyzed, videos with metrics,
confidence, observation window, last analysis and last observation, data
quality, key learnings, strongest findings, active and proposed experiments, the
current strategy and recommendations. All values come from the API; no YouTube
statistic is ever fabricated. Sync and disconnect invalidate the Brain query so
the card refreshes.

## Current limitations

- Nothing runs on a schedule: analysis only happens when a user triggers Sync
  Now or Full Resync.
- Analytics coverage is limited to the fields the YouTube Analytics API returns
  for the authorized channel; missing fields stay `UNAVAILABLE`.
- Thumbnail imagery, comments text, audience demographics beyond US share and
  traffic-source breakdowns are not analyzed.
- Topic detection is heuristic (title-derived), not semantic/LLM-based.
- Experiment evaluation is a median comparison with confidence gating; it is not
  a statistical significance test and never claims causation.
- Strategy history keeps one summary per strategy version; there is no
  longitudinal chart of Brain state over time.
- The Brain surface is read-only in the UI: experiments cannot be accepted,
  rejected or edited from Settings.
- Real Google/YouTube OAuth credentials are required for any real data; without
  them the app runs correctly in `NOT_CONFIGURED` state.
