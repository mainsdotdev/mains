import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { TranscriptItem } from "@/lib/transcript";
import { transcriptActionState } from "@/lib/transcript-actions";
import { buildTurnRows } from "@/lib/transcript-rows";

import {
  initialOptimisticPromptState,
  optimisticPromptReducer,
  projectOptimisticPrompt,
  type OptimisticPromptEvent,
} from "../lib/optimistic-prompt";
import type { PendingPrompt, PromptFlight } from "../types";

/** Native measurement gets a few frames to report usable coordinates. */
const MEASUREMENT_TIMEOUT_MS = 300;

/**
 * Owns the **Prompt handoff** from local composer source to durable transcript
 * row. Native geometry remains with the screen; this Module owns every state
 * transition and the resulting transcript projection.
 */
export function useOptimisticPrompt({
  runId,
  initialPrompt,
  durableItems,
  streamingItems,
  runIsLive,
  releaseComposerSource,
}: {
  runId: string;
  initialPrompt: PendingPrompt | null;
  durableItems: TranscriptItem[];
  streamingItems: TranscriptItem[];
  runIsLive: boolean;
  /** Remove the source only when the current launch has claimed its row. */
  releaseComposerSource: () => void;
}) {
  const [state, dispatch] = useReducer(
    optimisticPromptReducer,
    initialPrompt,
    initialOptimisticPromptState,
  );
  // React state drives rendering; this synchronous twin rejects native
  // callbacks that arrive after rollback or after a newer launch began.
  const stateRef = useRef(state);
  const launchSequence = useRef(0);

  const transition = useCallback((event: OptimisticPromptEvent): boolean => {
    const current = stateRef.current;
    const next = optimisticPromptReducer(current, event);
    if (next === current) return false;
    stateRef.current = next;
    dispatch(event);
    return true;
  }, []);

  const startContinuation = useCallback(
    (prompt: PendingPrompt) => {
      const launchId = `pending-continuation:${++launchSequence.current}`;
      transition({
        type: "continuationStarted",
        launchId,
        runId,
        prompt,
        durableItems,
      });
      // A keyboard send has no visual source to hand over; clear it now.
      if (!prompt.origin) releaseComposerSource();
    },
    [durableItems, releaseComposerSource, runId, transition],
  );

  const rollbackContinuation = useCallback(() => {
    transition({ type: "continuationRolledBack" });
  }, [transition]);

  const resolveMeasurement = useCallback(
    (launchId: string, flight: PromptFlight) => {
      if (!transition({ type: "flightMeasured", launchId, flight })) return;
      releaseComposerSource();
    },
    [releaseComposerSource, transition],
  );

  const failMeasurement = useCallback(
    (launchId: string) => {
      if (!transition({ type: "measurementFailed", launchId })) return;
      releaseComposerSource();
    },
    [releaseComposerSource, transition],
  );

  const landFlight = useCallback(
    (launchId: string) => {
      transition({ type: "flightLanded", launchId });
    },
    [transition],
  );

  const measuringLaunch = useMemo(
    () =>
      state.launch?.phase === "measuring"
        ? { id: state.launch.id, origin: state.launch.origin }
        : null,
    [state.launch],
  );

  // Never strand source text in the composer if a native view declines to
  // report coordinates. The launch id makes a stale timer a no-op.
  useEffect(() => {
    if (!measuringLaunch) return;
    const timer = setTimeout(
      () => failMeasurement(measuringLaunch.id),
      MEASUREMENT_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [failMeasurement, measuringLaunch]);

  const projection = useMemo(
    () =>
      projectOptimisticPrompt({
        state,
        initialPrompt,
        runId,
        durableItems,
        streamingItems,
        runIsLive,
      }),
    [durableItems, initialPrompt, runId, runIsLive, state, streamingItems],
  );
  const rows = useMemo(
    () => buildTurnRows(projection.renderedItems),
    [projection.renderedItems],
  );
  const trailingStreamingRows = useMemo(
    () => buildTurnRows(projection.trailingStreamingItems),
    [projection.trailingStreamingItems],
  );
  const actionState = useMemo(
    () =>
      transcriptActionState(projection.actionItems, {
        runIsLive,
        hasLocalContinuation:
          projection.pendingContinuationItem !== null && streamingItems.length === 0,
      }),
    [projection.actionItems, projection.pendingContinuationItem, runIsLive, streamingItems.length],
  );

  const initialPresentation = projection.pendingItem
    ? {
        item: projection.pendingItem,
        animateEntry: !initialPrompt?.origin,
        hidden: projection.launchInProgress && state.launch?.key === "pending-prompt",
        shouldMeasure:
          state.launch?.key === "pending-prompt" && state.launch.phase === "measuring",
      }
    : null;
  const continuationPresentation = projection.pendingContinuationItem
    ? {
        item: projection.pendingContinuationItem,
        animateEntry: !state.continuation?.origin,
        hidden: projection.launchInProgress && state.launch?.key === "pending-continuation",
        shouldMeasure:
          state.launch?.key === "pending-continuation" && state.launch.phase === "measuring",
      }
    : null;
  const flyingPrompt =
    state.launch?.phase === "flying" && state.launch.flight && projection.flyingPromptItem
      ? {
          launchId: state.launch.id,
          item: projection.flyingPromptItem,
          flight: state.launch.flight,
        }
      : null;

  return {
    transcript: {
      rows,
      trailingStreamingRows,
      actionState,
      turnIsActive: projection.turnIsActive,
    },
    initialPresentation,
    continuationPresentation,
    measuringLaunch,
    flyingPrompt,
    startContinuation,
    rollbackContinuation,
    resolveMeasurement,
    failMeasurement,
    landFlight,
  };
}
