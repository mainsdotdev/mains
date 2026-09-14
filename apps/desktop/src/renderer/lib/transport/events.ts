import { CHANNELS } from "../../../shared/ipc-kit/channels";
import { subscribeEvent } from "./event-subscriptions";

/**
 * Backend event subscriptions, routed through the active transport so they work
 * against both the local main process and a remote WebSocket backend. Drop-in for
 * the matching `window.api.<ns>.on<Event>` methods — call sites change only
 * `window.api` → `appEvents`.
 *
 * Callback types are derived from the existing `window.api` methods via `typeof`,
 * so they stay in lockstep with the preload definitions with zero duplication
 * (the `typeof` queries are compile-time only and erased at runtime).
 *
 * Only events the backend actually emits live here. Local-shell events
 * (`app.onFullscreenChange`, `updates.onStatusChange`) stay on `window.api.*` —
 * they always originate from the local main process.
 *
 * See docs/design/remote-backend.md (Phase 3C).
 */

type CallbackOf<F> = F extends (callback: infer C) => unknown ? C : never;

function bind<F extends (callback: never) => () => void>(
  channel: string,
): (callback: CallbackOf<F>) => () => void {
  return (callback) =>
    subscribeEvent(channel, callback as (payload: unknown) => void);
}

export const appEvents = {
  runs: {
    onStreamingEvent: bind<typeof window.api.runs.onStreamingEvent>(
      CHANNELS.runs.ephemeralEvent,
    ),
    onContextUsage: bind<typeof window.api.runs.onContextUsage>(
      CHANNELS.runs.contextUsage,
    ),
    onEventPersisted: bind<typeof window.api.runs.onEventPersisted>(
      CHANNELS.runs.eventPersisted,
    ),
    onStatusChanged: bind<typeof window.api.runs.onStatusChanged>(
      CHANNELS.runs.statusChanged,
    ),
    onUpdated: bind<typeof window.api.runs.onUpdated>(
      CHANNELS.runs.updated,
    ),
    onDiffUpdated: bind<typeof window.api.runs.onDiffUpdated>(
      CHANNELS.runs.diffUpdated,
    ),
    onToolApprovalRequest: bind<typeof window.api.runs.onToolApprovalRequest>(
      CHANNELS.runs.toolApprovalRequest,
    ),
    onToolApprovalResolved: bind<typeof window.api.runs.onToolApprovalResolved>(
      CHANNELS.runs.toolApprovalResolved,
    ),
  },
  providers: {
    onModelsUpdated: bind<typeof window.api.providers.onModelsUpdated>(
      CHANNELS.providers.modelsUpdated,
    ),
    onRateLimitsUpdated: bind<typeof window.api.providers.onRateLimitsUpdated>(
      CHANNELS.providers.rateLimitsUpdated,
    ),
    onGoalUpdated: bind<typeof window.api.providers.onGoalUpdated>(
      CHANNELS.providers.goalUpdated,
    ),
  },
  workspace: {
    onScriptComplete: bind<typeof window.api.workspace.onScriptComplete>(
      CHANNELS.workspace.scriptComplete,
    ),
    onFindingsChanged: bind<typeof window.api.workspace.onFindingsChanged>(
      CHANNELS.workspace.findingsChanged,
    ),
    onGitStateChanged: bind<typeof window.api.workspace.onGitStateChanged>(
      CHANNELS.workspace.gitStateChanged,
    ),
  },
  terminal: {
    onData: bind<typeof window.api.terminal.onData>(CHANNELS.terminal.data),
  },
};
