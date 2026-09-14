import type { IssueWithEntity, SignalWithEntity } from "@/lib/redux/api";
import type { ReviewTab } from "@/lib/redux/slices/workspaceSlice";
import type { Run } from "../types";

/** Matches tab strip order in `WorkspaceTabs`: editor → issues → signals → notes → runs → new-run. */
export function isFirstWorkspaceTabActive(params: {
  selectedFile: unknown | null | undefined;
  activeTab: "editor" | string;
  openIssueTabs: IssueWithEntity[];
  openSignalTabs: SignalWithEntity[];
  openNoteTabs: ReviewTab[];
  runs: Run[];
  showNewRunTab?: boolean;
}): boolean {
  const {
    selectedFile,
    activeTab,
    openIssueTabs,
    openSignalTabs,
    openNoteTabs,
    runs,
    showNewRunTab,
  } = params;

  if (selectedFile) {
    return activeTab === "editor";
  }
  if (openIssueTabs.length > 0) {
    return activeTab === `issue:${openIssueTabs[0].issue.entityId}`;
  }
  if (openSignalTabs.length > 0) {
    return activeTab === `signal:${openSignalTabs[0].signal.entityId}`;
  }
  if (openNoteTabs.length > 0) {
    return activeTab === `note:${openNoteTabs[0].id}`;
  }
  if (runs.length > 0) {
    return activeTab === runs[0].id;
  }
  if (showNewRunTab) {
    return activeTab === "new-run";
  }
  return false;
}
