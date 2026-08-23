// Video production — shared, client-safe types.
//
// Vocabulary rule for the whole feature (see docs/video-production.md):
//   PLANNING   — idea, script, storyboard exist (no media)
//   GENERATION — a provider actually returned media (images / clips / audio)
//   RENDERING  — a render provider actually produced one video file
//   UPLOAD     — YouTube confirmed the upload
//
// Nothing in this module invents media. A stage that could not run stays
// explicitly PENDING / NOT_CONFIGURED / FAILED and says why.

export const PRODUCTION_STATES = [
  "DRAFT",
  "PLANNING",
  "SCRIPTING",
  "STORYBOARDING",
  "GENERATING_ASSETS",
  "VOICEOVER",
  "COMPOSING",
  "RENDERING",
  "READY",
  "FAILED",
  "CANCELLED",
] as const;

export type ProductionState = (typeof PRODUCTION_STATES)[number];

export type ProductionFormat = "SHORTS" | "LONG_FORM";
export type AspectRatio = "9:16" | "16:9" | "1:1";

/** Every stage the pipeline can run, in pipeline order. */
export const PRODUCTION_STEPS = [
  "PLANNING",
  "SCRIPT",
  "STORYBOARD",
  "VISUALS",
  "VOICEOVER",
  "CAPTIONS",
  "MUSIC",
  "COMPOSE",
  "RENDER",
] as const;

export type ProductionStep = (typeof PRODUCTION_STEPS)[number];

export type StepStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED"
  | "NOT_CONFIGURED";

export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type JobType =
  | "FULL_PRODUCTION"
  | "SCRIPT"
  | "STORYBOARD"
  | "VISUALS"
  | "VOICEOVER"
  | "CAPTIONS"
  | "COMPOSE"
  | "RENDER"
  | "THUMBNAIL";

// ---------------------------------------------------------------------------
// Idea
// ---------------------------------------------------------------------------

export interface ProductionIdea {
  title: string;
  topic: string;
  goal: string;
  concept: string;
  format: ProductionFormat;
  targetAudience: string;
  tone: string;
  language: string;
  targetDurationSeconds: number;
  aspectRatio: AspectRatio;
}

/** Where an idea came from. Brain-seeded ideas keep their evidence attached. */
export interface BrainSource {
  recommendationKey: string;
  recommendationType: string;
  title: string;
  explanation: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  confidenceScore: number;
  impact: "LOW" | "MEDIUM" | "HIGH";
  /** Real observations only, copied verbatim from the Brain summary. */
  evidence: { label: string; detail: string }[];
  learnings: string[];
  experimentHypothesis: string | null;
  suggestedTitleDirection: string | null;
  /** False when the recommendation was too weak to be treated as a fact. */
  treatAsEvidence: boolean;
  seededAt: string;
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export type ScriptBlockKind = "HOOK" | "SECTION" | "DIALOGUE" | "CTA" | "ENDING";

export interface ScriptBlock {
  id: string;
  kind: ScriptBlockKind;
  heading: string | null;
  /** Spoken text. Duration is always estimated from this, never from a form. */
  narration: string;
  speaker: string | null;
  emphasis: string[];
  sceneRef: string | null;
  estimatedDurationSeconds: number;
}

export type ScriptSource = "OUTLINE" | "AI" | "USER";

export interface ProductionScript {
  version: number;
  /** OUTLINE = structural scaffold from the user's own idea, not AI-written. */
  source: ScriptSource;
  provider: string | null;
  language: string;
  wordsPerMinute: number;
  title: string | null;
  blocks: ScriptBlock[];
  wordCount: number;
  estimatedDurationSeconds: number;
  generatedAt: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------

export type VisualStatus = "PENDING" | "GENERATING" | "READY" | "FAILED" | "NOT_CONFIGURED";

export interface StoryboardScene {
  /** Database id once persisted; a stable local id before that. */
  id: string;
  sceneNumber: number;
  blockId: string | null;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  videoPrompt: string | null;
  startSeconds: number;
  durationSeconds: number;
  transition: string;
  overlayText: string | null;
  visualStatus: VisualStatus;
  /** Set only when a provider actually returned an asset. */
  assetId: string | null;
  assetPath: string | null;
}

export interface Storyboard {
  scenes: StoryboardScene[];
  totalDurationSeconds: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface VoiceSettings {
  voice: string;
  gender: string;
  accent: string;
  language: string;
  style: string;
  speed: number;
  pitch: number;
  emotion: string;
}

export interface VisualSettings {
  /** GENERATED needs a configured image/clip provider; UPLOADED/EXISTING do not. */
  source: "GENERATED" | "UPLOADED" | "EXISTING" | "STOCK";
  style: string;
  motion: "STILL" | "KEN_BURNS" | "VIDEO_CLIP";
  clipSeconds: number;
}

export interface CaptionSettings {
  enabled: boolean;
  language: string;
  position: "TOP" | "CENTER" | "BOTTOM";
  size: "SM" | "MD" | "LG";
  style: string;
  maxCharsPerLine: number;
}

export interface MusicSettings {
  enabled: boolean;
  /** Only a track the user actually has. Never an invented library entry. */
  trackPath: string | null;
  trackName: string | null;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  soundEffects: { atSeconds: number; name: string; assetPath: string | null }[];
}

export interface ThumbnailSpec {
  concept: string;
  titleText: string;
  prompt: string;
  status: "PENDING" | "READY" | "FAILED" | "NOT_CONFIGURED";
  assetPath: string | null;
}

export interface CaptionSegment {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  /** DERIVED_FROM_SCENES = timing computed from real scene durations. */
  timingSource: "DERIVED_FROM_SCENES" | "TRANSCRIBED";
}

export interface CaptionTrack {
  language: string;
  segments: CaptionSegment[];
  timingSource: "DERIVED_FROM_SCENES" | "TRANSCRIBED";
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface RenderOutput {
  /** Only ever set by a provider that returned a real file. */
  storagePath: string | null;
  status: "NOT_STARTED" | "NOT_CONFIGURED" | "RENDERING" | "READY" | "FAILED";
  provider: string | null;
  format: string;
  aspectRatio: AspectRatio;
  frameRate: number;
  durationSeconds: number | null;
  progress: number;
  error: string | null;
}

export interface ProductionRecord {
  id: string;
  userId: string;
  channelId: string | null;
  state: ProductionState;
  idea: ProductionIdea;
  brainSource: BrainSource | null;
  script: ProductionScript | null;
  storyboard: Storyboard;
  voice: VoiceSettings;
  visuals: VisualSettings;
  captions: CaptionSettings;
  music: MusicSettings;
  thumbnail: ThumbnailSpec | null;
  output: RenderOutput;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionJobRecord {
  id: string;
  productionId: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  currentStep: ProductionStep | null;
  progress: number;
  /** Honest indeterminate flag: true when the backend cannot know a percentage. */
  indeterminate: boolean;
  error: string | null;
  provider: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ProductionStepRecord {
  id: string;
  jobId: string;
  userId: string;
  step: ProductionStep;
  position: number;
  status: StepStatus;
  attemptCount: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  /** Provider-safe metadata only — never credentials or raw provider payloads. */
  metadata: Record<string, unknown>;
}

export const DEFAULT_VOICE: VoiceSettings = {
  voice: "alloy",
  gender: "female",
  accent: "american",
  language: "en",
  style: "narrative",
  speed: 1,
  pitch: 1,
  emotion: "neutral",
};

export const DEFAULT_VISUALS: VisualSettings = {
  source: "GENERATED",
  style: "cinematic",
  motion: "STILL",
  clipSeconds: 5,
};

export const DEFAULT_CAPTIONS: CaptionSettings = {
  enabled: true,
  language: "en",
  position: "BOTTOM",
  size: "MD",
  style: "bold-outline",
  maxCharsPerLine: 32,
};

export const DEFAULT_MUSIC: MusicSettings = {
  enabled: false,
  trackPath: null,
  trackName: null,
  volume: 0.2,
  fadeInSeconds: 1,
  fadeOutSeconds: 1,
  soundEffects: [],
};

export const DEFAULT_OUTPUT: RenderOutput = {
  storagePath: null,
  status: "NOT_STARTED",
  provider: null,
  format: "mp4_h264_aac",
  aspectRatio: "9:16",
  frameRate: 30,
  durationSeconds: null,
  progress: 0,
  error: null,
};

export function aspectRatioForFormat(format: ProductionFormat): AspectRatio {
  return format === "SHORTS" ? "9:16" : "16:9";
}
