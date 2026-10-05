// @vitest-environment jsdom
import { createElement, useState, type ReactNode, type ComponentProps } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider, useDispatch, useSelector } from "react-redux";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import runQueueReducer from "@/lib/redux/slices/runQueueSlice";
import workspaceReducer, { setComposerContextKey, setDraftText, setContextItemsForKey } from "@/lib/redux/slices/workspaceSlice";
import { getTransientUploadsForOwner, setTransientUploadsForOwner, clearTransientUploads } from "./use-transient-uploads";
import type { UploadedFile } from "@/components/ui";
import type { ContextItem } from "../lib/composer-context";

const mocks = vi.hoisted(() => ({ getState: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState(), dispatch: (action: unknown) => mocks.dispatch(action) } }));
vi.mock("@/lib/redux/hooks", () => ({ useAppSelector: useSelector, useAppDispatch: useDispatch }));
vi.mock("../lib/run-message-queue", () => ({ runMessageQueue: { send: vi.fn(), remove: vi.fn(), resume: vi.fn() } }));
import { useComposerRunQueue } from "./use-composer-run-queue";

const ownerKey = '["local","run","queue-chat"]';
const draftContext: ContextItem = { kind: "file", name: "draft.ts", fullPath: "/draft.ts", type: "file" };
const queueContext: ContextItem = { kind: "skill", name: "queued-skill" };
const revoke = vi.fn();
beforeEach(() => {
  revoke.mockClear();
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:edit-copy") });
  clearTransientUploads(ownerKey);
});

function setup() {
  const store = configureStore({ reducer: { workspace: workspaceReducer, runQueue: runQueueReducer } });
  mocks.getState.mockImplementation(store.getState);
  mocks.dispatch.mockImplementation(store.dispatch);
  store.dispatch(setComposerContextKey(ownerKey));
  const wrapper = ({ children }: { children: ReactNode }) => createElement(Provider, { store } as ComponentProps<typeof Provider>, children);
  const hook = renderHook(() => {
    const [model, setModel] = useState("draft-model");
    const [directories, setDirectories] = useState(["/draft-folder"]);
    return useComposerRunQueue({ enabled: true, ownerKey, backendId: null,
      run: { id: "queue-chat", status: "running", goal: "original", providerId: "codex" },
      selectedModel: model, additionalDirectories: directories, setModel, setDirectories });
  }, { wrapper });
  const queuedFile: UploadedFile = { file: new File(["queued image"], "image.png", { type: "image/png" }), type: "image", preview: "blob:queued" };
  setTransientUploadsForOwner(ownerKey, [queuedFile]);
  let id!: string;
  act(() => { id = hook.result.current.enqueue("queued text", [queueContext], [queuedFile])!; });
  const uploadOwnerKey = store.getState().runQueue.byOwner[ownerKey].messages[0].uploadOwnerKey;
  const draftFile: UploadedFile = { file: new File(["draft image"], "draft.png", { type: "image/png" }), type: "image", preview: "blob:draft" };
  setTransientUploadsForOwner(ownerKey, [draftFile]);
  act(() => {
    store.dispatch(setDraftText({ key: ownerKey, text: "unfinished draft" }));
    store.dispatch(setContextItemsForKey({ key: ownerKey, items: [draftContext] }));
  });
  return { ...hook, store, id, uploadOwnerKey, draftFile, queuedFile };
}

describe("queued message composer editing", () => {
  it("enqueues a floating chat snapshot without touching newer draft text or files", () => {
    const h = setup();
    const revision = h.store.getState().runQueue.byOwner[ownerKey].draftRevision;
    const submittedFile: UploadedFile = { file: new File(["snapshot"], "snapshot.txt"), type: "document" };
    act(() => { expect(h.result.current.submitSnapshot({
      text: "sent from floating chat", contextItems: [queueContext], files: [submittedFile],
      model: "snapshot-model", additionalDirectories: ["/snapshot"],
    })).toBe(true); });
    const queue = h.store.getState().runQueue.byOwner[ownerKey];
    expect(queue.messages[1]).toMatchObject({ text: "sent from floating chat", model: "snapshot-model", additionalDirectories: ["/snapshot"] });
    expect(getTransientUploadsForOwner(queue.messages[1].uploadOwnerKey)).toEqual([submittedFile]);
    expect(h.store.getState().workspace.draftTextByKey[ownerKey]).toBe("unfinished draft");
    expect(getTransientUploadsForOwner(ownerKey)).toEqual([h.draftFile]);
    expect(queue.draftRevision).toBe(revision);
    h.unmount();
  });

  it("preserves File bytes and restores the previous draft and original queue on Cancel", () => {
    const h = setup();
    expect(getTransientUploadsForOwner(h.uploadOwnerKey)[0]).toBe(h.queuedFile);
    expect(revoke).not.toHaveBeenCalledWith("blob:queued");
    act(() => h.result.current.controls!.onEdit(h.id));
    expect(h.store.getState().workspace.draftTextByKey[ownerKey]).toBe("queued text");
    expect(getTransientUploadsForOwner(ownerKey)[0].file).toBe(h.queuedFile.file);
    expect(getTransientUploadsForOwner(ownerKey)[0].preview).toBe("blob:edit-copy");
    // Detaching the edited copy cannot revoke the original queued preview.
    setTransientUploadsForOwner(ownerKey, []);
    act(() => h.result.current.controls!.onCancelEdit());
    expect(h.store.getState().workspace.draftTextByKey[ownerKey]).toBe("unfinished draft");
    expect(h.store.getState().workspace.contextItems).toEqual([draftContext]);
    expect(getTransientUploadsForOwner(ownerKey)).toEqual([h.draftFile]);
    expect(getTransientUploadsForOwner(h.uploadOwnerKey)).toEqual([h.queuedFile]);
    expect(h.store.getState().runQueue.byOwner[ownerKey].messages[0]).toMatchObject({ text: "queued text", status: "queued" });
    expect(revoke).not.toHaveBeenCalledWith("blob:queued");
    h.unmount();
  });

  it("saves into the same queue position and restores another pending draft", () => {
    const h = setup();
    act(() => h.result.current.controls!.onEdit(h.id));
    act(() => { expect(h.result.current.saveEdit("changed text", [draftContext])).toBe(true); });
    const queue = h.store.getState().runQueue.byOwner[ownerKey];
    expect(queue.messages.map((message) => message.id)).toEqual([h.id]);
    expect(queue.messages[0]).toMatchObject({ text: "changed text", contextItems: [draftContext], status: "queued" });
    expect(queue.editingId).toBeUndefined();
    expect(getTransientUploadsForOwner(h.uploadOwnerKey)[0].file).toBe(h.queuedFile.file);
    expect(getTransientUploadsForOwner(ownerKey)).toEqual([h.draftFile]);
    expect(h.store.getState().workspace.draftTextByKey[ownerKey]).toBe("unfinished draft");
    h.unmount();
  });

  it("saves a floating edit only into its original message", () => {
    const h = setup();
    act(() => h.result.current.controls!.onEdit(h.id));
    const snapshot = { text: "floating edit", contextItems: [draftContext], files: [], editingId: "another-id" };
    act(() => { expect(h.result.current.submitSnapshot(snapshot)).toBe(false); });
    expect(h.store.getState().runQueue.byOwner[ownerKey].editingId).toBe(h.id);
    act(() => { expect(h.result.current.submitSnapshot({ ...snapshot, editingId: h.id })).toBe(true); });
    expect(h.store.getState().runQueue.byOwner[ownerKey].messages[0]).toMatchObject({ id: h.id, text: "floating edit", attachmentNames: [] });
    expect(h.store.getState().workspace.draftTextByKey[ownerKey]).toBe("unfinished draft");
    expect(getTransientUploadsForOwner(ownerKey)).toEqual([h.draftFile]);
    h.unmount();
  });
});
