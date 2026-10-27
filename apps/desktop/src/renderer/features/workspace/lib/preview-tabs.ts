import type { BrowserTabViewModel } from "../components/browser-tab-strip";
import type { PreviewTab } from "@/lib/redux/slices/previewSlice";
import { workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import type { UiContextParts } from "./ui-context";

export function previewOwnerKey(scope: UiContextParts, conversationKey: string): string {
  return scope.mode === "developer" && scope.workspaceId
    ? workspaceBrowserExpansionKey(scope.backendId, scope.workspaceId) : conversationKey;
}

export function browserPreviewTab(tab: Pick<BrowserTabViewModel, "tabId" | "title" | "faviconUrl" | "isLoading" | "isCrashed">): Extract<PreviewTab, { kind: "browser" }> {
  return { kind: "browser", id: tab.tabId, title: tab.title || "New tab", faviconUrl: tab.faviconUrl,
    isLoading: tab.isLoading, isCrashed: tab.isCrashed };
}
