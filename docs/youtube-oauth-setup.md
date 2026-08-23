# YouTube OAuth Setup

This document explains how to configure the YouTube (Google) OAuth integration used by
the **Connect YouTube** feature. No real Google credentials are contained here — this is
configuration guidance only.

Until the credentials below are present in the server environment, the integration stays
in a clean `NOT_CONFIGURED` state: the UI reports that YouTube is not configured, and no
requests are made to Google.

---

## 1. Environment variables

All three variables are **server-side only**. They are read exclusively in
`src/lib/server/youtube-config.server.ts` via `process.env`, inside server handlers.

| Variable | Required | Purpose |
| --- | --- | --- |
| `YOUTUBE_CLIENT_ID` | yes | OAuth 2.0 Client ID from the Google Cloud project. Identifies the app to Google. |
| `YOUTUBE_CLIENT_SECRET` | yes | OAuth 2.0 Client Secret. Used only server-side to exchange the authorization code and to refresh/revoke tokens. |
| `YOUTUBE_REDIRECT_URI` | optional (recommended in production) | Absolute callback URL Google redirects to after consent. When unset, the callback URL is derived from the incoming request origin. When set to an unparsable value it is ignored and the request-derived URL is used instead. |

### Where they belong

Set all three in the **deployed backend/server environment** (Lovable project secrets /
hosting environment variables). They are injected into the Worker runtime at request time.

Do **not**:

- prefix them with `VITE_` — anything `VITE_*` is inlined into the browser bundle;
- put them in client code, `import.meta.env`, localStorage, query strings, or API responses;
- commit them to the repository or paste them into chat/logs.

### Never expose to the frontend

- `YOUTUBE_CLIENT_SECRET` must never leave the server. Leaking it lets anyone impersonate
  the app against Google.
- OAuth **access tokens** and **refresh tokens** are never returned to the browser. The
  status endpoint returns only non-sensitive fields (connection status, channel id/title,
  scope, expiry state). All calls to the YouTube Data / Analytics APIs are made from the
  server using tokens loaded server-side.
- The client ID is not secret, but there is no reason to ship it: the authorization URL is
  built on the server and the browser is simply redirected to it.

---

## 2. Google Cloud OAuth configuration

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create (or pick)
   a project.
2. **APIs & Services → Library** → enable:
   - *YouTube Data API v3*
   - *YouTube Analytics API*
3. **APIs & Services → OAuth consent screen**:
   - User type: *External* (or *Internal* for a Workspace-only app).
   - Fill app name, support email, developer contact.
   - Add the scopes the app requests:
     - `https://www.googleapis.com/auth/youtube.readonly`
     - `https://www.googleapis.com/auth/yt-analytics.readonly`
     - `https://www.googleapis.com/auth/youtube.upload`
   - While the app is in *Testing*, add each Google account that will connect as a
     **Test user**. Publish the app for general availability (upload/readonly scopes are
     sensitive and require Google verification for public use).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs**: add the callback URL (next section).
   - Copy the generated Client ID and Client Secret into the server environment.

### Callback URL

```
https://<your-domain>/api/public/youtube/callback
```

This path is intentionally under `/api/public/` so Google's browser redirect is not blocked
by site auth. The handler itself is not "open": it validates the one-time `state` value
stored server-side (`youtube_oauth_states`) and resolves the owning user from that record
before any token is written.

Add one entry per environment you use, e.g.:

```
https://your-app.lovable.app/api/public/youtube/callback
https://project--<project-id>.lovable.app/api/public/youtube/callback
https://project--<project-id>-dev.lovable.app/api/public/youtube/callback
```

The URI must match **byte for byte** (scheme, host, path, no trailing slash) or Google
returns `redirect_uri_mismatch`.

### Configuring the production domain

1. Publish the app and, if applicable, connect the custom domain.
2. Add `https://<production-domain>/api/public/youtube/callback` to the Authorized redirect
   URIs of the OAuth client.
3. Set `YOUTUBE_REDIRECT_URI` in the production environment to that exact URL. Pinning it
   avoids depending on proxy-derived origins and keeps preview and production callbacks
   from crossing over.
4. Preview/staging environments get their own value of `YOUTUBE_REDIRECT_URI` matching their
   own domain.

---

## 3. Verifying "Connect YouTube"

1. Confirm the three variables are set in the target environment and redeploy if needed.
2. Sign in to the app and open **Settings**.
3. The YouTube card should show *Not connected* (rather than *Not configured*). If it still
   says not configured, `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` are missing or empty.
4. Click **Connect YouTube** → you are redirected to Google's consent screen showing the
   three scopes.
5. Approve → Google redirects to `/api/public/youtube/callback` → the app returns to
   Settings and the card shows the connected channel title/id.
6. Endpoints you can check (all require the signed-in user's session; none return tokens):
   - `GET /api/youtube/status` — connection state
   - `POST /api/youtube/refresh` — forces a token refresh
   - `POST /api/youtube/sync` — pulls channel/video data
7. Common failures:
   - `redirect_uri_mismatch` — the URI in Google Cloud differs from the one used.
   - `access_denied` — consent cancelled, or the account is not a registered test user.
   - Status flips to `ERROR` — the refresh token was revoked; reconnect.

---

## 4. Disconnecting / revoking access

- **In the app:** Settings → **Disconnect**. This calls `POST /api/youtube/disconnect`,
  which revokes the token at `https://oauth2.googleapis.com/revoke` and clears the stored
  connection row for that user. Only the caller's own connection can be disconnected.
- **From the Google account:** <https://myaccount.google.com/permissions> → select the app
  → *Remove access*. The stored refresh token becomes invalid; the next server-side refresh
  fails and the connection is marked as errored, prompting a reconnect.
- **Rotating the client secret:** create a new secret in Google Cloud, update
  `YOUTUBE_CLIENT_SECRET` in the server environment, redeploy. Existing refresh tokens keep
  working with the new secret of the same client; deleting the OAuth client invalidates them.

---

## 5. Security design of the YouTube token tables

The token-bearing tables are deliberately unreachable from any browser client.

| Table | Contents |
| --- | --- |
| `public.youtube_connections` | Per-user access token, refresh token, expiry, scope, channel identity, status |
| `public.youtube_oauth_states` | Short-lived one-time `state` values binding an in-flight authorization to a user |

Design rules, all intentional:

- **RLS enabled** on both tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`).
- **No client-facing policies.** No `CREATE POLICY` exists for `anon` or `authenticated`,
  and no Data API grants are issued to those roles. With RLS on and no policy, every
  PostgREST read/write from the browser returns nothing / is denied — even for the row's own
  owner. This is stronger than an owner-scoped policy: tokens are simply not exposed through
  the Data API at all.
- **Backend-only access.** Only `service_role` is granted on these tables
  (`GRANT ALL ON ... TO service_role`), and that key exists solely in the server runtime.
  Access goes through `src/lib/server/youtube-store.server.ts` / `youtube.server.ts`, which
  are server-only modules and never enter the client bundle.
- **Per-user isolation.** `youtube_connections.user_id` is `UNIQUE` — one connection per
  user. Every server helper takes the authenticated `userId` (resolved from the caller's
  session via `requireApiUser`) and filters on it, so one user can never read, refresh, or
  disconnect another user's channel. The OAuth `state` row is the only link between a
  callback and its user, is single-use, and is deleted when consumed.
- **Refresh and revocation are server-side.** Expiring access tokens are refreshed on the
  server with the refresh token plus the client secret; revocation calls Google's revoke
  endpoint from the server. The browser only ever sees derived, non-sensitive status.

If a security scanner flags "table with RLS enabled but no policies" for
`youtube_connections` or `youtube_oauth_states`, that is the intended configuration for
backend-only secret storage, not a misconfiguration.
