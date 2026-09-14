import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks";
import {
  setSelectedFile,
  setActiveTab,
} from "@/lib/redux/slices/workspaceSlice";
import { useGetWorkspaceQuery } from "@/lib/redux/api";
import { useModeConfig } from "@/hooks/use-mode-config";
import { useDocumentViewer } from "@/hooks/use-document-viewer";
import { classifyDocType } from "@/lib/document-viewer";
import { selectSessionRunId } from "@/features/workspace/components/session-panel/select-session-run";
import { appApi } from "@/lib/transport";
import { toast } from "@/components/ui";
import type {
  DirEntry,
  FileNode,
  ServiceResponse,
} from "@/features/workspace/types/file-explorer";

/**
 * Opens a file the user clicked — a link in agent markdown, a tool card's path,
 * a changed-files row. Accepts absolute or workspace-relative paths.
 * Agent-written references are unreliable (bare filenames, stale or wrong
 * directory prefixes), so a path that doesn't exist on disk falls back to
 * locating the file in the workspace by basename, preferring the match whose
 * path ends with the referenced relative path.
 *
 * Where it opens depends on the mode: Developer has an editor tab, the
 * tab-less modes don't, so there the file goes to the OS. Every path that
 * fails says so — a click that silently does nothing reads as a broken app.
 */
export function useOpenFileInEditor() {
  const dispatch = useAppDispatch();
  const { showTabs } = useModeConfig();
  const { open: openDocument } = useDocumentViewer();
  const workspaceId = useAppSelector(
    (s) => s.workspace.activeWorkspaceId,
  );
  const { data: workspace } = useGetWorkspaceQuery(workspaceId || "", {
    skip: !workspaceId,
  });
  const workspaceRoot = workspace?.rootPath;
  const sessionRunId = useAppSelector((s) => selectSessionRunId(s.workspace));

  return useCallback(
    async (filePath: string) => {
      const trimmed = filePath?.trim();
      if (!trimmed) return;

      // Workspace-less runs (work, chat) still have a directory their files
      // live in — agents write bare filenames into their answers, and without
      // a base there is nothing to resolve them against.
      let rootPath = workspaceRoot;
      if (!rootPath && sessionRunId) {
        try {
          const res = await appApi.runs.getExecutionRoot(sessionRunId);
          if (res.success) rootPath = res.data ?? undefined;
        } catch {
          // Leave rootPath unset; resolution falls through to the toast.
        }
      }

      const open = (absolutePath: string) => {
        const name = absolutePath.split("/").pop() || absolutePath;
        const dotIdx = name.lastIndexOf(".");
        const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : undefined;
        // No tabs, no editor to open into. The viewer panel takes what it can
        // render — markdown and Office documents — and everything else goes to
        // the OS rather than into a surface this mode never renders.
        if (!showTabs) {
          const docType = classifyDocType(absolutePath);
          if (docType) {
            openDocument({ path: absolutePath, fileName: name, docType });
          } else {
            void window.api.shell.openPath(absolutePath);
          }
          return;
        }
        const node: FileNode = {
          name,
          fullPath: absolutePath,
          type: "file",
          extension,
        };
        dispatch(setSelectedFile(node));
        dispatch(setActiveTab("editor"));
      };

      const fileExists = async (p: string): Promise<boolean> => {
        try {
          const res = await appApi.fileExplorer.getPathInfo(p);
          return res.success && res.data.isFile;
        } catch {
          return false;
        }
      };

      // 1. Direct resolution — absolute as-is, relative against the root.
      const cleaned = trimmed.replace(/^\.\//, "");
      const direct = trimmed.startsWith("/")
        ? trimmed
        : rootPath
          ? `${rootPath.replace(/\/$/, "")}/${cleaned}`
          : null;
      if (direct && (await fileExists(direct))) {
        open(direct);
        return;
      }

      // 2. Locate by basename anywhere in the workspace. Workspace-less runs
      // (work, chat) have no tree to search, so they end at the toast below.
      const basename = cleaned.split("/").pop() ?? cleaned;
      if (rootPath) {
        try {
          const result: ServiceResponse<DirEntry[]> =
            await appApi.fileExplorer.searchFiles({
              rootPath,
              query: basename,
              max: 50,
            });
          if (result.success) {
            const candidates = result.data.filter((e) => e.name === basename);
            const best =
              candidates.find((e) => e.fullPath.endsWith(`/${cleaned}`)) ??
              candidates[0];
            if (best) {
              open(best.fullPath);
              return;
            }
          }
        } catch {
          // Search failure falls through to the not-found toast.
        }
      }

      toast.error(`File not found: ${basename}`);
    },
    [dispatch, workspaceRoot, sessionRunId, showTabs, openDocument],
  );
}
