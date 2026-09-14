import type { ComposerAttachment } from "../../../lib/composer-attachments";
import type { PromptImage, TranscriptItem } from "../../../lib/transcript";
import type { PendingPrompt, PromptFlight } from "../types";

type PromptItem = Extract<TranscriptItem, { kind: "prompt" }>;
type PromptLaunchKey = "pending-prompt" | "pending-continuation";

interface PendingContinuation extends PendingPrompt {
  runId: string;
  /** Number of durable prompts present when this continuation was sent. */
  afterPromptCount: number;
}

export interface OptimisticPromptLaunch {
  /** Monotonic per mounted run view; rejects late native measurements. */
  id: string;
  key: PromptLaunchKey;
  origin: NonNullable<PendingPrompt["origin"]>;
  /** The next durable prompt after this count acknowledges the local one. */
  afterPromptCount: number;
  phase: "measuring" | "flying" | "landed";
  flight?: PromptFlight;
}

export interface OptimisticPromptState {
  continuation: PendingContinuation | null;
  launch: OptimisticPromptLaunch | null;
}

export type OptimisticPromptEvent =
  | {
      type: "continuationStarted";
      launchId: string;
      runId: string;
      prompt: PendingPrompt;
      durableItems: TranscriptItem[];
    }
  | { type: "continuationRolledBack" }
  | { type: "flightMeasured"; launchId: string; flight: PromptFlight }
  | { type: "measurementFailed"; launchId: string }
  | { type: "flightLanded"; launchId: string };

export interface OptimisticPromptProjection {
  pendingItem: PromptItem | null;
  pendingContinuationItem: PromptItem | null;
  renderedItems: TranscriptItem[];
  trailingStreamingItems: TranscriptItem[];
  actionItems: TranscriptItem[];
  turnIsActive: boolean;
  launchInProgress: boolean;
  flyingPromptItem: PromptItem | null;
}

function promptCount(items: TranscriptItem[]): number {
  return items.reduce((count, item) => count + (item.kind === "prompt" ? 1 : 0), 0);
}

function promptImages(attachments: ComposerAttachment[] | undefined): PromptImage[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.type === "image")
    .map((attachment) => ({
      key: attachment.id,
      name: attachment.name,
      uri: attachment.uri,
      previewCropBottom: attachment.previewCropBottom,
    }));
}

function promptItem(
  key: PromptLaunchKey,
  prompt: PendingPrompt,
  at: number,
): PromptItem {
  return {
    key,
    kind: "prompt",
    text: prompt.text,
    at,
    skills: prompt.skills,
    files: [],
    images: promptImages(prompt.attachments),
  };
}

/** Index of the durable prompt that follows `count` existing prompts. */
function nextPromptIndex(items: TranscriptItem[], count: number): number {
  let seen = 0;
  for (let index = 0; index < items.length; index++) {
    if (items[index].kind !== "prompt") continue;
    if (seen === count) return index;
    seen++;
  }
  return -1;
}

export function initialOptimisticPromptState(
  pending: PendingPrompt | null,
): OptimisticPromptState {
  return {
    continuation: null,
    launch: pending?.origin
      ? {
          id: "pending-prompt:initial",
          key: "pending-prompt",
          origin: pending.origin,
          afterPromptCount: 0,
          phase: "measuring",
        }
      : null,
  };
}

/** All legal **Prompt handoff** state transitions. Invalid/stale events are no-ops. */
export function optimisticPromptReducer(
  state: OptimisticPromptState,
  event: OptimisticPromptEvent,
): OptimisticPromptState {
  switch (event.type) {
    case "continuationStarted": {
      const afterPromptCount = promptCount(event.durableItems);
      return {
        continuation: {
          ...event.prompt,
          runId: event.runId,
          afterPromptCount,
        },
        launch: event.prompt.origin
          ? {
              id: event.launchId,
              key: "pending-continuation",
              origin: event.prompt.origin,
              afterPromptCount,
              phase: "measuring",
            }
          : null,
      };
    }
    case "continuationRolledBack":
      return state.continuation === null && state.launch === null
        ? state
        : { continuation: null, launch: null };
    case "flightMeasured":
      if (state.launch?.id !== event.launchId || state.launch.phase !== "measuring") return state;
      return {
        ...state,
        launch: { ...state.launch, phase: "flying", flight: event.flight },
      };
    case "measurementFailed":
      if (state.launch?.id !== event.launchId || state.launch.phase !== "measuring") return state;
      return {
        ...state,
        launch: { ...state.launch, phase: "landed" },
      };
    case "flightLanded":
      if (state.launch?.id !== event.launchId || state.launch.phase !== "flying") return state;
      return {
        ...state,
        launch: { ...state.launch, phase: "landed" },
      };
  }
}

/**
 * Project local and durable copies into one transcript. During a flight the
 * local prompt owns the row; after landing its durable twin takes over.
 */
export function projectOptimisticPrompt({
  state,
  initialPrompt,
  runId,
  durableItems,
  streamingItems,
  runIsLive,
}: {
  state: OptimisticPromptState;
  initialPrompt: PendingPrompt | null;
  runId: string;
  durableItems: TranscriptItem[];
  streamingItems: TranscriptItem[];
  runIsLive: boolean;
}): OptimisticPromptProjection {
  const durablePromptCount = promptCount(durableItems);
  const launchInProgress = state.launch !== null && state.launch.phase !== "landed";
  const acknowledgedAt =
    launchInProgress && state.launch
      ? nextPromptIndex(durableItems, state.launch.afterPromptCount)
      : -1;
  const displayItems = acknowledgedAt < 0 ? durableItems : durableItems.slice(0, acknowledgedAt);

  const initialHeldForLaunch = launchInProgress && state.launch?.key === "pending-prompt";
  const pendingItem =
    initialPrompt && (durablePromptCount === 0 || initialHeldForLaunch)
      ? promptItem("pending-prompt", initialPrompt, 0)
      : null;

  const continuationHeldForLaunch =
    launchInProgress && state.launch?.key === "pending-continuation";
  const continuation = state.continuation;
  const pendingContinuationItem =
    continuation &&
    continuation.runId === runId &&
    (durablePromptCount <= continuation.afterPromptCount || continuationHeldForLaunch)
      ? promptItem("pending-continuation", continuation, Number.MAX_SAFE_INTEGER)
      : null;

  // Streaming may beat the durable prompt to SQLite. Keep that response after
  // its local prompt until the two prompt copies have swapped.
  const streamingFollowsContinuation = pendingContinuationItem !== null;
  const renderedItems = streamingFollowsContinuation
    ? displayItems
    : [...displayItems, ...streamingItems];
  const trailingStreamingItems = streamingFollowsContinuation ? streamingItems : [];
  const actionItems = pendingContinuationItem
    ? [...displayItems, pendingContinuationItem, ...streamingItems]
    : renderedItems;
  const flyingPromptItem =
    state.launch?.phase === "flying"
      ? state.launch.key === "pending-prompt"
        ? pendingItem
        : pendingContinuationItem
      : null;

  return {
    pendingItem,
    pendingContinuationItem,
    renderedItems,
    trailingStreamingItems,
    actionItems,
    turnIsActive: Boolean(runIsLive || pendingContinuationItem),
    launchInProgress,
    flyingPromptItem,
  };
}
