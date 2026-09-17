import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SidebarHeader } from "./sidebar-header";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarContent } from "./sidebar-content";
import DeleteConfirmationModal from "./delete-confirmation-modal";
import NewButton from "./new-button";
import SettingsView from "./settings-view";
import HelpMenu from "./help-menu";
import { useCapabilities, useIsMobile } from "@/lib/platform";
import {
  Plus,
  Connect,
  Project,
  Relay,
  Plugin,
  Box,
  New,
} from "@/components/ui/icons";
import CloneRepoModal from "./clone-repo-modal";
import CreateProjectModal from "./create-project-modal";
import CollectionModal from "./collection-modal";
import { useDeleteWorkspace } from "@/features/workspace/hooks";
import { useArchiveWorkspace } from "@/features/workspace/hooks";
import { useSidebarSearch } from "@/hooks/use-sidebar-search";
import { useSettingsNavigation } from "@/hooks/use-settings-navigation";
import { useSidebarData } from "@/hooks/use-sidebar-data";
import { useSidebarActions } from "@/hooks/use-sidebar-actions";
import { useSidebarConfig } from "@/hooks/use-sidebar-config";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useSpaceProviderVariant } from "@/hooks/use-space-provider-variant";
import { useScriptNotifications } from "@/hooks/use-script-notifications";
import { useSidebarSpaceSwipe } from "@/hooks/use-sidebar-space-swipe";
import { useUpdateSpaceMutation } from "@/lib/redux/api";
import { UpdateBanner } from "./update-banner";
import { BackgroundRunsDock } from "@/features/workspace/components/background-runs";
import { Button, Text, Tooltip } from "@/components/ui";
import { ResizeHandle } from "@/components/layout/resize-handle";
import { useAppSelector, useAppDispatch } from "@/lib/redux/hooks";
import { setSidebarWidth } from "@/lib/redux/slices/appSettingsSlice";
import { setLayoutWidthVar } from "@/hooks/use-layout-width-vars";
import {
  LAYOUT_PANEL_ANIM_MS,
  SIDEBAR_WIDTH_VAR,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
} from "@/lib/layout";
import { Clock } from "@/components/ui/icons/space";
import type { ModeId } from "../../../../shared/modes";

interface SidebarProps {
  collapsed?: boolean;
}

export default function Sidebar({ collapsed }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const sidebarWidth = useAppSelector((s) => s.appSettings.sidebarWidth);
  const sidebarConfig = useSidebarConfig();
  const modeConfig = useModeConfig();
  const isChatShell = sidebarConfig.itemType === "chat";
  const { spaces, activeSpaceId, activeSpace } = useActiveSpace();
  const [updateSpace] = useUpdateSpaceMutation();
  const spaceProvider = useSpaceProviderVariant();

  const { searchQuery } = useSidebarSearch();

  const { isSettingsOpen, handleOpenSettings, handleCloseSettings } =
    useSettingsNavigation();

  // Global listeners
  useScriptNotifications();

  // Help menu state
  const [helpMenuState, setHelpMenuState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
  }>({ isOpen: false, position: { x: 0, y: 0 } });

  const handleOpenHelpMenu = (event: React.MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setHelpMenuState({
      isOpen: true,
      position: { x: rect.right + 40, y: rect.bottom - 12 },
    });
  };

  const handleCloseHelpMenu = () => {
    setHelpMenuState({ isOpen: false, position: { x: 0, y: 0 } });
  };

  const {
    workspaces,
    gitStateByWorkspaceId,
    isLoadingWorkspaces,
    handleRefreshConnections,
  } = useSidebarData({ searchQuery });
  // Picking a local folder uses a native dialog, which can't run from the web
  // client (it would open on the headless backend). Hide the folder-picker entry.
  const { nativeDialogs } = useCapabilities();
  const isMobile = useIsMobile();

  const {
    handleSpaceChange,
    handleNewClick,
    handleNewChat,
    handleAddProject,
    handleCloneRepo,
    handleOpenCloneModal,
    handleCloseCloneModal,
    isCloneModalOpen,
    isCloning,
    handleCreateProject,
    handleOpenCreateProjectModal,
    handleCloseCreateProjectModal,
    isCreateProjectModalOpen,
    isCreatingProject,
    handleCreateCollection,
    handleOpenCreateCollectionModal,
    handleCloseCreateCollectionModal,
    isCreateCollectionModalOpen,
    isCreatingCollection,
  } = useSidebarActions();

  const deleteWorkspace = useDeleteWorkspace();
  const archiveWorkspace = useArchiveWorkspace();

  const swipeRef = useSidebarSpaceSwipe({
    spaces,
    activeSpaceId,
    onSpaceChange: handleSpaceChange,
  });

  // The resize handle lives inside the <aside>, so it slides out with it. Drop
  // it only once the sidebar is fully off-screen — pulling it on the `collapsed`
  // flag alone would strip it (and its tab stop) on the first animation frame.
  const [isAnimating, setIsAnimating] = useState(false);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), LAYOUT_PANEL_ANIM_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  const showResizeHandle = !collapsed || isAnimating;

  // Suppress unused variable warning for handleRefreshConnections
  void handleRefreshConnections;

  const isPluginsRoute =
    location.pathname === "/plugins" ||
    location.pathname.startsWith("/plugins/");
  const isPulseRoute =
    location.pathname === "/pulse" || location.pathname.startsWith("/pulse/");
  const isTasksRoute =
    location.pathname === "/tasks" || location.pathname.startsWith("/tasks/");
  const isRelayRoute =
    location.pathname === "/relay" || location.pathname.startsWith("/relay/");
  const isPluginsDisabledForAgent = !spaceProvider.supportsPlugins;

  const handleModeChange = (mode: ModeId) => {
    if (!activeSpace || mode === activeSpace.mode) return;
    void updateSpace({ id: activeSpace.id, payload: { mode } });
  };

  return (
    <>
      <aside
        ref={swipeRef}
        className={`fixed top-0 bottom-0 left-0 z-(--z-sidebar) transition-[transform,opacity] duration-150 ease-out will-change-transform ${
          isMobile ? "bg-primary dark:bg-primary-950 shadow-2xl" : ""
        }`}
        style={{
          width: isMobile ? "100%" : "var(--sidebar-width)",
          transform: collapsed
            ? "translate3d(-100%,0,0)"
            : "translate3d(0,0,0)",
          opacity: collapsed ? 0 : 1,
        }}
        role="complementary"
        aria-label="Workspace sidebar"
      >
        {isSettingsOpen ? (
          <SettingsView onClose={handleCloseSettings} />
        ) : (
          <div className="h-full overflow-hidden flex flex-col">
            <SidebarHeader
              mode={activeSpace?.mode}
              providerId={activeSpace?.providerId}
              onModeChange={handleModeChange}
            />
            <div className="px-3 py-px">
              <NewButton
                onClick={isChatShell ? () => handleNewChat() : handleNewClick}
                icon={
                  isChatShell ? (
                    <New className="size-3.5 text-primary-900 dark:text-primary-100" />
                  ) : (
                    <Project className="size-3.5 text-primary-900 dark:text-primary-100" />
                  )
                }
                title={sidebarConfig.title}
                actionPrefix={sidebarConfig.actionPrefix}
                // An empty list turns the button into a direct action (\u2318N
                // included) \u2014 the chat shell's "New chat".
                dropdownItems={
                  isChatShell
                    ? []
                    : [
                        ...(nativeDialogs
                          ? [
                              {
                                label: "Add from local",
                                icon: (
                                  <Plus className="w-3.5 h-3.5 text-primary-800 dark:text-primary-200" />
                                ),
                                shortcut: "o",
                                shortcutLabel: "\u2318\u21e7O",
                                onClick: handleAddProject,
                              },
                            ]
                          : []),
                        {
                          label: "Clone from URL",
                          icon: (
                            <Connect className="w-3.5 h-3.5 text-primary-800 dark:text-primary-200" />
                          ),
                          shortcut: "u",
                          shortcutLabel: "\u2318\u21e7U",
                          onClick: handleOpenCloneModal,
                        },
                        {
                          label: "Create new project",
                          icon: (
                            <Project className="w-3.5 h-3.5 text-primary-800 dark:text-primary-200" />
                          ),
                          shortcut: "n",
                          shortcutLabel: "\u2318\u21e7N",
                          onClick: handleOpenCreateProjectModal,
                        },
                      ]
                }
              />
            </div>
            {modeConfig.showTasksNav && (
              <div className="px-3 mb-px">
                <Button
                  variant="subtle"
                  tooltip="Issues and pull requests"
                  className={`justify-start flex items-center gap-2 w-full rounded-xl transition-colors ${
                    isTasksRoute
                      ? "bg-primary/50 glass-outline dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10"
                      : ""
                  }`}
                  onClick={() => navigate("/tasks")}
                  aria-current={isTasksRoute ? "page" : undefined}
                >
                  <Box
                    className={`w-4 h-4 -ml-1 ${
                      isTasksRoute
                        ? "text-primary-950 dark:text-primary"
                        : "text-primary-900 dark:text-primary-100"
                    }`}
                  />
                  <Text
                    as="span"
                    size="s"
                    weight="normal"
                    tone={isTasksRoute ? "contrast" : "default"}
                  >
                    Tasks
                  </Text>
                </Button>
              </div>
            )}
            <div className="px-3 mb-px">
              <Button
                variant="subtle"
                tooltip="View your pulse"
                className={`justify-start flex items-center gap-2 w-full rounded-xl transition-colors ${
                  isPulseRoute
                    ? "bg-primary/50 glass-outline dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10"
                    : ""
                }`}
                onClick={() => navigate("/pulse")}
                aria-current={isPulseRoute ? "page" : undefined}
              >
                <Clock
                  className={`w-4 h-4 -ml-1 ${
                    isPulseRoute
                      ? "text-primary-950 dark:text-primary"
                      : "text-primary-900 dark:text-primary-100"
                  }`}
                />
                <Text
                  as="span"
                  size="s"
                  weight="normal"
                  tone={isPulseRoute ? "contrast" : "default"}
                >
                  Pulse
                </Text>
              </Button>
            </div>
            <div className="px-3 mb-px ">
              {isPluginsDisabledForAgent ? (
                <Tooltip
                  content="Not available for this agent yet."
                  position="top"
                >
                  <span className="block w-full">
                    <Button
                      variant="subtle"
                      tooltip={`${isPluginsDisabledForAgent ? "Not available for this agent yet." : "View plugins"}`}
                      disabled
                      className={`justify-start flex items-center gap-2 w-full rounded-xl transition-colors pointer-events-none opacity-50 ${
                        isPluginsRoute
                          ? "bg-primary/50 dark:bg-primary/5 glass-outline"
                          : ""
                      }`}
                      aria-current={isPluginsRoute ? "page" : undefined}
                    >
                      <Plugin
                        className={`w-4 h-4 -ml-1 -rotate-45 ${
                          isPluginsRoute
                            ? "text-primary-950 dark:text-primary"
                            : "text-primary-900 dark:text-primary-100"
                        }`}
                      />
                      <Text
                        as="span"
                        size="s"
                        weight="normal"
                        tone={isPluginsRoute ? "contrast" : "default"}
                        align="left"
                        className="flex-1"
                      >
                        Plugins
                      </Text>
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  variant="subtle"
                  tooltip="View plugins"
                  className={`justify-start flex items-center gap-2 w-full rounded-xl transition-colors ${
                    isPluginsRoute
                      ? " glass-outline bg-primary/50 dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10"
                      : ""
                  }`}
                  onClick={() => {
                    navigate("/plugins");
                  }}
                  aria-current={isPluginsRoute ? "page" : undefined}
                >
                  <Plugin
                    className={`w-4 h-4 -ml-1 shrink-0 -rotate-45 ${
                      isPluginsRoute
                        ? "text-primary-950 dark:text-primary"
                        : "text-primary-900 dark:text-primary-100"
                    }`}
                  />
                  <Text
                    as="span"
                    size="s"
                    weight="normal"
                    tone={isPluginsRoute ? "contrast" : "default"}
                    align="left"
                    className="flex-1"
                  >
                    Plugins
                  </Text>
                </Button>
              )}
            </div>

            <div className="px-3 mb-2">
              <Button
                variant="subtle"
                tooltip="Relay"
                className={`justify-start flex items-center gap-2 w-full rounded-xl transition-colors ${
                  isRelayRoute
                    ? " glass-outline bg-primary/50 dark:bg-primary/5 hover:bg-primary/90 dark:hover:bg-primary/10"
                    : ""
                }`}
                onClick={() => navigate("/relay")}
                aria-current={isRelayRoute ? "page" : undefined}
              >
                <Relay
                  className={`w-4 h-4 -ml-1 shrink-0 ${
                    isRelayRoute
                      ? "text-primary-950 dark:text-primary"
                      : "text-primary-900 dark:text-primary-100"
                  }`}
                />
                <Text
                  as="span"
                  size="s"
                  weight="normal"
                  tone={isRelayRoute ? "contrast" : "default"}
                  align="left"
                  className="flex-1"
                >
                  Relay
                </Text>

              </Button>
            </div>
            <SidebarContent
              workspaces={workspaces}
              gitStateByWorkspaceId={gitStateByWorkspaceId}
              isLoadingWorkspaces={isLoadingWorkspaces}
              onDeleteWorkspace={deleteWorkspace.handleDeleteClick}
              onArchiveWorkspace={archiveWorkspace.handleArchiveClick}
              searchQuery={searchQuery}
              onNewChatInCollection={handleNewChat}
              onCreateCollection={handleOpenCreateCollectionModal}
            />
            <BackgroundRunsDock />
            <UpdateBanner />
            <SidebarFooter
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              onSpaceChange={handleSpaceChange}
              onSettingsClick={handleOpenSettings}
              onHelpClick={handleOpenHelpMenu}
              helpMenuOpen={helpMenuState.isOpen}
            />
          </div>
        )}
        {showResizeHandle && (
          <ResizeHandle
            edge="right"
            value={sidebarWidth}
            min={SIDEBAR_WIDTH_MIN}
            max={SIDEBAR_WIDTH_MAX}
            computeWidth={(clientX) => clientX}
            onPreview={(w) => setLayoutWidthVar(SIDEBAR_WIDTH_VAR, w)}
            onCommit={(w) => dispatch(setSidebarWidth(w))}
            onReset={() => dispatch(setSidebarWidth(SIDEBAR_WIDTH_DEFAULT))}
            ariaLabel="Resize sidebar"
          />
        )}
      </aside>

      <DeleteConfirmationModal
        isOpen={!!deleteWorkspace.workspaceToDelete}
        isDeleting={deleteWorkspace.isDeleting}
        onConfirm={deleteWorkspace.handleConfirmDelete}
        onCancel={deleteWorkspace.handleCancelDelete}
        title="Delete Workspace?"
        description="This action cannot be undone. The workspace will be permanently deleted."
      />

      <HelpMenu
        isOpen={helpMenuState.isOpen}
        position={helpMenuState.position}
        onClose={handleCloseHelpMenu}
      />

      <CloneRepoModal
        isOpen={isCloneModalOpen}
        isCloning={isCloning}
        onClone={handleCloneRepo}
        onClose={handleCloseCloneModal}
      />

      <CreateProjectModal
        isOpen={isCreateProjectModalOpen}
        isCreating={isCreatingProject}
        onCreate={handleCreateProject}
        onClose={handleCloseCreateProjectModal}
      />

      <CollectionModal
        isOpen={isCreateCollectionModalOpen}
        isSaving={isCreatingCollection}
        onSave={handleCreateCollection}
        onClose={handleCloseCreateCollectionModal}
      />
    </>
  );
}
