import { fail, type ServiceResponse } from "../../shared/ipc-kit/service-response";

/**
 * Transport-agnostic registry of request/response handlers, keyed by
 * `"domain:action"` channel.
 *
 * Modules register handlers through the `ipcMain` shim (`ipc-main.ts`), which
 * stores them here AND binds them on the real Electron `ipcMain`. The WS router
 * (headless `mains serve`) invokes the same handlers from here via
 * {@link invokeHandler}.
 *
 * Handlers keep the exact `ipcMain.handle` shape: `(ctx, ...args)`. The first
 * parameter is the invocation context — the Electron `IpcMainInvokeEvent` on the
 * local path, or a synthetic `{ clientId }` ({@link IpcInvokeContext}) on the WS
 * path — followed by the channel's positional args. Handlers that ignore it
 * (`(_, payload) => …`, the overwhelming majority) work identically on both
 * transports. Handlers that need the real Electron event (e.g. terminal
 * streaming via `event.sender`) stay on raw `ipcMain` and are not registered here.
 *
 * This module is intentionally free of any Electron dependency so it stays usable
 * in a headless process. See docs/design/remote-backend.md (Pillar B).
 */

export interface IpcInvokeContext {
  /** Connected client id on the WS path; undefined on the local Electron path. */
  clientId?: string;
  /**
   * The paired device the WS client authenticated as, when it presented a
   * device token rather than the shared pairing token. Undefined locally.
   */
  deviceId?: string;
}

export type IpcHandler = (
  ...args: any[]
) => ServiceResponse<unknown> | Promise<ServiceResponse<unknown>>;

const handlers = new Map<string, IpcHandler>();

export function registerHandler(channel: string, handler: IpcHandler): void {
  handlers.set(channel, handler);
}

export function unregisterHandler(channel: string): void {
  handlers.delete(channel);
}

export function hasHandler(channel: string): boolean {
  return handlers.has(channel);
}

/** Every channel currently registered — what a remote client can invoke. */
export function registeredChannels(): string[] {
  return [...handlers.keys()];
}

/**
 * Invoke a registered handler by channel. Used by the WS router. `ctx` is passed
 * as the handler's first argument (the invocation context), followed by `args`.
 */
export async function invokeHandler(
  channel: string,
  args: unknown[],
  ctx: IpcInvokeContext = {},
): Promise<ServiceResponse<unknown>> {
  const handler = handlers.get(channel);
  if (!handler) return fail(`No handler registered for channel "${channel}"`);
  try {
    return await handler(ctx, ...args);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Handler threw");
  }
}

/** Remove all handlers. Primarily for tests/shutdown. */
export function clearHandlers(): void {
  handlers.clear();
}
