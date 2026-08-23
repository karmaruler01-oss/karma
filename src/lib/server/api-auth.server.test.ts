import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requireApiUser, UnauthorizedError } from "./api-auth.server";

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];

// The test environment may load real backend env vars from .env; clear them so
// each case controls its own configuration state.
beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("requireApiUser", () => {
  it("rejects requests when the backend is not configured", async () => {
    const request = new Request("https://app.example/api/youtube/status", {
      headers: { authorization: "Bearer aaa.bbb.ccc" },
    });
    await expect(requireApiUser(request)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects requests without an authorization header", async () => {
    process.env["SUPABASE_URL"] = "https://project.example";
    process.env["SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test";
    const request = new Request("https://app.example/api/youtube/status");
    await expect(requireApiUser(request)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects non-bearer and malformed tokens without calling the network", async () => {
    process.env["SUPABASE_URL"] = "https://project.example";
    process.env["SUPABASE_PUBLISHABLE_KEY"] = "sb_publishable_test";

    const basic = new Request("https://app.example/api/youtube/status", {
      headers: { authorization: "Basic aaa.bbb.ccc" },
    });
    await expect(requireApiUser(basic)).rejects.toBeInstanceOf(UnauthorizedError);

    const malformed = new Request("https://app.example/api/youtube/status", {
      headers: { authorization: "Bearer not-a-jwt" },
    });
    await expect(requireApiUser(malformed)).rejects.toBeInstanceOf(UnauthorizedError);

    const empty = new Request("https://app.example/api/youtube/status", {
      headers: { authorization: "Bearer  " },
    });
    await expect(requireApiUser(empty)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
