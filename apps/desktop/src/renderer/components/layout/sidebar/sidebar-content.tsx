import type { CSSProperties, MouseEvent } from "react";
import WorkspacesList from "./workspace-list";
import { SidebarChatList } from "./chat-list";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import type {
  Workspace as WorkspaceResponse,
  WorkspaceGitState,
} from "@/lib/redux/api/workspaceApi";

const EMPTY_WORKSPACES: WorkspaceResponse[] = [];

interface SidebarContentProps {
  workspaces: WorkspaceResponse[];
  gitStateByWorkspaceId: ReadonlyMap<string, WorkspaceGitState>;
  isLoadingWorkspaces: boolean;
  onDeleteWorkspace?: (workspaceId: string, e: MouseEvent) => void;
  onArchiveWorkspace?: (workspaceId: string) => void;
  /** The chat list filters itself; the workspace list arrives pre-filtered. */
  searchQuery: string;
  onNewChatInCollection: (collectionId: string) => void;
  onCreateCollection: () => void;
}

export function SidebarContent({
  workspaces = EMPTY_WORKSPACES,
  gitStateByWorkspaceId,
  isLoadingWorkspaces = false,
  onDeleteWorkspace,
  onArchiveWorkspace,
  searchQuery,
  onNewChatInCollection,
  onCreateCollection,
}: SidebarContentProps) {
  // The one list-swap point: developer lists workspaces, the chat shell
  // (work/chat modes) lists chats grouped by project.
  const { itemType } = useSidebarConfig();

  return (
    <div
      className="flex-1 overflow-y-auto noscrollbar px-3"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <div style={{ animation: "slide-fade-down 200ms cubic-bezier(0.23, 1, 0.32, 1)" }}>
        {itemType === "chat" ? (
          <SidebarChatList
            searchQuery={searchQuery}
            onNewChatInCollection={onNewChatInCollection}
            onCreateCollection={onCreateCollection}
          />
        ) : (
          <WorkspacesList
            workspaces={workspaces}
            gitStateByWorkspaceId={gitStateByWorkspaceId}
            isLoading={isLoadingWorkspaces}
            onDeleteWorkspace={onDeleteWorkspace}
            onArchiveWorkspace={onArchiveWorkspace}
          />
        )}
      </div>
    </div>
  );
}
