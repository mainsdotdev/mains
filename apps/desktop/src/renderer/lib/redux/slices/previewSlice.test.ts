import { describe, expect, it } from "vitest";
import reducer, { openPreviewTab, selectPreviewTab, closePreviewTab, setPreviewOpen, syncBrowserPreviewTabs, type PreviewTab } from "./previewSlice";
import { transferRightPaneContext, forgetRunRightPane, forgetWorkspaceRightPanes } from "./appSettingsSlice";
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";
import { previewOwnerKey } from "@/features/workspace/lib/preview-tabs";
const doc = (id: string, path = `/tmp/${id}.pdf`): PreviewTab => ({ kind: "document", id, doc: { path, fileName: `${id}.pdf`, docType: "pdf" } });
const browser = (id: string): Extract<PreviewTab, { kind: "browser" }> => ({ kind: "browser", id, title: id, faviconUrl: null, isLoading: false, isCrashed: false });

describe("preview tabs", () => {
  it("retains several browser pages alongside independent app and file tabs", () => {
    let state = reducer(undefined, openPreviewTab({ ownerKey: "ws", tab: browser("page-1") }));
    for (const tab of [doc("pdf"), { kind: "app", id: "canvas", title: "Canvas" } as PreviewTab, browser("page-2")])
      state = reducer(state, openPreviewTab({ ownerKey: "ws", tab }));
    state = reducer(state, selectPreviewTab({ ownerKey: "ws", id: "pdf" }));
    expect(state.byOwner.ws.tabs.map((tab) => tab.id)).toEqual(["page-1", "pdf", "canvas", "page-2"]);
    expect(state.byOwner.ws.activeTabId).toBe("pdf");
  });
  it("focuses an existing file without replacing its instance", () => {
    let state = reducer(undefined, openPreviewTab({ ownerKey: "ws", tab: doc("original", "/tmp/a.pdf") }));
    state = reducer(state, openPreviewTab({ ownerKey: "ws", tab: doc("duplicate", "/tmp/a.pdf") }));
    expect(state.byOwner.ws.tabs).toHaveLength(1);
    expect(state.byOwner.ws.activeTabId).toBe("original");
  });
  it("preserves selection when hidden and chooses the neighboring mixed tab on close", () => {
    let state = reducer(undefined, openPreviewTab({ ownerKey: "ws", tab: browser("page") }));
    state = reducer(state, openPreviewTab({ ownerKey: "ws", tab: doc("pdf") }));
    state = reducer(state, setPreviewOpen({ ownerKey: "ws", open: false }));
    expect(state.byOwner.ws.activeTabId).toBe("pdf");
    expect(state.byOwner.ws.tabs).toHaveLength(2);
    state = reducer(state, setPreviewOpen({ ownerKey: "ws", open: true }));
    state = reducer(state, closePreviewTab({ ownerKey: "ws", id: "pdf" }));
    expect(state.byOwner.ws.activeTabId).toBe("page");
    state = reducer(state, closePreviewTab({ ownerKey: "ws", id: "page" }));
    expect(state.byOwner.ws.open).toBe(false);
    expect(state.byOwner.ws.tabs).toEqual([]);
  });
  it("keeps background browser updates from selecting over an open document", () => {
    let state = reducer(undefined, openPreviewTab({ ownerKey: "ws", tab: browser("page") }));
    state = reducer(state, openPreviewTab({ ownerKey: "ws", tab: doc("pdf") }));
    state = reducer(state, syncBrowserPreviewTabs({ ownerKey: "ws", tabs: [{ ...browser("page"), title: "Loaded" }], activeTabId: "page" }));
    expect(state.byOwner.ws.activeTabId).toBe("pdf");
    expect(state.byOwner.ws.tabs[0]).toMatchObject({ title: "Loaded" });
  });
  it("closing the final browser tab retains the document and its selection", () => {
    let state = reducer(undefined, openPreviewTab({ ownerKey: "ws", tab: browser("page") }));
    state = reducer(state, openPreviewTab({ ownerKey: "ws", tab: doc("pdf") }));
    state = reducer(state, syncBrowserPreviewTabs({ ownerKey: "ws", tabs: [], activeTabId: "" }));
    expect(state.byOwner.ws.activeTabId).toBe("pdf");
    expect(state.byOwner.ws.open).toBe(true);
  });
  it("uses a shared Code workspace owner and separate Work/Chat conversation owners", () => {
    const scope = { backendId: null, spaceId: "space", providerId: "codex", mode: "developer", workspaceId: "ws" };
    expect(previewOwnerKey(scope, "chat-1")).toBe(previewOwnerKey(scope, "chat-2"));
    expect(previewOwnerKey({ ...scope, backendId: "remote" }, "chat-1")).not.toBe(previewOwnerKey(scope, "chat-1"));
    for (const mode of ["work", "chat"]) expect(previewOwnerKey({ ...scope, mode }, "chat-1")).not.toBe(previewOwnerKey({ ...scope, mode }, "chat-2"));
  });
  it("moves unsent Work tabs into the created chat and keeps Code workspace tabs in place", () => {
    const wsKey = workspaceBrowserExpansionKey(null, "ws");
    let state = reducer(undefined, openPreviewTab({ ownerKey: "draft", tab: doc("work-doc") }));
    state = reducer(state, openPreviewTab({ ownerKey: wsKey, tab: doc("code-doc") }));
    state = reducer(state, transferRightPaneContext({ fromKey: "draft", toKey: "run" }));
    expect(state.byOwner.draft).toBeUndefined();
    expect(state.byOwner.run.activeTabId).toBe("work-doc");
    expect(state.byOwner[wsKey].activeTabId).toBe("code-doc");
  });
  it("cleans deleted owners without losing other workspaces or backend tabs", () => {
    const wsKey = workspaceBrowserExpansionKey(null, "ws");
    const remote = workspaceBrowserExpansionKey("remote", "ws");
    const chat = runOwnerKey(null, "chat");
    let state = reducer(undefined, openPreviewTab({ ownerKey: wsKey, tab: doc("ws") }));
    state = reducer(state, openPreviewTab({ ownerKey: remote, tab: doc("remote") }));
    state = reducer(state, openPreviewTab({ ownerKey: chat, tab: doc("chat") }));
    state = reducer(state, forgetRunRightPane({ backendId: "local", runId: "chat" }));
    state = reducer(state, forgetWorkspaceRightPanes({ backendId: "local", workspaceId: "ws" }));
    expect(Object.keys(state.byOwner)).toEqual([remote]);
  });
});
