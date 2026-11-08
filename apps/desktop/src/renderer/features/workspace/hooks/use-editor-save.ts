import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "react-redux";
import { CHANNELS } from "@mains/contracts/channels";
import type { FileContentResponse, WriteFileTextResponse } from "@mains/contracts/file-text";
import type { RootState } from "@/lib/redux";
import { baseApi } from "@/lib/redux/api/baseApi";
import { appSettingsApi } from "@/lib/redux/api/appSettingsApi";
import { setSelectedFileContent } from "@/lib/redux/slices/workspaceSlice";
import { getTransport, onTransportChange } from "@/lib/transport";
import { createEditorSaveLifecycle, type EditorSaveSnapshot } from "../lib/editor-save-lifecycle";

// Unsaved buffers survive a view change. An old owner cannot remove or replace
// a newer view's recovery draft for the same backend/account/file.
const drafts = new Map<string, EditorSaveSnapshot>();
const owners = new Map<string, object>();
interface Options { ownerKey: string; filePath?: string; workspaceId?: string; backendId: string | null; accountId?: string; content: string; mtimeMs?: number; version?: string }
export function useEditorSave(options: Options) {
  const store = useStore<RootState>();
  const [resource] = useState(() => {
    const transport = getTransport(), recovered = drafts.get(options.ownerKey);
    let lease: object | undefined;
    const contextCurrent = () => {
      const state = store.getState();
      return getTransport() === transport && state.backends.activeBackendId === options.backendId &&
        appSettingsApi.endpoints.getAppSettings.select()(state).data?.accountId === options.accountId;
    };
    const savedDraft = recovered && recovered.draft !== options.content ? recovered : undefined;
    const editor = createEditorSaveLifecycle({
      ...(savedDraft?.baseline ?? { content: options.content, mtimeMs: options.mtimeMs, version: options.version }),
      draft: savedDraft?.draft, error: savedDraft?.error,
      remember(snapshot) {
        if (owners.get(options.ownerKey) !== lease) return;
        if (snapshot) drafts.set(options.ownerKey, snapshot); else drafts.delete(options.ownerKey);
      },
      async write(input) {
        if (!options.filePath || !contextCurrent()) throw new Error("The editor backend or account changed. Reopen the file to retry.");
        const response = await transport.invoke(CHANNELS.fileExplorer.writeFileText, [{ filePath: options.filePath, workspaceId: options.workspaceId, ...input }]);
        if (!response.success) throw new Error(response.error);
        if (contextCurrent() && options.workspaceId) store.dispatch(baseApi.util.invalidateTags([{ type: "WorkspaceDiffs", id: options.workspaceId }]));
        return response.data as WriteFileTextResponse;
      },
      async read() {
        if (!options.filePath || !contextCurrent()) throw new Error("The editor backend or account changed.");
        const response = await transport.invoke(CHANNELS.fileExplorer.readFileText, [{ filePath: options.filePath }]);
        if (!response.success) throw new Error(response.error);
        const data = response.data as FileContentResponse;
        if (!data || data.isBinary) throw new Error("The file could not be reloaded as text.");
        return data;
      },
      publish(content, result) {
        const state = store.getState();
        if (!contextCurrent() || state.workspace.selectedFile?.fullPath !== options.filePath ||
            (state.workspace.activeWorkspaceId ?? undefined) !== options.workspaceId) return;
        store.dispatch(setSelectedFileContent({ content, size: result.size, isBinary: false, encoding: "utf-8", mtimeMs: result.mtimeMs, version: result.version }));
      },
    });
    return { editor, activate() { const identity = {}; lease = identity; owners.set(options.ownerKey, identity); editor.attach(); return identity; } };
  });
  const { editor } = resource;
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot);
  useLayoutEffect(() => {
    const identity = resource.activate();
    const off = onTransportChange(() => editor.retire());
    return () => {
      off(); void editor.close().finally(() => {
        if (owners.get(options.ownerKey) === identity && !drafts.has(options.ownerKey)) owners.delete(options.ownerKey);
      });
    };
  }, [editor, resource, options.ownerKey]);
  useEffect(() => { const blur = () => { void editor.flush(); }; window.addEventListener("blur", blur); return () => window.removeEventListener("blur", blur); }, [editor]);
  return { ...state, edit: editor.edit, flush: editor.flush, retry: editor.retry, overwrite: editor.overwrite, reload: editor.reload };
}
