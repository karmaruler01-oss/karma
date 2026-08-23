# YouTube Connect Hub

# STEP 3 — YouTube OAuth-Ready Backend + Secure Website Integration

Continue from the completed Step 2.

IMPORTANT ARCHITECTURE DECISION:

I will configure the Google/YouTube OAuth Client ID and Client Secret ONLY on my deployed website/backend later.

DO NOT ask me for:

- YOUTUBE_CLIENT_ID

- YOUTUBE_CLIENT_SECRET

- Google OAuth secrets

- Any other YouTube credentials

DO NOT open or request Lovable's secret-entry form.

The application must remain fully functional when these credentials are not configured.

## STEP 3 GOALS

Build the complete production-ready OAuth architecture around the existing YouTube Connect Pro feature.

### 1. OAuth architecture

Create a secure server-side YouTube OAuth flow:

User → Website → Backend OAuth endpoint → Google → OAuth callback → Backend → Secure session/token storage → Website

The frontend must NEVER receive or store:

- Google Client Secret

- YouTube refresh token

- YouTube access token unless absolutely required for a short-lived browser operation

Prefer server-side API calls wherever possible.

### 2. Environment configuration

Create the required environment-variable interface/documentation for:

YOUTUBE_CLIENT_ID

YOUTUBE_CLIENT_SECRET

YOUTUBE_REDIRECT_URI

These should be read ONLY by server-side code.

Do not provide fake values.

The application should detect when these variables are missing and return a clean:

"YouTube integration is not configured"

state.

Do not crash the application.

### 3. OAuth endpoints

Implement the appropriate server-side routes/functions for:

- Start YouTube OAuth

- OAuth callback

- Check connection status

- Get connected channel information

- Disconnect YouTube

- Refresh expired authorization

- Securely revoke/disconnect authorization where supported

Use proper OAuth state protection against CSRF.

Validate the OAuth callback before exchanging authorization codes.

Never put Client Secret values in frontend JavaScript.

### 4. Existing UI

Keep the Step 2 UI intact:

- Connect YouTube

- Connection status

- Channel information

- Live channel stats

- Sync Now

- Full Resync

- Disconnect

When OAuth is not configured, show the existing "YouTube not configured" state.

When configured and connected, show the real connection state.

Do not create fake channel statistics.

### 5. Token/security storage

Create a secure server-side storage abstraction for YouTube OAuth credentials.

The design should support:

- encrypted-at-rest token storage where the existing database architecture allows it

- access-token expiration tracking

- refresh-token handling

- token refresh

- disconnect/revocation

- multiple users/channels safely separated

Never expose refresh tokens to the frontend.

Never log secrets or tokens.

### 6. User isolation

Every YouTube connection must belong to the authenticated application user.

Enforce authorization on every YouTube-related server endpoint.

A user must never be able to access another user's:

- OAuth tokens

- channel data

- metrics

- sync history

- Brain feedback data

Use the existing authentication and RLS/security architecture.

### 7. YouTube API abstraction

Create a clean server-side YouTube service layer so the rest of the application does not directly depend on OAuth implementation details.

Separate:

YouTube OAuth

YouTube API client

Channel data

Video data

Metrics

Sync

Brain feedback

This will make the integration easier to maintain.

### 8. Sync system

Keep the existing:

Sync Now

Full Resync

functionality.

Make sure the sync system can eventually use authenticated YouTube API data instead of mock/fake data.

When OAuth is unavailable, fail gracefully with a clear configuration message.

When OAuth is available but authorization has expired, attempt token refresh before reporting an authentication error.

### 9. Brain feedback loop

Keep the existing Brain feedback loop connected to the YouTube sync pipeline.

The intended architecture is:

YouTube data

→ channel/video metrics

→ baselines

→ learning

→ experiments

→ strategies

→ Brain feedback

→ future recommendations

Do not invent YouTube data.

### 10. Error handling

Create proper user-safe errors for:

- OAuth not configured

- OAuth cancelled

- invalid OAuth state

- authorization denied

- expired authorization

- token refresh failure

- YouTube API failure

- rate limiting

- disconnected account

- missing channel

- insufficient permissions

Do not expose Google API error details or secrets unnecessarily.

### 11. Testing

Add/update tests for:

- OAuth configuration detection

- OAuth state validation

- callback handling

- authentication requirements

- user isolation

- missing credentials

- token expiration

- token refresh behavior

- disconnect behavior

- YouTube API error handling

- sync behavior when YouTube is unavailable

Run the complete test suite.

Do not finish Step 3 until all tests pass.

Also run the TypeScript/build checks.

### 12. Deployment documentation

Create a concise deployment/setup document explaining exactly where I will later configure:

YOUTUBE_CLIENT_ID

YOUTUBE_CLIENT_SECRET

YOUTUBE_REDIRECT_URI

The documentation must clearly state that these credentials belong on the deployed backend/server environment, NOT in frontend code.

Also document the Google OAuth redirect URI that the website will need to register.

Do NOT require me to enter any credentials during this Lovable session.

## FINAL REQUIREMENT

I am intentionally keeping YouTube OAuth credentials outside Lovable.

Complete everything possible now and leave the system in this state:

OAuth code: READY

OAuth UI: READY

Backend integration: READY

Tests: PASSING

Credentials: NOT CONFIGURED

Application: STILL FUNCTIONAL

Do not ask for my Client ID or Client Secret.

At the end, report:

1. files changed

2. OAuth architecture implemented

3. tests passed

4. build/typecheck status

5. exact environment variables I will need to add later on my website

6. anything that genuinely cannot be tested until real Google OAuth credentials are configured

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3b1dc4b7-01fb-43dd-af4f-7d3f272f4a4f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
