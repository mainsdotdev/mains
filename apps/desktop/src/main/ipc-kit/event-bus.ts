/**
 * Outbound event bus — the single path for pushing events from the main process
 * to clients.
 *
 * Each `webContents.send` broadcast used to be open-coded at the call site
 * (`BrowserWindow.getAllWindows().forEach(win => win.webContents.send(...))`).
 * They now go through {@link emit}, which fans out to the registered sinks.
 *
 * This module is intentionally free of any Electron dependency so it stays
 * importable in a headless `mains serve` process. The local renderer is wired up
 * by registering the BrowserWindow sink at startup (see `browser-window-sink.ts`,
 * registered in `src/main/index.ts`); a serve process would register a WebSocket
 * sink instead, so the same call sites reach remote clients without change.
 *
 * See docs/design/remote-backend.md (Pillar C — event bus / client registry).
 */

export interface EventScope {
  runId?: string;
  workspaceId?: string;
  /** A specific connected client; used by the WebSocket sink, ignored locally. */
  clientId?: string;
}

export interface EventSink {
  readonly kind: string;
  send(channel: string, payload: unknown, scope?: EventScope): void;
}

const sinks = new Set<EventSink>();

/** Register an outbound sink. Returns an unregister function. */
export function registerEventSink(sink: EventSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/** Remove all registered sinks. After this, `emit` is a no-op until one is added. */
export function clearEventSinks(): void {
  sinks.clear();
}

/**
 * Push an event on a `"domain:action"` channel to all clients. Fans out to every
 * registered sink; a no-op if none are registered (e.g. unit tests that don't
 * assert outbound events). `scope` is advisory: the BrowserWindow sink broadcasts
 * regardless; a WebSocket sink may use it to target specific clients.
 */
export function emit(
  channel: string,
  payload: unknown,
  scope?: EventScope,
): void {
  for (const sink of sinks) sink.send(channel, payload, scope);
}
