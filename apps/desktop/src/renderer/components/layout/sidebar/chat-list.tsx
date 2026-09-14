import { useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  Text,
  toast,
} from "@/components/ui";
import { Edit, Option, Plus, Trash } from "@/components/ui/icons";
import {
  useArchiveRunMutation,
  useDeleteRunMutation,
  useGetAccountQuery,
  useListCollectionsQuery,
  useMoveRunToCollectionMutation,
  useRemoveCollectionMutation,
  useUpdateRunMutation,
  useSetActiveSpaceMutation,
  useUpdateCollectionMutation,
  useUpdateSpaceMutation,
  type Collection,
  type RecentRun,
} from "@/lib/redux/api";
import {
  openNewRunTab,
  setPendingRunId,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "@/hooks/use-active-space";
import { resolveRunSpaceTarget } from "@/features/workspace/lib/background-runs";
import { getProviderVariantById } from "@/lib/provider-variants";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { SidebarGroupSection } from "./sidebar-group-section";
import { ChatItem, chatLabel } from "./chat-item";
import { ProjectIcon } from "./project-icon";
import { useRecentChats } from "./use-recent-chats";
import { CollectionSourcesModal } from "./collection-sources-modal";
import CollectionModal from "./collection-modal";
import DeleteConfirmationModal from "./delete-confirmation-modal";

/** How many rows the flat Recents section shows. */
const RECENTS_LIMIT = 20;

interface SidebarChatListProps {
  searchQuery: string;
  onNewChatInCollection: (collectionId: string) => void;
  onCreateCollection: () => void;
}

/**
 * The chat shell's sidebar list (work/chat modes): Projects — collapsible,
 * chats inside — over a flat Recents section, ChatGPT-style. Chats are runs
 * of the active account/provider/mode. Collection membership groups them;
 * standalone runs remain available in Recents.
 */
export function SidebarChatList({
  searchQuery,
  onNewChatInCollection,
  onCreateCollection,
}: SidebarChatListProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { spaces, activeSpaceId } = useActiveSpace();
  const { data: account } = useGetAccountQuery();
  const [setActiveSpace] = useSetActiveSpaceMutation();
  const [updateSpace] = useUpdateSpaceMutation();
  const [archiveRun] = useArchiveRunMutation();
  const [deleteRun] = useDeleteRunMutation();
  const [moveRunToCollection] = useMoveRunToCollectionMutation();
  const [updateRun] = useUpdateRunMutation();
  const [updateCollection] = useUpdateCollectionMutation();
  const [removeCollection] = useRemoveCollectionMutation();
  const [sourcesCollection, setSourcesCollection] =
    useState<Collection | null>(null);
  // One row's ⋯ menu at a time, plus the two dialogs it can open. Anchored to
  // the button it was opened from, like the chat row's own menu.
  const [menuCollection, setMenuCollection] = useState<Collection | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [editCollection, setEditCollection] = useState<Collection | null>(null);
  const [isSavingCollection, setIsSavingCollection] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);
  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  // Archiving is reversible and fires straight from the menu; deleting is not,
  // so it parks the run here until the confirmation comes back.
  const [deleteRunTarget, setDeleteRunTarget] = useState<RecentRun | null>(null);
  const [isDeletingRun, setIsDeletingRun] = useState(false);

  const activeTab = useAppSelector((state) => state.workspace.activeTab);
  const { data: recentRuns, isLoading } = useRecentChats();
  const { data: collections } = useListCollectionsQuery(
    { accountId: account?.id ?? "" },
    { skip: !account },
  );

  const query = searchQuery.trim().toLowerCase();
  const runs = useMemo(() => {
    const all = recentRuns ?? [];
    if (!query) return all;
    return all.filter((run) => chatLabel(run).toLowerCase().includes(query));
  }, [recentRuns, query]);

  // Project chats already render inside their collection group. Recents is the
  // flat home for standalone chats only, so a run never appears in both places.
  const standaloneRuns = useMemo(
    () => runs.filter((run) => run.collectionId === null),
    [runs],
  );

  const runsByCollection = useMemo(() => {
    const map = new Map<string, RecentRun[]>();
    for (const run of runs) {
      if (!run.collectionId) continue;
      const bucket = map.get(run.collectionId);
      if (bucket) bucket.push(run);
      else map.set(run.collectionId, [run]);
    }
    return map;
  }, [runs]);

  const collectionRows = useMemo(() => {
    const rows = (collections ?? []).filter((collection) => !collection.isArchived);
    // While searching, only Collections with matching chats (or a matching name)
    // stay visible.
    const filtered = query
      ? rows.filter(
          (collection) =>
            collection.name.toLowerCase().includes(query) ||
            (runsByCollection.get(collection.id)?.length ?? 0) > 0,
        )
      : rows;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [collections, query, runsByCollection]);

  const handleSelectChat = async (run: RecentRun) => {
    dispatch(setSelectedCollectionId(run.collectionId));

    // The page shows one provider and one mode at a time — a chat from another
    // space needs that switch first, same flow as the background dock.
    const target = resolveRunSpaceTarget(run, spaces, activeSpaceId || null);
    if (!target) {
      toast.error("No space is set up for this chat's agent");
      return;
    }
    const needsSpaceSwitch = target.spaceId !== activeSpaceId;
    if (needsSpaceSwitch || target.modeSwitch) {
      try {
        navigate("/", { replace: true });
        if (target.modeSwitch) {
          await updateSpace({
            id: target.spaceId,
            payload: { mode: target.modeSwitch },
          }).unwrap();
        }
        if (needsSpaceSwitch) await setActiveSpace(target.spaceId).unwrap();
      } catch (error) {
        console.error("Failed to switch space for chat:", error);
        toast.error("Failed to switch space");
        return;
      }
    }

    // Set the one-shot request only after the target space is known and any
    // switch succeeded; a failed jump must not open this run later by surprise.
    dispatch(setPendingRunId(run.id));
    const targetPath = `${WORKSPACE_BASE_PATH}/runs/${run.id}`;
    if (!needsSpaceSwitch && location.pathname === targetPath) {
      return;
    }
    navigate(targetPath);
  };

  /** The open tab cannot survive its run leaving the list — send it home. */
  const leaveIfActive = (runId: string) => {
    if (activeTab !== runId) return;
    navigate(WORKSPACE_BASE_PATH);
    dispatch(openNewRunTab());
  };

  const handleArchive = async (run: RecentRun) => {
    try {
      await archiveRun(run.id).unwrap();
      leaveIfActive(run.id);
    } catch (error) {
      console.error("Failed to archive chat:", error);
      toast.error("Failed to archive chat");
    }
  };

  const handleDeleteRun = async () => {
    if (!deleteRunTarget) return;
    setIsDeletingRun(true);
    try {
      await deleteRun(deleteRunTarget.id).unwrap();
      leaveIfActive(deleteRunTarget.id);
      setDeleteRunTarget(null);
    } catch (error) {
      console.error("Failed to delete chat:", error);
      toast.error("Failed to delete chat");
    } finally {
      setIsDeletingRun(false);
    }
  };

  const handleMove = async (
    run: RecentRun,
    collectionId: string | null,
  ) => {
    if (!account) return;
    try {
      await moveRunToCollection({
        runId: run.id,
        accountId: account.id,
        collectionId,
      }).unwrap();
      if (activeTab === run.id) {
        dispatch(setSelectedCollectionId(collectionId));
      }
    } catch (error) {
      console.error("Failed to move chat:", error);
      toast.error("Failed to move chat");
    }
  };

  const openCollectionMenu = (
    collection: Collection,
    event: ReactMouseEvent<HTMLElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.right, y: rect.bottom + 4 });
    setMenuCollection(collection);
  };

  const handleSaveCollection = async (draft: {
    name: string;
    icon: string | null;
  }) => {
    if (!editCollection || !account) return;
    setIsSavingCollection(true);
    try {
      await updateCollection({
        id: editCollection.id,
        accountId: account.id,
        payload: { name: draft.name, icon: draft.icon },
      }).unwrap();
      setEditCollection(null);
    } catch (error) {
      console.error("Failed to update collection:", error);
      toast.error("Failed to save project");
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!deleteTarget || !account) return;
    setIsDeletingCollection(true);
    try {
      await removeCollection({
        id: deleteTarget.id,
        accountId: account.id,
      }).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete collection:", error);
      toast.error("Failed to delete project");
    } finally {
      setIsDeletingCollection(false);
    }
  };

  const handleRename = async (run: RecentRun, title: string) => {
    try {
      await updateRun({ id: run.id, payload: { title } }).unwrap();
    } catch (error) {
      console.error("Failed to rename chat:", error);
      toast.error("Failed to rename chat");
    }
  };

  const renderChat = (run: RecentRun, isRecent = false) => (
    <ChatItem
      key={run.id}
      run={run}
      variant={getProviderVariantById(run.providerId)?.variant ?? "null"}
      isActive={activeTab === run.id}
      isRecent={isRecent}
      onSelect={() => void handleSelectChat(run)}
      onArchive={() => void handleArchive(run)}
      onDelete={() => setDeleteRunTarget(run)}
      onRename={(title) => void handleRename(run, title)}
      collections={collections ?? []}
      onMove={(collectionId) => void handleMove(run, collectionId)}
    />
  );

  if (isLoading) {
    return (
      <div className="py-4 text-center">
        <Text as="span" size="xs" tone="muted">
          Loading…
        </Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-2">
      {(collectionRows.length > 0 || !query) && (
        <div>
          <div className="flex items-center px-2 py-2">
            <Text as="span" size="xs" tone="secondary" weight="medium">
              Projects
            </Text>
            <Button
              tooltip="Create project"
              aria-label="Create project"
              onClick={onCreateCollection}
              className="ml-auto -mr-1 p-1 rounded-md hover:bg-primary-100/80 dark:hover:bg-primary/10 transition-colors"
            >
              <Plus className="size-3  text-primary-800 dark:text-primary-200 " />
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            {collectionRows.map((collection: Collection) => {
              const collectionRuns = runsByCollection.get(collection.id) ?? [];
              return (
                <SidebarGroupSection
                  key={collection.id}
                  groupKey={`collection-${collection.id}`}
                  label={collection.name}
                  icon={(expanded) => (
                    <ProjectIcon
                      icon={collection.icon}
                      projectName={collection.name}
                      expanded={expanded}
                    />
                  )}
                  count={collectionRuns.length}
                  action={{
                    label: "New chat in project",
                    onClick: () => onNewChatInCollection(collection.id),
                  }}
                  secondaryAction={{
                    label: "Project options",
                    onClick: (event) => openCollectionMenu(collection, event),
                    icon: (
                      <Option className="size-3 text-primary-800 dark:text-primary-200" />
                    ),
                  }}
                >
                  <div className="flex flex-col space-y-0.5">
                    {collectionRuns.length > 0 ? (
                      collectionRuns.map((run) => renderChat(run))
                    ) : (
                      <div className="px-2 py-1">
                        <Text as="span" size="xxs" tone="muted">
                          No chats
                        </Text>
                      </div>
                    )}
                  </div>
                </SidebarGroupSection>
              );
            })}
          </div>
        </div>
      )}
      {standaloneRuns.length > 0 && (
        <SidebarGroupSection
          groupKey="recents"
          label="Recents"
          // What the section actually lists: the tail past RECENTS_LIMIT is not
          // reachable from here, so counting it would promise rows that never
          // arrive.
          count={Math.min(standaloneRuns.length, RECENTS_LIMIT)}
        >
          <div className="flex flex-col space-y-0.5">
            {standaloneRuns
              .slice(0, RECENTS_LIMIT)
              .map((run) => renderChat(run, true))}
          </div>
        </SidebarGroupSection>
      )}
      {runs.length === 0 && (
        <div className="py-3 text-center">
          <Text as="span" size="xs" tone="muted">
            No chats yet
          </Text>
        </div>
      )}
      <DropdownMenu
        isOpen={!!menuCollection}
        aria-label="Project actions"
        position={menuPosition}
        origin="top-left"
        onClose={() => setMenuCollection(null)}
      >
        <DropdownMenuItem
          onClick={() => {
            setEditCollection(menuCollection);
            setMenuCollection(null);
          }}
        >
          <Edit className="size-3.5" />
          <span>Edit</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="danger"
          onClick={() => {
            setDeleteTarget(menuCollection);
            setMenuCollection(null);
          }}
        >
          <Trash className="size-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenu>
      <CollectionModal
        isOpen={!!editCollection}
        collection={editCollection}
        isSaving={isSavingCollection}
        onSave={handleSaveCollection}
        onClose={() => setEditCollection(null)}
      />
      <DeleteConfirmationModal
        isOpen={!!deleteTarget}
        isDeleting={isDeletingCollection}
        title={`Delete ${deleteTarget?.name ?? "project"}?`}
        // Says what actually happens: the module detaches runs and removes only
        // the project's own sources, so nobody has to guess whether deleting a
        // project takes its chats with it.
        description="The chats inside move back to Recents and stay. Files added to this project are deleted."
        onConfirm={() => void handleDeleteCollection()}
        onCancel={() => setDeleteTarget(null)}
      />
      <DeleteConfirmationModal
        isOpen={!!deleteRunTarget}
        isDeleting={isDeletingRun}
        title={`Delete ${deleteRunTarget ? chatLabel(deleteRunTarget) : "chat"}?`}
        // Names the reversible neighbour, so the choice between the two menu
        // entries is clear at the moment it matters.
        description="This chat and its messages are permanently deleted. Archive instead to keep it recoverable from Settings → Archive."
        onConfirm={() => void handleDeleteRun()}
        onCancel={() => setDeleteRunTarget(null)}
      />
      <CollectionSourcesModal
        key={sourcesCollection?.id ?? "closed"}
        accountId={account?.id ?? ""}
        collection={sourcesCollection}
        onClose={() => setSourcesCollection(null)}
      />
    </div>
  );
}
