import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "react-redux";
import { CHANNELS } from "@mains/contracts/channels";
import { onAppReady } from "@/lib/app-ready";
import type { RootState } from "@/lib/redux";
import { workspaceApi } from "@/lib/redux/api/workspaceApi";
import { getTransport, onTransportChange } from "@/lib/transport/registry";

const selectWorkspaces = workspaceApi.endpoints.listWorkspaces.select();

export function useStartupWorkspaceDiffRefresh(enabled: boolean) {
  const store = useStore<RootState>();
  const transport = useSyncExternalStore(onTransportChange, getTransport);
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || transport.kind !== "ipc" || started.current) return;

    let retired = false;
    let timer: number | undefined;
    const retire = () => {
      retired = true;
      window.clearTimeout(timer);
    };
    const offTransport = onTransportChange(retire);
    const offReady = onAppReady(() => {
      timer = window.setTimeout(() => {
        if (retired) return;
        const state = store.getState();
        const workspaces = selectWorkspaces(state).data;
        if (!workspaces?.length) return;

        started.current = true;
        const ids = workspaces
          .filter((workspace) => !workspace.isArchived && !workspace.isReplica && workspace.rootPath)
          .map((workspace) => workspace.id);
        const selected = ids.findIndex((id) => id === state.workspace.activeWorkspaceId);
        if (selected > 0) ids.unshift(...ids.splice(selected, 1));

        async function refreshNext() {
          while (!retired) {
            const id = ids.shift();
            if (id === undefined) return;
            try {
              const result = await transport.invoke(CHANNELS.workspace.resyncDiff, [id]);
              if (!retired && result.success) {
                store.dispatch(workspaceApi.util.invalidateTags([{ type: "WorkspaceDiffs", id }]));
              }
            } catch {
              // An unavailable checkout or failed IPC must leave the other jobs runnable.
            }
          }
        }

        void refreshNext();
        void refreshNext();
      }, 0);
    });

    return () => {
      retire();
      offReady();
      offTransport();
    };
  }, [enabled, store, transport]);
}
