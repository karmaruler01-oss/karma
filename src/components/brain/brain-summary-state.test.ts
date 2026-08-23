import { describe, expect, it } from "vitest";

import { deriveBrainState, type BrainApiResponse } from "./BrainSummaryCard";
import type { IntelligenceSummary } from "@/lib/channel/intel/types";

const summary = { status: "READY" } as unknown as IntelligenceSummary;

const payload = (over: Partial<BrainApiResponse>): BrainApiResponse => ({
  status: "READY",
  summary,
  message: null,
  ...over,
});

describe("deriveBrainState", () => {
  it("reports NOT_CONFIGURED before any credentials exist, regardless of payload", () => {
    expect(
      deriveBrainState({
        isPending: true,
        isError: false,
        notConfigured: true,
        payload: undefined,
      }),
    ).toBe("NOT_CONFIGURED");
  });

  it("reports LOADING while the request is in flight", () => {
    expect(
      deriveBrainState({ isPending: true, isError: false, notConfigured: false, payload: undefined }),
    ).toBe("LOADING");
  });

  it("reports NOT_SYNCED when nothing has been analyzed yet", () => {
    expect(
      deriveBrainState({
        isPending: false,
        isError: false,
        notConfigured: false,
        payload: payload({ status: "SYNC_REQUIRED", summary: null }),
      }),
    ).toBe("NOT_SYNCED");
  });

  it("reports NOT_SYNCED when the channel is not connected", () => {
    expect(
      deriveBrainState({
        isPending: false,
        isError: false,
        notConfigured: false,
        payload: payload({ status: "NOT_CONNECTED", summary: null }),
      }),
    ).toBe("NOT_SYNCED");
  });

  it("reports INSUFFICIENT_DATA when the Brain lacks evidence", () => {
    expect(
      deriveBrainState({
        isPending: false,
        isError: false,
        notConfigured: false,
        payload: payload({ status: "INSUFFICIENT_DATA" }),
      }),
    ).toBe("INSUFFICIENT_DATA");
  });

  it("reports READY for a stored summary", () => {
    expect(
      deriveBrainState({
        isPending: false,
        isError: false,
        notConfigured: false,
        payload: payload({}),
      }),
    ).toBe("READY");
  });

  it("reports ERROR on a failed request or an error payload", () => {
    expect(
      deriveBrainState({
        isPending: false,
        isError: true,
        notConfigured: false,
        payload: undefined,
      }),
    ).toBe("ERROR");
    expect(
      deriveBrainState({
        isPending: false,
        isError: false,
        notConfigured: false,
        payload: payload({ status: "ERROR", summary: null }),
      }),
    ).toBe("ERROR");
  });
});
