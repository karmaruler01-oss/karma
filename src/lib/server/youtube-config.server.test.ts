import { afterEach, describe, expect, it } from "vitest";

import { readYouTubeConfig } from "./youtube-config.server";
import { callbackRedirectUri, CALLBACK_PATH } from "./youtube-routes.server";

const ENV_KEYS = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REDIRECT_URI"];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("readYouTubeConfig", () => {
  it("returns null when no credentials are configured", () => {
    expect(readYouTubeConfig({})).toBeNull();
  });

  it("returns null when only one credential is present", () => {
    expect(readYouTubeConfig({ YOUTUBE_CLIENT_ID: "id" })).toBeNull();
    expect(readYouTubeConfig({ YOUTUBE_CLIENT_SECRET: "secret" })).toBeNull();
  });

  it("treats blank values as missing", () => {
    expect(
      readYouTubeConfig({ YOUTUBE_CLIENT_ID: "  ", YOUTUBE_CLIENT_SECRET: "secret" }),
    ).toBeNull();
  });

  it("returns the config with an optional redirect URI", () => {
    const config = readYouTubeConfig({
      YOUTUBE_CLIENT_ID: "id",
      YOUTUBE_CLIENT_SECRET: "secret",
      YOUTUBE_REDIRECT_URI: "https://app.example/api/public/youtube/callback",
    });
    expect(config).toEqual({
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://app.example/api/public/youtube/callback",
    });
  });

  it("ignores an invalid redirect URI instead of crashing", () => {
    const config = readYouTubeConfig({
      YOUTUBE_CLIENT_ID: "id",
      YOUTUBE_CLIENT_SECRET: "secret",
      YOUTUBE_REDIRECT_URI: "not a url",
    });
    expect(config?.redirectUri).toBeNull();
  });
});

describe("callbackRedirectUri", () => {
  it("prefers the configured YOUTUBE_REDIRECT_URI", () => {
    process.env["YOUTUBE_CLIENT_ID"] = "id";
    process.env["YOUTUBE_CLIENT_SECRET"] = "secret";
    process.env["YOUTUBE_REDIRECT_URI"] = "https://deployed.example/api/public/youtube/callback";

    const uri = callbackRedirectUri(new Request("https://preview.example/api/youtube/auth"));
    expect(uri).toBe("https://deployed.example/api/public/youtube/callback");
  });

  it("derives the callback from forwarded headers when not configured", () => {
    const request = new Request("http://localhost:8080/api/youtube/auth", {
      headers: { "x-forwarded-host": "app.example", "x-forwarded-proto": "https" },
    });
    expect(callbackRedirectUri(request)).toBe(`https://app.example${CALLBACK_PATH}`);
  });

  it("falls back to the request origin", () => {
    const request = new Request("https://app.example/api/youtube/auth");
    expect(callbackRedirectUri(request)).toBe(`https://app.example${CALLBACK_PATH}`);
  });
});
