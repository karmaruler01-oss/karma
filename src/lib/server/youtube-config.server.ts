// Server-only environment configuration for the YouTube OAuth provider.
//
// YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REDIRECT_URI are read
// exclusively here, on the server. They must never be exposed through VITE_*
// variables, frontend bundles, logs, or API responses.
//
// When the credentials are absent the provider is simply "not configured":
// every entry point degrades to a clean NOT_CONFIGURED state instead of
// crashing, and no fake values are ever invented.

export interface YouTubeEnvConfig {
  clientId: string;
  clientSecret: string;
  /** Explicit OAuth redirect URI. Null means "derive from the request". */
  redirectUri: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads the YouTube provider configuration from the environment.
 * Returns null when the OAuth client credentials are missing — this is the
 * single source of truth for the NOT_CONFIGURED state.
 */
export function readYouTubeConfig(
  env: Record<string, string | undefined> = process.env,
): YouTubeEnvConfig | null {
  const clientId = nonEmpty(env["YOUTUBE_CLIENT_ID"]);
  const clientSecret = nonEmpty(env["YOUTUBE_CLIENT_SECRET"]);
  if (!clientId || !clientSecret) return null;

  const redirectUri = nonEmpty(env["YOUTUBE_REDIRECT_URI"]);
  if (redirectUri) {
    try {
      // An unusable configured URI must not break the flow: fall back to the
      // request-derived callback URL instead of crashing.
      new URL(redirectUri);
    } catch {
      return { clientId, clientSecret, redirectUri: null };
    }
  }
  return { clientId, clientSecret, redirectUri };
}
