import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import { FileExplorer } from "@/features/workspace/components/file-explorer";
import type { FileNode } from "@/features/workspace/types/file-explorer";
import {
  useGetWorkspaceQuery,
  useGetLatestWorkspaceDiffSummaryQuery,
} from "@/lib/redux/api";
import {
  setSelectedFile,
  setActiveTab,
  addContextItem,
  toggleExplorerPath,
  expandExplorerPaths,
  collapseAllExplorerPaths,
} from "@/lib/redux/slices/workspaceSlice";
import { setRightPanelOpen } from "@/lib/redux/slices/appSettingsSlice";
import { useIsMobile } from "@/lib/platform";
import { FolderIcon } from "@/components/ui/icons/file-icons";

import { DiffSection } from "@/features/workspace/components/diff-section";
import { useActiveSpace } from "@/hooks/use-active-space";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useOpenDiffInEditor } from "@/features/workspace/hooks/use-open-diff-in-editor";
import { Button, Text } from "@/components/ui";
import { ActivitySection } from "./activity-section";

type SidebarTab = "files" | "changes" | "reviews";

export function WorkspaceSidebar() {
  const dispatch = useAppDispatch();
  // On mobile the panel is a full-screen overlay; opening a file/issue/signal
  // closes it so the resulting tab (in the main area) is visible.
  const isMobile = useIsMobile();
  const { activeSpaceId } = useActiveSpace();
  const workspaceId = useAppSelector(
    (state) => state.workspace.activeWorkspaceId,
  );

  const [selectedTab, setSidebarTab] = useState<SidebarTab>("files");
  const { showChangesTab } = useModeConfig();
  // Derived, not reset: if the mode hides Changes while it is selected,
  // Files takes over without touching state.
  const sidebarTab: SidebarTab =
    !showChangesTab && selectedTab === "changes" ? "files" : selectedTab;
  const openDiffInEditor = useOpenDiffInEditor();

  // Get workspace data from the selected workspace ID
  const { data: workspace } = useGetWorkspaceQuery(workspaceId || "", {
    skip: !workspaceId,
  });

  // Get diff summary (no diffText) to show changed files count
  const { currentData: diff } = useGetLatestWorkspaceDiffSummaryQuery(
    workspaceId || "",
    {
      skip: !workspaceId || !showChangesTab,
    },
  );

  const changedFilesCount = diff?.files?.length ?? 0;
  const rootPath = workspace?.rootPath;

  // Explorer selection + expansion live in Redux so the tree keeps its shape
  // across tab switches and panel toggles (both unmount FileExplorer).
  const selectedFile = useAppSelector((state) => state.workspace.selectedFile);
  const explorerExpandedPaths = useAppSelector(
    (state) => state.workspace.explorerExpandedPaths,
  );
  const expandedPathSet = useMemo(
    () => new Set(explorerExpandedPaths),
    [explorerExpandedPaths],
  );
  const handleToggleExpand = useCallback(
    (path: string) => {
      dispatch(toggleExplorerPath(path));
    },
    [dispatch],
  );
  const handleCollapseAll = useCallback(() => {
    dispatch(collapseAllExplorerPaths());
  }, [dispatch]);

  // Reveal the selected file: expand its ancestor folders no matter how it
  // was opened (tree click, file search, "@" menu, diff link).
  useEffect(() => {
    const fullPath = selectedFile?.fullPath;
    if (!fullPath || !rootPath) return;
    const root = rootPath.replace(/\/$/, "");
    if (!fullPath.startsWith(`${root}/`)) return;
    const parts = fullPath.slice(root.length + 1).split("/").slice(0, -1);
    if (parts.length === 0) return;
    const ancestors: string[] = [];
    let acc = root;
    for (const part of parts) {
      acc = `${acc}/${part}`;
      ancestors.push(acc);
    }
    dispatch(expandExplorerPaths(ancestors));
  }, [selectedFile?.fullPath, rootPath, dispatch]);

  const handleFileSelect = useCallback(
    (node: FileNode) => {
      // Dispatch file selection to Redux
      dispatch(setSelectedFile(node));
      // Switch to Editor tab when a file is selected
      dispatch(setActiveTab("editor"));
      if (isMobile) dispatch(setRightPanelOpen(false));
    },
    [dispatch, isMobile],
  );

  const handleAddToContext = useCallback(
    (node: FileNode) => {
      // Add file to context for the input
      dispatch(addContextItem({ kind: "file", ...node }));
    },
    [dispatch],
  );

  const handleSelectDiffFile = useCallback(
    (filePath: string, diffContent: string) => {
      openDiffInEditor(filePath, diffContent);
      if (isMobile) dispatch(setRightPanelOpen(false));
    },
    [openDiffInEditor, dispatch, isMobile],
  );

  // If no workspace ID or rootPath provided, show empty state
  if (!workspaceId || !rootPath) {
    return (
      <div className="flex-1 flex flex-col h-[calc(100%-1rem)] mt-2 -pb-4 rounded-xl overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <Text as="div" size="inherit" tone="muted" className="flex flex-col items-center gap-3">
            <FolderIcon className="size-10" />
            <Text as="span" size="xs" tone="inherit" weight="medium">No workspace selected</Text>
          </Text>
        </div>
      </div>
    );
  }

  const tabCount = showChangesTab ? 3 : 2;
  const tabIndex =
    sidebarTab === "files"
      ? 0
      : sidebarTab === "changes"
        ? 1
        : tabCount - 1;

  return (
    <div className="flex-1 flex flex-col h-[calc(100%-1rem)] mt-2 -pb-4 rounded-xl overflow-hidden">
      <div className="shrink-0 py-2 mt-8 px-3">
        <div className="glass-outline relative flex items-center p-0.5 rounded-xl ">
          <div
            className={`absolute top-0.5 bottom-0.5 rounded-[10px] glass-outline dark:bg-primary/10 bg-primary  transition-transform duration-200 ease-out`}
            style={{
              width: `calc((100% - ${tabCount * 0.25}rem) / ${tabCount})`,
              left: "0.125rem",
              transform: `translateX(calc(${tabIndex} * (100% + 0.25rem)))`,
            }}
          />
          <Button
            onClick={() => setSidebarTab("files")}
            className={`relative z-(--z-base) flex-1 min-w-0 whitespace-nowrap truncate text-xs font-medium py-1 px-2 transition-colors ${
              sidebarTab === "files"
                ? "text-primary-900 dark:text-primary-100"
                : "text-primary-800 dark:text-primary-200 hover:text-primary-800 dark:hover:text-primary-200"
            }`}
          >
            Files
          </Button>
          {showChangesTab && (
            <Button
              onClick={() => setSidebarTab("changes")}
              className={`relative z-(--z-base) flex-1 min-w-0 flex items-center justify-center gap-1 whitespace-nowrap text-xs font-medium py-1 px-2  transition-colors ${
                sidebarTab === "changes"
                  ? "text-primary-900 dark:text-primary-100"
                  : "text-primary-800 dark:text-primary-200 hover:text-primary-800 dark:hover:text-primary-200"
              }`}
            >
              {/* The label may truncate under a narrow panel; the count never does. */}
              <span className="truncate">Changes</span>
              {changedFilesCount > 0 && (
                <span className="shrink-0">({changedFilesCount})</span>
              )}
            </Button>
          )}
          <Button
            onClick={() => setSidebarTab("reviews")}
            className={`relative z-(--z-base) flex-1 min-w-0 whitespace-nowrap truncate text-xs font-medium py-1 px-2 rounded-lg transition-colors ${
              sidebarTab === "reviews"
                ? "text-primary-900 dark:text-primary-100"
                : "text-primary-800 dark:text-primary-200 hover:text-primary-800 dark:hover:text-primary-200"
            }`}
          >
            Activity
          </Button>
        </div>
      </div>

      {/* Tab content */}
      {sidebarTab === "files" ? (
        <>
          {/* File Explorer */}
          <div className="flex-1 px-3 flex flex-col min-h-0">
            <FileExplorer
              key={`${activeSpaceId}-${workspaceId || rootPath}`}
              rootPath={rootPath}
              onFileSelect={handleFileSelect}
              onAddToContext={handleAddToContext}
              selectedPath={selectedFile?.fullPath ?? null}
              expandedPaths={expandedPathSet}
              onToggleExpand={handleToggleExpand}
              onCollapseAll={handleCollapseAll}
              initialDepth={2}
              className="flex-1 min-h-0"
            />
          </div>
        </>
      ) : sidebarTab === "changes" ? (
        /* Changes (diff) view */
        <div className="flex-1 px-3 flex flex-col min-h-0">
          <DiffSection
            key={workspaceId}
            workspaceId={workspaceId}
            onSelectDiffFile={handleSelectDiffFile}
          />
        </div>
      ) :  <ActivitySection workspaceId={workspaceId} />}
    </div>
  );
}
