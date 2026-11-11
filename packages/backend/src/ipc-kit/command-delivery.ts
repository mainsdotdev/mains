import { fail, type ServiceResponse } from "@mains/contracts/service-response";
import { decodeWireValue, encodeWireValue } from "@mains/contracts/ws-protocol";

export interface CommandReceiptStore {
  find(deviceId: string, commandId: string): Promise<string | null>;
  reserve(deviceId: string, commandId: string, channel: string, pendingResult: string): Promise<boolean>;
  record(deviceId: string, commandId: string, channel: string, result: string): Promise<void>;
}

// A durable uncertainty barrier, written BEFORE effects. If the process exits
// or the final write fails, a retry must not execute those effects again.
export const PENDING_COMMAND_RESULT = encodeWireValue(fail("Command outcome is unknown because its result was not recorded. Check the conversation before sending another command."));
const runningByStore = new WeakMap<CommandReceiptStore, Map<string, Promise<ServiceResponse<unknown>>>>();

function readResult(value: string): ServiceResponse<unknown> {
  const result = decodeWireValue(value) as ServiceResponse<unknown>;
  if (!result || typeof result.success !== "boolean" || (!result.success && typeof result.error !== "string")) {
    throw new Error("Invalid command receipt");
  }
  return result;
}

/** unseen → reserved → executing → recorded; interruption → uncertain.
 * Reconnects join the running attempt; settled/restarted retries read receipts.
 * Read/reservation failures never admit a handler. No handler owns replay rules.
 */
export function runStoredCommand(
  store: CommandReceiptStore,
  deviceId: string,
  commandId: string,
  channel: string,
  invoke: () => Promise<ServiceResponse<unknown>>,
): Promise<ServiceResponse<unknown>> {
  let running = runningByStore.get(store);
  if (!running) { running = new Map(); runningByStore.set(store, running); }
  const key = JSON.stringify([deviceId, commandId]);
  const existing = running.get(key);
  if (existing) return existing;
  // Claim the slot before storage or handler callbacks can reenter this owner.
  const attempt = Promise.resolve().then(async () => {
    try {
      const stored = await store.find(deviceId, commandId);
      if (stored !== null) return readResult(stored);
      if (!await store.reserve(deviceId, commandId, channel, PENDING_COMMAND_RESULT)) {
        const reserved = await store.find(deviceId, commandId);
        if (reserved === null) throw new Error("Command receipt disappeared");
        return readResult(reserved);
      }
    } catch {
      return fail("Could not verify the previous command result. The command was not run again.");
    }
    const result = await invoke();
    try {
      await store.record(deviceId, commandId, channel, encodeWireValue(result));
      return result;
    } catch (error) {
      console.error(`[ws] could not record receipt for ${channel} (${commandId}):`, error);
      return readResult(PENDING_COMMAND_RESULT);
    }
  }).finally(() => { running.delete(key); });
  running.set(key, attempt);
  return attempt;
}
