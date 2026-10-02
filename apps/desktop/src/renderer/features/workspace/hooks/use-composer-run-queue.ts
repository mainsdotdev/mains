import { useCallback } from "react";
import type { UploadedFile } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { store } from "@/lib/redux";
import {
  beginRunMessageEdit, enqueueRunMessage, finishRunMessageEdit, setRunQueueMode, reorderRunMessages,
  type ConversationQueue, type QueuedRunMessage,
} from "@/lib/redux/slices/runQueueSlice";
import { setContextItemsForKey, setDraftText } from "@/lib/redux/slices/workspaceSlice";
import type { ContextItem } from "../lib/composer-context";
import type { Run } from "../types";
import { runMessageQueue } from "../lib/run-message-queue";
import {
  clearTransientUploads, getTransientUploadsForOwner, moveTransientUploadsToOwner,
  setTransientUploadsForOwner,
} from "./use-transient-uploads";

export interface ComposerRunQueue {
  queue?: ConversationQueue;
  editing: boolean;
  onSteer: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onCancelEdit: () => void;
  onResume: () => void;
  onModeChange: (mode: "queue" | "steer") => void;
  onReorder: (orderedIds: string[]) => void;
}

export interface QueueMessageSnapshot {
  text: string;
  contextItems: ContextItem[];
  files: UploadedFile[];
  model?: string;
  additionalDirectories?: string[];
  editingId?: string;
}

interface Options {
  enabled: boolean; ownerKey: string; backendId: string | null; run?: Run;
  selectedModel: string; additionalDirectories: string[];
  setModel: (model: string) => void; setDirectories: (directories: string[]) => void;
}

export function useComposerRunQueue(options: Options) {
  const { ownerKey, backendId, run, selectedModel, additionalDirectories, setModel, setDirectories } = options;
  const dispatch = useAppDispatch();
  const queue = useAppSelector((state) => state.runQueue?.byOwner[ownerKey]);
  const getQueue = useCallback(() => store.getState().runQueue?.byOwner[ownerKey], [ownerKey]);
  const setDraft = useCallback((text: string, items: ContextItem[]) => {
    dispatch(setDraftText({ key: ownerKey, text }));
    dispatch(setContextItemsForKey({ key: ownerKey, items }));
  }, [dispatch, ownerKey]);

  const enqueue = useCallback((text: string, items: ContextItem[], files: UploadedFile[], snapshot?: QueueMessageSnapshot) => {
    if (!run || !options.enabled) return null;
    const id = crypto.randomUUID();
    const uploadOwnerKey = `${ownerKey}:queue:${id}`;
    if (snapshot) setTransientUploadsForOwner(uploadOwnerKey, files);
    else moveTransientUploadsToOwner(ownerKey, uploadOwnerKey);
    dispatch(enqueueRunMessage({
      ownerKey, backendId: backendId ?? "local", runId: run.id, workspaceId: run.workspaceId ?? undefined,
      runStatus: run.status,
      preserveDraft: !!snapshot,
      message: { id, text, contextItems: items, uploadOwnerKey, attachmentNames: files.map((file) => file.file.name),
        model: (snapshot?.model ?? selectedModel) || undefined,
        additionalDirectories: [...(snapshot?.additionalDirectories ?? additionalDirectories)], status: "queued" },
    }));
    return id;
  }, [run, options.enabled, ownerKey, backendId, dispatch, selectedModel, additionalDirectories]);

  const onEdit = useCallback((id: string) => {
    const current = getQueue();
    const message = current?.messages.find((entry) => entry.id === id);
    if (!message || current?.editingId || !["queued", "error"].includes(message.status)) return;
    const workspace = store.getState().workspace;
    const items = workspace.composerContextKey === ownerKey ? workspace.contextItems : workspace.contextItemsByKey[ownerKey] ?? [];
    const backupOwner = `${ownerKey}:queue-draft`;
    moveTransientUploadsToOwner(ownerKey, backupOwner);
    dispatch(beginRunMessageEdit({ ownerKey, id, backup: {
      text: workspace.draftTextByKey[ownerKey] ?? "", contextItems: [...items], uploadOwnerKey: backupOwner,
      model: selectedModel, additionalDirectories: [...additionalDirectories],
    } }));
    // Keep originals untouched for Cancel. Only previews are cloned; File
    // bytes remain shared and never enter Redux.
    const files = getTransientUploadsForOwner(message.uploadOwnerKey).map((file) => ({
      ...file, preview: file.preview ? URL.createObjectURL(file.file) : undefined,
    }));
    setTransientUploadsForOwner(ownerKey, files);
    setDraft(message.text, message.contextItems);
    if (message.model) setModel(message.model);
    setDirectories(message.additionalDirectories ?? []);
  }, [getQueue, ownerKey, dispatch, selectedModel, additionalDirectories, setDraft, setModel, setDirectories]);

  const finishEdit = useCallback((save: boolean, text?: string, items?: ContextItem[], snapshot?: QueueMessageSnapshot) => {
    const current = getQueue();
    const message = current?.messages.find((entry) => entry.id === current.editingId);
    const backup = current?.draftBackup;
    if (!current?.editingId || !message || !backup) return false;
    let updated: QueuedRunMessage | undefined;
    if (save) {
      const files = snapshot?.files ?? getTransientUploadsForOwner(ownerKey);
      updated = { ...message, text: text ?? "", contextItems: items ?? [], attachmentNames: files.map((file) => file.file.name),
        model: (snapshot?.model ?? selectedModel) || undefined,
        additionalDirectories: [...(snapshot?.additionalDirectories ?? additionalDirectories)], status: "queued" };
      if (snapshot) {
        setTransientUploadsForOwner(message.uploadOwnerKey, files);
        clearTransientUploads(ownerKey);
      } else moveTransientUploadsToOwner(ownerKey, message.uploadOwnerKey);
    } else clearTransientUploads(ownerKey);
    moveTransientUploadsToOwner(backup.uploadOwnerKey, ownerKey);
    setDraft(backup.text, backup.contextItems);
    setModel(backup.model);
    setDirectories(backup.additionalDirectories);
    dispatch(finishRunMessageEdit({ ownerKey, message: updated }));
    return true;
  }, [getQueue, ownerKey, selectedModel, additionalDirectories, dispatch, setDraft, setModel, setDirectories]);

  const controls: ComposerRunQueue = {
    queue, editing: !!queue?.editingId,
    onEdit,
    onCancelEdit: () => { finishEdit(false); },
    onSteer: (id) => { void runMessageQueue.send(ownerKey, id, "steer"); },
    onRemove: (id) => {
      const message = getQueue()?.messages.find((entry) => entry.id === id);
      if (message) runMessageQueue.remove(ownerKey, message);
    },
    onResume: () => { void runMessageQueue.resume(ownerKey); },
    onModeChange: (mode) => dispatch(setRunQueueMode({ ownerKey, mode })),
    onReorder: (orderedIds) => dispatch(reorderRunMessages({ ownerKey, orderedIds })),
  };
  return {
    controls: options.enabled ? controls : undefined,
    enqueue,
    saveEdit: (text: string, items: ContextItem[]) => finishEdit(true, text, items),
    submitSnapshot: (snapshot: QueueMessageSnapshot) => {
      const current = getQueue();
      if (snapshot.editingId) {
        return current?.editingId === snapshot.editingId
          ? finishEdit(true, snapshot.text, snapshot.contextItems, snapshot)
          : false;
      }
      if (current?.editingId) return false;
      const id = enqueue(snapshot.text, snapshot.contextItems, snapshot.files, snapshot);
      if (id && current?.mode === "steer" && (run?.status === "running" || run?.status === "queued")) {
        void runMessageQueue.send(ownerKey, id, "steer");
      }
      return !!id;
    },
  };
}
