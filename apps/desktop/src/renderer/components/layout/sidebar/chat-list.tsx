import {
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  Button,
  DropdownMenu,
  DropdownMenuItem,
  SortableItem,
  SortableList,
  Text,
  toast,
} from "@/components/ui";
import { Edit, Option, Plus, Trash } from "@/components/ui/icons";
import {
  useGetAccountQuery,
  useListCollectionsQuery,
  useRemoveCollectionMutation,
  useReorderCollectionsMutation,
  useSetActiveSpaceMutation,
  useUpdateCollectionMutation,
  useUpdateSpaceMutation,
  type Collection,
  type RecentRun,
} from "@/lib/redux/api";
import {
  setPendingRunId,
  setSelectedCollectionId,
} from "@/lib/redux/slices/workspaceSlice";
import { useActiveSpace } from "@/hooks/use-active-space";
import { resolveRunSpaceTarget } from "@/features/workspace/lib/background-runs";
import { getProviderVariantById } from "@/lib/provider-variants";
import { WORKSPACE_BASE_PATH } from "@/lib/route-utils";
import { iconColorClass, splitStoredIcon } from "@/lib/icon-registry";
import { useChatActions } from "@/features/workspace/hooks/use-chat-actions";
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
  const { renameChat, toggleChatPin, moveChat, archiveChat, deleteChat } =
    useChatActions();
  const [updateCollection] = useUpdateCollectionMutation();
  const [removeCollection] = useRemoveCollectionMutation();
  const [reorderCollections, { isLoading: isReorderingCollections }] =
    useReorderCollectionsMutation();
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

  // A pinned chat is lifted out of wherever it would otherwise sit — Recents or
  // its project — and rendered once, at the top. Same rule as below: a run
  // never appears in two places. Its `collectionId` is untouched, so unpinning
  // drops it straight back into its project.
  const pinnedRuns = useMemo(
    () => runs.filter((run) => run.pinnedAt !== null),
    [runs],
  );

  // Project chats already render inside their collection group. Recents is the
  // flat home for standalone chats only, so a run never appears in both places.
  const standaloneRuns = useMemo(
    () => runs.filter((run) => run.collectionId === null && !run.pinnedAt),
    [runs],
  );

  const runsByCollection = useMemo(() => {
    const map = new Map<string, RecentRun[]>();
    for (const run of runs) {
      if (!run.collectionId || run.pinnedAt) continue;
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
    return filtered;
  }, [collections, query, runsByCollection]);
  const collectionIds = useMemo(
    () => collectionRows.map((collection) => collection.id),
    [collectionRows],
  );

  const canReorderCollections =
    !query && collectionRows.length > 1 && !isReorderingCollections;

  // Empty states. Waits for the collections query, so "No projects yet" never
  // flashes before the list arrives. Recents stays up with a note when there
  // are no chats at all; a search that matches nothing says so instead of
  // leaving the sidebar blank.
  const hasNoProjects = !!collections && collectionRows.length === 0;
  const hasNoChats = !query && runs.length === 0;
  const hasNoMatches =
    !!query &&
    pinnedRuns.length === 0 &&
    collectionRows.length === 0 &&
    standaloneRuns.length === 0;

  const persistCollectionOrder = (orderedIds: string[]) => {
    if (!account) return;
    void reorderCollections({ accountId: account.id, orderedIds })
      .unwrap()
      .catch((error) => {
        console.error("Failed to reorder projects:", error);
        toast.error("Failed to reorder projects");
      });
  };

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

  const handleDeleteRun = async () => {
    if (!deleteRunTarget) return;
    setIsDeletingRun(true);
    try {
      await deleteChat(deleteRunTarget);
      setDeleteRunTarget(null);
    } catch {
      // Reported by the hook; the dialog stays up so the click can be retried.
    } finally {
      setIsDeletingRun(false);
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

  const renderChat = (run: RecentRun, isRecent = false) => (
    <ChatItem
      key={run.id}
      run={run}
      variant={getProviderVariantById(run.providerId)?.variant ?? "null"}
      isActive={activeTab === run.id}
      isRecent={isRecent}
      onSelect={() => void handleSelectChat(run)}
      onArchive={() => void archiveChat(run)}
      onDelete={() => setDeleteRunTarget(run)}
      onRename={(title) => void renameChat(run, title)}
      collections={collections ?? []}
      onMove={(collectionId) => void moveChat(run, collectionId)}
      isPinned={run.pinnedAt !== null}
      onTogglePin={() => void toggleChatPin(run)}
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
    <div className="flex flex-col gap-2 pb-2 pt-2">
      {/* No empty state: an unused Pinned header would be a permanent row
          explaining a feature nobody asked for. */}
      {pinnedRuns.length > 0 && (
        <SidebarGroupSection
          groupKey="pinned"
          label="Pinned"
          // Quieter than a project title: this header names a shelf, not
          // something the user made and gave a colour to.
          labelTint="text-primary-800 dark:text-primary-200"
          count={pinnedRuns.length}
        >
          <div className="flex flex-col space-y-0.5 mt">
            {/* Flush rows, like Recents: a pinned chat is shown outside its
                project, so there is no gutter to indent under. */}
            {pinnedRuns.map((run) => renderChat(run, true))}
          </div>
        </SidebarGroupSection>
      )}
      {(collectionRows.length > 0 || !query) && (
        <div>
          <div className="flex items-center px-2 py-2">
            <Text as="span" size="s" tone="muted" weight="medium">
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
          <SortableList
            ids={collectionIds}
            onReorder={persistCollectionOrder}
            disabled={!canReorderCollections}
            className="flex flex-col gap-1"
          >
            {collectionRows.map((collection: Collection) => {
              const collectionRuns = runsByCollection.get(collection.id) ?? [];
              return (
                <SortableItem key={collection.id} id={collection.id}>
                  {(sortHandle) => (
                    <SidebarGroupSection
                      groupKey={`collection-${collection.id}`}
                      label={collection.name}
                      // The title wears the icon's tint: an emoji or an
                      // untinted icon resolves to "", which leaves the neutral
                      // tone.
                      labelTint={iconColorClass(
                        splitStoredIcon(collection.icon).color,
                      )}
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
                        onClick: (event) =>
                          openCollectionMenu(collection, event),
                        icon: (
                          <Option className="size-3 text-primary-800 dark:text-primary-200" />
                        ),
                      }}
                      sortHandle={sortHandle}
                    >
                      <div className="flex flex-col space-y-0.5">
                        {collectionRuns.length > 0 ? (
                          collectionRuns.map((run) => renderChat(run))
                        ) : (
                          // Same gutter a chat row inside a project takes, so
                          // the placeholder sits where the missing chats would.
                          <div className="pl-7 pr-2.5 py-1">
                            <Text as="span" size="xxs" tone="muted">
                              No chats
                            </Text>
                          </div>
                        )}
                      </div>
                    </SidebarGroupSection>
                  )}
                </SortableItem>
              );
            })}
          </SortableList>
          {hasNoProjects && <EmptyListNote>No projects yet</EmptyListNote>}
        </div>
      )}
      {(standaloneRuns.length > 0 || hasNoChats) && (
        <SidebarGroupSection
          groupKey="recents"
          label="Recents"
          // What the section actually lists: the tail past RECENTS_LIMIT is not
          // reachable from here, so counting it would promise rows that never
          // arrive.
          count={Math.min(standaloneRuns.length, RECENTS_LIMIT)}
        >
          {hasNoChats ? (
            <EmptyListNote>No chats yet</EmptyListNote>
          ) : (
            <div className="flex flex-col space-y-0.5">
              {standaloneRuns
                .slice(0, RECENTS_LIMIT)
                .map((run) => renderChat(run, true))}
            </div>
          )}
        </SidebarGroupSection>
      )}
      {hasNoMatches && <EmptyListNote>No matching chats</EmptyListNote>}

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

/** The empty-list line the workspace list shows, so both sidebars read alike. */
function EmptyListNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-center h-16">
      <Text size="xs">{children}</Text>
    </div>
  );
}
