import { isRunTab } from "@/features/workspace/lib/repo-utils";

/** The slice fields the derivation reads — kept structural so tests can call it. */
interface SessionTabState {
  activeTab: string;
  previousNonEditorTab: string | null;
}

/**
 * The run the session panel is describing: the workspace's active tab.
 *
 * Falls back to the tab the editor was opened from, so opening a changed file
 * out of the panel doesn't empty its own subagent list. Other non-run tabs (an
 * issue, a note, the new-run prompt) genuinely have no session, and neither
 * does a workspace with no runs at all — the panel still has the working tree
 * to show, but nothing to sit beside.
 *
 * Shared with the app shell, which decides from the same answer whether the
 * panel takes a column of the layout or floats over the content.
 */
export function selectSessionRunId(workspace: SessionTabState): string | null {
  const { activeTab, previousNonEditorTab } = workspace;
  if (isRunTab(activeTab)) return activeTab;
  if (
    activeTab === "editor" &&
    previousNonEditorTab &&
    isRunTab(previousNonEditorTab)
  ) {
    return previousNonEditorTab;
  }
  return null;
}
