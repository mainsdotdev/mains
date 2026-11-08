import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/ui";
import { createWorkspaceIntakeController } from "@/lib/workspace-intake-controller";
import { getTransport, onTransportChange } from "@/lib/transport";
import { useCreateWorkspaceFromSourceMutation, useCancelWorkspaceCloneMutation, useSelectWorkspaceDirectoryMutation, useListWorkspacesQuery } from "@/lib/redux/api";
export type { PendingWorkspaceClone } from "@/lib/workspace-intake-controller";

/** React binds the intake owner to the current account/backend and subscribes. */
export function useWorkspaceIntake(accountId: string, backendId: string, openWorkspace: (id: string) => void) {
  const [create] = useCreateWorkspaceFromSourceMutation();
  const [cancel] = useCancelWorkspaceCloneMutation();
  const [selectDirectory] = useSelectWorkspaceDirectoryMutation();
  const { data: workspaces } = useListWorkspacesQuery();
  const [owner] = useState(() => createWorkspaceIntakeController({
    create: (payload) => create(payload).unwrap(),
    cancel: (payload) => cancel(payload).unwrap(),
    selectDirectory: () => selectDirectory().unwrap(),
    openWorkspace,
    succeeded: (message, open) => { toast.success(message, { action: { label: "Open", onClick: open } }); },
    failed: (message) => { toast.error(message); },
  }));
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useLayoutEffect(() => {
    const bind = () => owner.activate(accountId, backendId, getTransport());
    bind(); const off = onTransportChange(bind);
    return () => { off(); owner.retire(); };
  }, [owner, accountId, backendId]);
  const view = snapshot.view;
  useLayoutEffect(() => {
    if (view) owner.acknowledge(view, (workspaces ?? []).map((workspace) => workspace.id));
  }, [owner, snapshot, view, workspaces]);
  return {
    pendingClones: snapshot.rows.filter((row) => row.accountId === accountId && row.backendId === backendId),
    isAddingLocal: !!view && snapshot.folder === view,
    isCreatingProject: !!view && snapshot.init === view,
    clone: (url: string, targetPath: string) => { if (view) owner.clone(view, url, targetPath); },
    cancelClone: (id: string) => view ? owner.cancelClone(view, id) : Promise.resolve(),
    retry: (id: string) => { if (view) owner.retry(view, id); },
    dismiss: (id: string) => { if (view) owner.dismiss(view, id); },
    addFolder: () => view ? owner.addFolder(view) : Promise.resolve(null),
    init: (name: string, parentPath?: string) => view ? owner.init(view, name, parentPath) : Promise.resolve(null),
  };
}
