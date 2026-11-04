import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Text } from "@/components/ui";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { useListProjectsQuery, type RecentRun, type Workspace, type WorkspaceGitState } from "@/lib/redux/api";
import { normalizeWorkspaceListSources, setWorkspaceListSourceVisible } from "@/lib/redux/slices/appSettingsSlice";
import { activateWorkspaceView, openNewRunTab } from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useChatActions } from "@/features/workspace/hooks/use-chat-actions";
import { useJumpToRun } from "@/features/workspace/hooks/use-jump-to-run";
import { workspaceViewKey } from "@/features/workspace/lib/ui-context";
import { getProviderVariantById } from "@/lib/provider-variants";
import {
  SIDEBAR_LIST_CLASS,
  SIDEBAR_LIST_HEADER_CLASS,
  SIDEBAR_PROJECT_GROUPS_CLASS,
  SIDEBAR_PROJECT_ITEMS_CLASS,
  SIDEBAR_PROJECT_CHILD_ROW_CLASS,
} from "@/lib/sidebar-layout";
import { useBridgeStatus } from "@/features/bridge/hooks/use-bridge";
import { bridgeBackend } from "@/features/bridge/lib/backends";
import { useRecentChats } from "./use-recent-chats";
import { groupDeveloperChats } from "./developer-chat-groups";
import { ChatItem, chatLabel } from "./chat-item";
import { ProjectIcon } from "./project-icon";
import { SidebarGroupSection } from "./sidebar-group-section";
import { WorkspaceGroupDropdown } from "./workspace-group-dropdown";
import PendingWorkspaceItem from "./pending-workspace-item";
import type { PendingWorkspaceClone } from "@/hooks/use-sidebar-actions";
import DeleteConfirmationModal from "./delete-confirmation-modal";

const PAGE_SIZE = 50;
const PROJECT_ROWS = 5;

export function DeveloperChatList({ workspaces, gitStateByWorkspaceId, searchQuery, pendingClones, isLoadingWorkspaces = false,
  onCancelClone, onRetryClone, onDismissClone }: {
  workspaces: Workspace[];
  isLoadingWorkspaces?: boolean;
  gitStateByWorkspaceId: ReadonlyMap<string, WorkspaceGitState>;
  searchQuery: string;
  pendingClones: PendingWorkspaceClone[];
  onCancelClone: (id: string) => void;
  onRetryClone: (id: string) => void;
  onDismissClone: (id: string) => void;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const jumpToRun = useJumpToRun();
  const { activeSpace, activeSpaceId } = useActiveSpace();
  const { data: projects = [], isLoading: isLoadingProjects, error: projectsError, refetch: refetchProjects } = useListProjectsQuery();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [shownByProject, setShownByProject] = useState<Record<string, number>>({});
  const { data: chats, isLoading, isFetching, error, refetch } = useRecentChats({ limit });
  const { data: bridgeStatus } = useBridgeStatus();
  const { renameChat, archiveChat, deleteChat } = useChatActions();
  const [deleteTarget, setDeleteTarget] = useState<RecentRun | null>(null);
  const [deleting, setDeleting] = useState(false);
  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const activeWorkspaceId = useAppSelector((state) => state.workspace.activeWorkspaceId);
  const backendId = useAppSelector((state) => state.backends.activeBackendId);
  const sources = normalizeWorkspaceListSources(useAppSelector((state) => state.appSettings.workspaceListSources));
  const placement = useMemo(() => groupDeveloperChats(chats ?? [], projects, workspaces,
    gitStateByWorkspaceId, sources, searchQuery), [chats, projects, workspaces, gitStateByWorkspaceId, sources, searchQuery]);
  const workspaceMap = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);
  const loading = isLoading || isLoadingProjects || isLoadingWorkspaces;

  const newChat = (workspace: Workspace) => {
    if (!activeSpace) return;
    dispatch(activateWorkspaceView({ key: workspaceViewKey({ backendId, spaceId: activeSpaceId,
      providerId: activeSpace.providerId, mode: "developer", workspaceId: workspace.id }),
      workspaceId: workspace.id, providerId: activeSpace.providerId }));
    dispatch(openNewRunTab());
    navigate(`/code/${workspace.id}`);
  };
  const renderChat = (run: RecentRun, inProject = false) => {
    const workspace = run.workspaceId ? workspaceMap.get(run.workspaceId) : undefined;
    const branch = workspace?.isReplica ? workspace.metadata?.lastBranch ?? null
      : gitStateByWorkspaceId.get(run.workspaceId ?? "")?.branch ?? null;
    return <ChatItem key={run.id} run={run} inProject={inProject} variant={getProviderVariantById(run.providerId)?.variant ?? "null"}
      workspaceContext={workspace ? { branch,
        isWorktree: workspace.metadata?.worktree?.enabled === true } : undefined}
      device={run.isReplica ? bridgeBackend(bridgeStatus, run.ownerBackendId) : undefined}
      isActive={location.pathname.startsWith("/code") && activeTab === run.id}
      onSelect={() => void jumpToRun(run)} onRename={(title) => void renameChat(run, title)}
      onArchive={() => void archiveChat(run)} onDelete={() => setDeleteTarget(run)}
      collections={[]} onMove={() => {}} />;
  };

  return <div className={SIDEBAR_LIST_CLASS}>
    <div className={SIDEBAR_LIST_HEADER_CLASS}>
      <Text as="span" size="s" tone="muted" weight="medium">Projects</Text>
      <div className="-mr-1"><WorkspaceGroupDropdown grouping="project" onGroupingChange={() => {}}
        sources={sources} onSourceVisibleChange={(source, visible) => dispatch(setWorkspaceListSourceVisible({ source, visible }))} /></div>
    </div>
    {sources.local && pendingClones.map((clone) => <PendingWorkspaceItem key={clone.id} clone={clone}
      onCancel={() => onCancelClone(clone.id)} onRetry={() => onRetryClone(clone.id)} onDismiss={() => onDismissClone(clone.id)} />)}
    {!!(error || projectsError) && <div role="alert" className="px-2 text-xs text-primary-500">
      Could not load chats. <Button onClick={() => { void refetch(); void refetchProjects(); }} className="underline">Retry</Button>
    </div>}
    {loading && <Text size="xs" tone="subtle" className="px-2 py-3">Loading chats…</Text>}
    {!loading && <>
    <div className={SIDEBAR_PROJECT_GROUPS_CLASS}>{placement.groups.map(({ project, workspaces: groupWorkspaces, chats: projectChats }) => {
      const own = groupWorkspaces.filter((workspace) => !workspace.isReplica && !workspace.isArchived);
      const target = own.find((workspace) => workspace.id === activeWorkspaceId)
        ?? own.find((workspace) => !workspace.metadata?.worktree?.enabled) ?? own[0];
      const shown = searchQuery.trim() ? projectChats.length : shownByProject[project.id] ?? PROJECT_ROWS;
      return <SidebarGroupSection key={project.id} groupKey={`code-chats-project-${project.id}`} label={project.name}
        labelWeight="medium"
        count={projectChats.length} icon={(expanded) => <ProjectIcon projectName={project.name} icon={project.icon} expanded={expanded} />}
        action={target ? { label: `New chat in ${project.name}`, onClick: () => newChat(target) } : undefined}>
        <div className={SIDEBAR_PROJECT_ITEMS_CLASS}>
          {projectChats.slice(0, shown).map((run) => renderChat(run, true))}
          {!projectChats.length && <div className={`flex items-center ${SIDEBAR_PROJECT_CHILD_ROW_CLASS}`}><Text as="span" size="xxs" tone="muted">No chats yet</Text></div>}
          {projectChats.length > shown && <Button onClick={() => setShownByProject((previous) => ({ ...previous,
            [project.id]: shown + PROJECT_ROWS }))} className={`${SIDEBAR_PROJECT_CHILD_ROW_CLASS} block w-full text-left text-xs text-primary-500`}>Show more</Button>}
        </div>
      </SidebarGroupSection>;
    })}</div>
    {placement.recents.length > 0 && <SidebarGroupSection groupKey="code-chats-recents" label="Recents" count={placement.recents.length}>
      <div className={`${SIDEBAR_PROJECT_ITEMS_CLASS} mt-2`}>{placement.recents.map((run) => renderChat(run))}</div>
    </SidebarGroupSection>}
    {!error && !projectsError && !placement.groups.length && !placement.recents.length &&
      <Text size="xs" tone="subtle" className="px-2 py-3">{searchQuery.trim() ? "No matching chats" : "No projects yet"}</Text>}
    </>}
    {chats && chats.length >= limit && <Button disabled={isFetching} onClick={() => setLimit((value) => value + PAGE_SIZE)}
      className="px-2 py-1 text-left text-xs text-primary-500">{isFetching ? "Loading…" : "Load older chats"}</Button>}
    <DeleteConfirmationModal isOpen={!!deleteTarget} isDeleting={deleting}
      title={`Delete ${deleteTarget ? chatLabel(deleteTarget) : "chat"}?`}
      description="This permanently deletes the chat and its messages. Archive keeps it recoverable."
      onCancel={() => setDeleteTarget(null)} onConfirm={() => {
        if (!deleteTarget) return;
        setDeleting(true);
        void deleteChat(deleteTarget).then(() => setDeleteTarget(null)).catch(() => {}).finally(() => setDeleting(false));
      }} />
  </div>;
}
