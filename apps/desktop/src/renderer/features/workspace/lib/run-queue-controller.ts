import type { RunStatus } from "@/lib/redux/api/runsApi";
import type { Transport } from "@/lib/transport/types";
import { CHANNELS } from "@mains/contracts/channels";
import { runOwnerKey } from "../../../../shared/ui-state-keys";
import {
  forgetRunQueue, markRunMessageSending, deferRunMessage, observeQueuedRunStatus, pauseRunQueue,
  removeRunMessage, resumeRunQueue, setRunMessageError,
  type RunQueueState, type QueuedRunMessage,
} from "@/lib/redux/slices/runQueueSlice";
import type { UnknownAction } from "@reduxjs/toolkit";
import { buildRunContextPayload, type Attachments } from "./run-context-payload";

interface QueueControllerDeps {
  getState: () => { runQueue: RunQueueState; backends: { activeBackendId: string | null } };
  dispatch: (action: UnknownAction) => unknown;
  getTransport: () => Transport;
  serializeUploads: (ownerKey: string) => Promise<Attachments | undefined>;
  clearUploads: (ownerKey: string) => void;
}

function isUncertainError(error: string): boolean {
  return /timeout|timed out|disconnect|offline|exited|stopping|socket|connection|transport/i.test(error);
}

/** One consumer per renderer; UI mounts and duplicate status events cannot race it. */
export function createRunQueueController(deps: QueueControllerDeps) {
  const locks = new Set<string>();
  const deferredUntil = new Map<string, number>();
  const { dispatch, getState, getTransport } = deps;
  function activeBackend() { return getState().backends.activeBackendId ?? "local"; }
  function queueFor(ownerKey: string) { return getState().runQueue.byOwner[ownerKey]; }
  function isCurrent(backendId: string, transport: Transport) {
    return backendId === activeBackend() && transport === getTransport() && transport.status() === "connected";
  }
  async function invoke<T>(transport: Transport, channel: string, args: unknown[]): Promise<T> {
    const result = await transport.invoke(channel, args);
    if (!result.success) throw new Error(result.error);
    return result.data as T;
  }
  function remove(ownerKey: string, message: QueuedRunMessage, accepted = false) {
    dispatch(removeRunMessage({ ownerKey, id: message.id, accepted }));
    if (!queueFor(ownerKey)?.messages.some((entry) => entry.id === message.id)) deps.clearUploads(message.uploadOwnerKey);
  }
  function clear(ownerKey: string) {
    const queue = queueFor(ownerKey);
    for (const message of queue?.messages ?? []) deps.clearUploads(message.uploadOwnerKey);
    if (queue?.draftBackup) deps.clearUploads(queue.draftBackup.uploadOwnerKey);
    dispatch(forgetRunQueue(ownerKey));
    deferredUntil.delete(ownerKey);
  }

  async function send(ownerKey: string, id: string, delivery: "queue" | "steer") {
    if (locks.has(ownerKey) || delivery === "queue" && (deferredUntil.get(ownerKey) ?? 0) > Date.now()) return false;
    const queue = queueFor(ownerKey);
    let message = queue?.messages.find((entry) => entry.id === id);
    const transport = getTransport();
    if (!queue || !message || message.status !== "queued" || !isCurrent(queue.backendId, transport)) return false;
    locks.add(ownerKey);
    let invoked = false;
    let accepted = false;
    try {
      if (delivery === "queue") {
        const run = await invoke<{ status: RunStatus; isArchived?: boolean } | null>(transport, CHANNELS.runs.getById, [queue.runId]);
        if (!run) { clear(ownerKey); return false; }
        if (!isCurrent(queue.backendId, transport)) return false;
        dispatch(observeQueuedRunStatus({ ownerKey, status: run.status }));
        if (run.isArchived) {
          dispatch(pauseRunQueue({ ownerKey, reason: "This conversation is archived." }));
          return false;
        }
        if (run.status !== "succeeded" && !(queue.resumeRequested && (run.status === "failed" || run.status === "canceled"))) return false;
        if (queue.resumeRequested && (run.status === "failed" || run.status === "canceled")) dispatch(resumeRunQueue(ownerKey));
      }
      // Editing/removal may have happened while the status read was pending.
      const current = queueFor(ownerKey);
      const nextMessage = delivery === "queue" ? current?.messages[0] : current?.messages.find((entry) => entry.id === id);
      if (!current || nextMessage?.status !== "queued" ||
          (delivery === "queue" && current.pauseReason && !queue.resumeRequested)) return false;
      // A drag during preflight changes the FIFO head, before any input is sent.
      message = nextMessage;
      id = message.id;
      dispatch(markRunMessageSending({ ownerKey, id, delivery }));
      if (queueFor(ownerKey)?.messages.find((entry) => entry.id === id)?.status !== "sending") return false;
      const uploads = await deps.serializeUploads(message.uploadOwnerKey);
      const { initialContext, ...context } = buildRunContextPayload(message.contextItems, uploads);
      if (!isCurrent(queue.backendId, transport)) throw new Error("Backend connection changed before sending.");
      const account = await invoke<{ id: string } | null>(transport, CHANNELS.account.get, []);
      if (!account) throw new Error("No account found.");
      if (!isCurrent(queue.backendId, transport)) throw new Error("Backend connection changed before sending.");
      invoked = true;
      await invoke(transport, delivery === "steer" ? CHANNELS.runs.steer : CHANNELS.runs.continue, [{
        runId: queue.runId, accountId: account.id, message: message.text,
        clientUserMessageId: message.id, additionalContext: initialContext, ...context,
        ...(delivery === "queue" ? { model: message.model, additionalDirectories: message.additionalDirectories } : {}),
      }]);
      remove(ownerKey, message, true);
      accepted = true;
      return true;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (delivery === "queue" && /already (?:has an active response|starting a response)/i.test(text)) {
        // Polling may see the terminal run row while its previous session is
        // still closing Git/tool state. Keep FIFO intact until it is ready.
        deferredUntil.set(ownerKey, Date.now() + 1000);
        dispatch(deferRunMessage({ ownerKey, id }));
        return false;
      }
      dispatch(setRunMessageError({ ownerKey, id, error: text, unknown: invoked && isUncertainError(text) }));
      return false;
    } finally {
      locks.delete(ownerKey);
      if (accepted && queueFor(ownerKey)?.runStatus === "succeeded") queueMicrotask(() => { void pump(); });
    }
  }

  async function pump() {
    if (getTransport().status() !== "connected") {
      pauseBackend(activeBackend(), "Backend disconnected. Queued messages are paused.");
      return;
    }
    await Promise.all(Object.entries(getState().runQueue.byOwner).map(async ([ownerKey, queue]) => {
      if (queue.backendId !== activeBackend() || queue.pauseReason || locks.has(ownerKey)) return;
      const head = queue.messages[0];
      if (!head || head.status !== "queued" || queue.messages.some((entry) => entry.status === "sending")) return;
      await send(ownerKey, head.id, "queue");
    }));
  }

  async function resume(ownerKey: string) {
    const queue = queueFor(ownerKey);
    const transport = getTransport();
    if (!queue || !isCurrent(queue.backendId, transport) || locks.has(ownerKey)) return;
    const unknown = queue.messages.filter((message) => message.status === "unknown");
    if (unknown.length) {
      locks.add(ownerKey);
      try {
        const account = await invoke<{ id: string }>(transport, CHANNELS.account.get, []);
        for (const message of unknown) {
          const uploads = await deps.serializeUploads(message.uploadOwnerKey);
          const { initialContext, ...context } = buildRunContextPayload(message.contextItems, uploads);
          if (!isCurrent(queue.backendId, transport)) return;
          const result = await invoke<{ accepted: boolean }>(transport, CHANNELS.runs.inputStatus, [{
            runId: queue.runId, accountId: account.id, clientUserMessageId: message.id,
            input: { message: message.text, additionalContext: initialContext, ...context },
            delivery: message.delivery,
          }]);
          if (result.accepted) remove(ownerKey, message, true);
        }
      } catch { /* Preserve uncertain inputs; never resend them automatically. */ }
      finally { locks.delete(ownerKey); }
    }
    if (!queueFor(ownerKey)?.messages.some((message) => message.status === "unknown")) {
      dispatch(resumeRunQueue(ownerKey));
      await pump();
    }
  }

  function onStatus(backendId: string, runId: string, status: RunStatus) {
    const ownerKey = runOwnerKey(backendId, runId);
    deferredUntil.delete(ownerKey);
    dispatch(observeQueuedRunStatus({ ownerKey, status }));
    // Event dispatch may race an ACK; the next store tick/poll handles that case.
  }
  function pauseBackend(backendId: string, reason: string) {
    for (const [ownerKey, queue] of Object.entries(getState().runQueue.byOwner)) {
      if (queue.backendId === backendId && queue.messages.length) dispatch(pauseRunQueue({ ownerKey, reason }));
    }
  }
  return { send, pump, resume, remove, clear, onStatus, pauseBackend };
}
