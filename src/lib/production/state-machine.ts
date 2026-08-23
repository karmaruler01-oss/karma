// Production state machine.
//
// Pure and total: every transition either is in the table below or is refused
// with a reason. READY has an extra guard — a production may only become READY
// when a render output has actually been verified.

import type { ProductionState, ProductionStep, RenderOutput } from "./types";

const TRANSITIONS: Record<ProductionState, ProductionState[]> = {
  DRAFT: ["PLANNING", "CANCELLED"],
  PLANNING: ["SCRIPTING", "DRAFT", "FAILED", "CANCELLED"],
  SCRIPTING: ["STORYBOARDING", "PLANNING", "DRAFT", "FAILED", "CANCELLED"],
  STORYBOARDING: ["GENERATING_ASSETS", "SCRIPTING", "DRAFT", "FAILED", "CANCELLED"],
  GENERATING_ASSETS: ["VOICEOVER", "STORYBOARDING", "FAILED", "CANCELLED"],
  VOICEOVER: ["COMPOSING", "GENERATING_ASSETS", "FAILED", "CANCELLED"],
  COMPOSING: ["RENDERING", "VOICEOVER", "FAILED", "CANCELLED"],
  RENDERING: ["READY", "FAILED", "CANCELLED"],
  READY: ["DRAFT", "RENDERING"],
  // Retry re-enters the stage that failed.
  FAILED: [
    "DRAFT",
    "PLANNING",
    "SCRIPTING",
    "STORYBOARDING",
    "GENERATING_ASSETS",
    "VOICEOVER",
    "COMPOSING",
    "RENDERING",
    "CANCELLED",
  ],
  CANCELLED: ["DRAFT"],
};

export const TERMINAL_STATES: ProductionState[] = ["READY", "FAILED", "CANCELLED"];

export interface TransitionCheck {
  allowed: boolean;
  reason: string | null;
}

/** A production is only "generated" when a real output file is recorded. */
export function hasVerifiedOutput(output: RenderOutput | null | undefined): boolean {
  return Boolean(output && output.status === "READY" && output.storagePath);
}

export function checkTransition(
  from: ProductionState,
  to: ProductionState,
  output?: RenderOutput | null,
): TransitionCheck {
  if (from === to) return { allowed: true, reason: null };
  if (!TRANSITIONS[from]?.includes(to)) {
    return { allowed: false, reason: `Cannot move a production from ${from} to ${to}.` };
  }
  if (to === "READY" && !hasVerifiedOutput(output)) {
    return {
      allowed: false,
      reason: "A production can only become READY once a rendered video file exists.",
    };
  }
  return { allowed: true, reason: null };
}

export function canTransition(
  from: ProductionState,
  to: ProductionState,
  output?: RenderOutput | null,
): boolean {
  return checkTransition(from, to, output).allowed;
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: ProductionState,
    readonly to: ProductionState,
    reason: string,
  ) {
    super(reason);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(
  from: ProductionState,
  to: ProductionState,
  output?: RenderOutput | null,
): void {
  const check = checkTransition(from, to, output);
  if (!check.allowed) {
    throw new InvalidTransitionError(from, to, check.reason ?? "Invalid transition");
  }
}

const STEP_STATE: Record<ProductionStep, ProductionState> = {
  PLANNING: "PLANNING",
  SCRIPT: "SCRIPTING",
  STORYBOARD: "STORYBOARDING",
  VISUALS: "GENERATING_ASSETS",
  VOICEOVER: "VOICEOVER",
  CAPTIONS: "COMPOSING",
  MUSIC: "COMPOSING",
  COMPOSE: "COMPOSING",
  RENDER: "RENDERING",
};

export function stateForStep(step: ProductionStep): ProductionState {
  return STEP_STATE[step];
}

export function isTerminal(state: ProductionState): boolean {
  return TERMINAL_STATES.includes(state);
}
