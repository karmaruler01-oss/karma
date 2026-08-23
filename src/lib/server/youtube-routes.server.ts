// Shared helpers for the YouTube HTTP routes.

import { readYouTubeConfig } from "./youtube-config.server";

/** Google redirects a plain browser navigation here, so it lives under
 *  /api/public/* and is protected by the single-use OAuth state instead. */
export const CALLBACK_PATH = "/api/public/youtube/callback";

/**
 * The redirect URI sent to Google. An explicit YOUTUBE_REDIRECT_URI (set on
 * the deployed backend only) wins; otherwise the callback is derived from the
 * incoming request's host. The value is read server-side and never shipped to
 * the browser.
 */
export function callbackRedirectUri(request: Request): string {
  const configured = readYouTubeConfig()?.redirectUri;
  if (configured) return configured;

  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const origin =
    forwardedHost && forwardedProto
      ? `${forwardedProto}://${forwardedHost}`
      : url.origin;
  return `${origin}${CALLBACK_PATH}`;
}

export function settingsRedirect(request: Request, params: Record<string, string>): Response {
  const url = new URL(request.url);
  const target = new URL("/settings", url.origin);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { location: target.toString() } });
}
