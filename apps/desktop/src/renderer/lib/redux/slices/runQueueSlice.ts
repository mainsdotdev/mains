import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import type { RunStatus } from "../api/runsApi";
import type { QueuedMessagePreview } from "@/features/workspace/lib/run-queue-preview";
import type { ConversationSettings } from "@mains/contracts/run-settings";

export interface QueuedRunMessage {
  id: string;
  text: string;
  contextItems: ContextItem[];
  uploadOwnerKey: string;
  attachmentNames: string[];
  model?: string;
  conversationSettings?: ConversationSettings;
  additionalDirectories?: string[];
  status: "queued" | "editing" | "sending" | "unknown" | "error";
  error?: string;
  delivery?: "queue" | "steer";
  /** Display metadata for the native child; original files stay outside Redux. */
  preview?: QueuedMessagePreview;
}

export interface QueueDraftBackup {
  text: string;
  contextItems: ContextItem[];
  uploadOwnerKey: string;
  model: string;
  conversationSettings?: ConversationSettings;
  additionalDirectories: string[];
}

export interface ConversationQueue {
  backendId: string;
  runId: string;
  workspaceId?: string;
  messages: QueuedRunMessage[];
  mode: "queue" | "steer";
  runStatus: RunStatus;
  pauseReason?: string;
  resumeRequested?: boolean;
  editingId?: string;
  draftBackup?: QueueDraftBackup;
  draftRevision?: number;
}

export interface RunQueueState { byOwner: Record<string, ConversationQueue> }
const initialState: RunQueueState = { byOwner: {} };

const runQueueSlice = createSlice({
  name: "runQueue",
  initialState,
  reducers: {
    enqueueRunMessage(state, { payload }: PayloadAction<{
      ownerKey: string; backendId: string; runId: string; workspaceId?: string;
      runStatus: RunStatus; message: QueuedRunMessage;
      preserveDraft?: boolean;
    }>) {
      const queue = state.byOwner[payload.ownerKey] ??= {
        backendId: payload.backendId, runId: payload.runId, workspaceId: payload.workspaceId,
        messages: [], mode: "queue", runStatus: payload.runStatus,
      };
      if (!queue.messages.some((message) => message.id === payload.message.id)) {
        queue.messages.push(payload.message);
        if (!payload.preserveDraft) queue.draftRevision = (queue.draftRevision ?? 0) + 1;
      }
    },
    setRunQueueMode(state, { payload }: PayloadAction<{ ownerKey: string; mode: ConversationQueue["mode"] }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (queue) queue.mode = payload.mode;
    },
    reorderRunMessages(state, { payload }: PayloadAction<{ ownerKey: string; orderedIds: string[] }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (!queue || queue.editingId || queue.messages.some((message) => ["sending", "editing", "unknown"].includes(message.status))) return;
      const byId = new Map(queue.messages.map((message) => [message.id, message]));
      // A stale drop must never discard a message enqueued or removed meanwhile.
      if (payload.orderedIds.length !== queue.messages.length || new Set(payload.orderedIds).size !== byId.size ||
          payload.orderedIds.some((id) => !byId.has(id))) return;
      queue.messages = payload.orderedIds.map((id) => byId.get(id)!);
    },
    observeQueuedRunStatus(state, { payload }: PayloadAction<{ ownerKey: string; status: RunStatus }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (!queue) return;
      queue.runStatus = payload.status;
      if (payload.status === "failed" || payload.status === "canceled") {
        queue.pauseReason ??= payload.status === "canceled" ? "Run stopped. Queued messages are paused." : "Run failed. Queued messages are paused.";
      }
    },
    pauseRunQueue(state, { payload }: PayloadAction<{ ownerKey: string; reason: string }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (queue) { queue.pauseReason = payload.reason; queue.resumeRequested = false; }
    },
    resumeRunQueue(state, { payload }: PayloadAction<string>) {
      const queue = state.byOwner[payload];
      if (!queue || queue.messages.some((message) => message.status === "unknown" || message.status === "sending")) return;
      delete queue.pauseReason;
      queue.resumeRequested = true;
      for (const message of queue.messages) {
        if (message.status === "error") { message.status = "queued"; delete message.error; }
      }
    },
    markRunMessageSending(state, { payload }: PayloadAction<{ ownerKey: string; id: string; delivery: "queue" | "steer" }>) {
      const queue = state.byOwner[payload.ownerKey];
      const message = queue?.messages.find((entry) => entry.id === payload.id);
      if (!queue || !message || message.status !== "queued" || queue.messages.some((entry) => entry.status === "sending")) return;
      message.status = "sending";
      message.delivery = payload.delivery;
      delete message.error;
      queue.resumeRequested = false;
      if (payload.delivery === "queue") queue.runStatus = "running";
    },
    setRunMessageError(state, { payload }: PayloadAction<{ ownerKey: string; id: string; error: string; unknown?: boolean }>) {
      const queue = state.byOwner[payload.ownerKey];
      const message = queue?.messages.find((entry) => entry.id === payload.id);
      if (!queue || !message) return;
      message.status = payload.unknown ? "unknown" : "error";
      message.error = payload.error;
      queue.pauseReason = payload.unknown ? "Delivery could not be confirmed. Check before sending again." : payload.error;
    },
    deferRunMessage(state, { payload }: PayloadAction<{ ownerKey: string; id: string }>) {
      const message = state.byOwner[payload.ownerKey]?.messages.find((entry) => entry.id === payload.id);
      if (message?.status === "sending") message.status = "queued";
    },
    removeRunMessage(state, { payload }: PayloadAction<{ ownerKey: string; id: string; accepted?: boolean }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (!queue) return;
      queue.messages = queue.messages.filter((message) => message.id !== payload.id ||
        (!payload.accepted && (message.status === "sending" || message.status === "editing")));
    },
    beginRunMessageEdit(state, { payload }: PayloadAction<{ ownerKey: string; id: string; backup: QueueDraftBackup }>) {
      const queue = state.byOwner[payload.ownerKey];
      const message = queue?.messages.find((entry) => entry.id === payload.id);
      if (!queue || !message || queue.editingId || !["queued", "error"].includes(message.status)) return;
      queue.editingId = message.id;
      queue.draftBackup = payload.backup;
      queue.draftRevision = (queue.draftRevision ?? 0) + 1;
      message.status = "editing";
    },
    finishRunMessageEdit(state, { payload }: PayloadAction<{ ownerKey: string; message?: QueuedRunMessage }>) {
      const queue = state.byOwner[payload.ownerKey];
      if (!queue?.editingId) return;
      const index = queue.messages.findIndex((entry) => entry.id === queue.editingId);
      if (index >= 0) {
        if (payload.message) queue.messages[index] = { ...payload.message, id: queue.editingId, status: "queued", error: undefined };
        else queue.messages[index].status = "queued";
      }
      delete queue.editingId;
      delete queue.draftBackup;
      queue.draftRevision = (queue.draftRevision ?? 0) + 1;
    },
    forgetRunQueue(state, { payload }: PayloadAction<string>) { delete state.byOwner[payload]; },
    mirrorRunQueue(state, { payload }: PayloadAction<{ ownerKey: string; queue?: ConversationQueue }>) {
      if (payload.queue) state.byOwner[payload.ownerKey] = payload.queue;
      else delete state.byOwner[payload.ownerKey];
    },
  },
});

export const {
  enqueueRunMessage, setRunQueueMode, reorderRunMessages, observeQueuedRunStatus, pauseRunQueue, resumeRunQueue,
  markRunMessageSending, setRunMessageError, deferRunMessage, removeRunMessage, beginRunMessageEdit,
  finishRunMessageEdit, forgetRunQueue, mirrorRunQueue,
} = runQueueSlice.actions;
export default runQueueSlice.reducer;
