import { useCallback } from "react";
import { useAppDispatch } from "@/lib/redux/hooks";
import {
  setSelectedFile,
  setSelectedFileContent,
  setActiveTab,
} from "@/lib/redux/slices/workspaceSlice";

/**
 * Opens a file's *changes* in the editor tab, as opposed to the file itself
 * ([[useOpenFileInEditor]]).
 *
 * The editor renders whatever `selectedFileContent` holds, so a diff is just a
 * synthetic `.diff` file: the path identifies the tab, the extension picks the
 * highlighting, and the content is the unified-diff segment handed in — nothing
 * is read from disk, and the real file is never opened by this path.
 */
export function useOpenDiffInEditor() {
  const dispatch = useAppDispatch();

  return useCallback(
    (filePath: string, diffText: string) => {
      const fileName = filePath.split("/").pop() || filePath;
      dispatch(
        setSelectedFile({
          name: `${fileName}.diff`,
          fullPath: filePath,
          type: "file",
          extension: "diff",
        }),
      );
      dispatch(
        setSelectedFileContent({
          content: diffText,
          size: diffText.length,
          isBinary: false,
          encoding: "utf-8",
        }),
      );
      dispatch(setActiveTab("editor"));
    },
    [dispatch],
  );
}
