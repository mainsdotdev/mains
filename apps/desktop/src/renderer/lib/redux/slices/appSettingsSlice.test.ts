import { describe, it, expect } from "vitest";
import reducer, {
  setBrowserPanelOpen,
  setBrowserPanelExpanded,
  setDocumentViewerDoc,
  setDocumentViewerOpen,
  setRightPaneContextKey,
  transferRightPaneContext,
  setRightPanelOpen,
  setSessionPanelOpen,
  setWorkspaceGroupExpanded,
  setMcpAppPinned,
  forgetRunRightPane,
  forgetWorkspaceRightPanes,
} from "./appSettingsSlice";
import { openNewRunTab, setActiveTab } from "./workspaceSlice";
import { runOwnerKey, workspaceBrowserExpansionKey } from "../../../../shared/ui-state-keys";

const open = () => reducer(undefined, setSessionPanelOpen(true));
const context = (ownerKey: string, browserExpansionKey = ownerKey) =>
  setRightPaneContextKey({ ownerKey, browserExpansionKey });

describe("appSettingsSlice — MCP app pins", () => {
  const availablePinKeys = ["a", "b", "c", "d", "e", "f"];
  const pin = (pinKey: string, pinned = true, providerId = "codex", available = availablePinKeys) =>
    setMcpAppPinned({ providerId, pinKey, pinned, availablePinKeys: available });

  it("starts empty and enforces the limit even before React can disable another pin", () => {
    let state = reducer(undefined, { type: "init" });
    expect(state.pinnedMcpAppKeysByProvider).toEqual({});
    for (const id of availablePinKeys) state = reducer(state, pin(id));
    expect(state.pinnedMcpAppKeysByProvider.codex).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps pin order, deduplicates app identities, and frees a slot on unpin", () => {
    let state = reducer(undefined, pin("b"));
    state = reducer(state, pin("a"));
    state = reducer(state, pin("b"));
    expect(state.pinnedMcpAppKeysByProvider.codex).toEqual(["b", "a"]);
    state = reducer(state, pin("b", false));
    state = reducer(state, pin("c"));
    expect(state.pinnedMcpAppKeysByProvider.codex).toEqual(["a", "c"]);
  });

  it("keeps providers independent and pins stable across conversation changes", () => {
    let state = reducer(undefined, pin("a"));
    state = reducer(state, pin("b", true, "claude_code"));
    state = reducer(state, context("another-workspace"));
    state = reducer(state, openNewRunTab());
    expect(state.pinnedMcpAppKeysByProvider).toEqual({ codex: ["a"], claude_code: ["b"] });
  });

  it("does not let unavailable apps consume a slot or accept a stale pin request", () => {
    let state = reducer(undefined, pin("a"));
    const available = availablePinKeys.slice(1);
    state = reducer(state, pin("c", true, "codex", available));
    expect(state.pinnedMcpAppKeysByProvider.codex).toEqual(["c"]);
    state = reducer(state, pin("a", true, "codex", available));
    expect(state.pinnedMcpAppKeysByProvider.codex).toEqual(["c"]);
  });
});

// The session panel reads the run in the active tab. A new-run tab has no run,
// so switching to one has to dismiss the panel rather than leave the previous
// tab's state on screen. The rule lives in the slice so every route into that
// tab is covered by one place.
describe("appSettingsSlice — session panel vs the new-run tab", () => {
  it("closes on the new-run tab being opened", () => {
    expect(reducer(open(), openNewRunTab()).sessionPanelOpen).toBe(false);
  });

  it("closes when the new-run tab is selected directly", () => {
    expect(reducer(open(), setActiveTab("new-run")).sessionPanelOpen).toBe(false);
  });

  it("leaves it open when switching between run tabs", () => {
    expect(reducer(open(), setActiveTab("run-123")).sessionPanelOpen).toBe(true);
    expect(reducer(open(), setActiveTab("editor")).sessionPanelOpen).toBe(true);
  });

  // Reacting to the switch, not to the tab: reopening it by hand while sitting
  // on a new-run tab has to stick.
  it("can be reopened while the new-run tab is active", () => {
    const closed = reducer(open(), openNewRunTab());
    expect(reducer(closed, setSessionPanelOpen(true)).sessionPanelOpen).toBe(true);
  });
});

describe("appSettingsSlice — right pane per conversation", () => {
  it("keeps the expanded browser when a draft becomes its first run", () => {
    let state = reducer(undefined, context("draft"));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, setBrowserPanelExpanded(true));
    state = reducer(state, transferRightPaneContext({ fromKey: "draft", toKey: "run" }));
    state = reducer(state, context("run"));
    expect(state.browserPanelOpen).toBe(true);
    expect(state.browserPanelExpanded).toBe(true);
    expect(state.rightPaneByContext.run).toBe("browser");
  });

  it("remembers the expanded size for one chat without applying it to another", () => {
    let state = reducer(undefined, setBrowserPanelExpanded(true));
    expect(state.browserPanelExpanded).toBe(false);

    state = reducer(state, context("chat-a"));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, setBrowserPanelExpanded(true));
    expect(state.browserPanelExpanded).toBe(true);

    state = reducer(state, context("chat-b"));
    expect(state.browserPanelExpanded).toBe(false);
    state = reducer(state, setBrowserPanelOpen(true));
    expect(state.browserPanelExpanded).toBe(false);
    state = reducer(state, context("chat-a"));
    expect(state.browserPanelOpen).toBe(true);
    expect(state.browserPanelExpanded).toBe(true);

    state = reducer(state, setBrowserPanelOpen(false));
    expect(state.browserPanelExpanded).toBe(false);
    state = reducer(state, setBrowserPanelOpen(true));
    expect(state.browserPanelExpanded).toBe(false);
  });

  it("shares expanded size across chats in one Code workspace, but not another workspace", () => {
    const workspaceA = workspaceBrowserExpansionKey("local", "ws-a");
    const workspaceB = workspaceBrowserExpansionKey("local", "ws-b");
    let state = reducer(undefined, context("run-a", workspaceA));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, setBrowserPanelExpanded(true));

    state = reducer(state, context("run-b", workspaceA));
    state = reducer(state, setBrowserPanelOpen(true));
    expect(state.browserPanelExpanded).toBe(true);

    state = reducer(state, context("run-c", workspaceB));
    state = reducer(state, setBrowserPanelOpen(true));
    expect(state.browserPanelExpanded).toBe(false);

    state = reducer(state, context("run-a", workspaceA));
    expect(state.browserPanelExpanded).toBe(true);
    state = reducer(state, setBrowserPanelExpanded(false));
    state = reducer(state, context("run-b", workspaceA));
    expect(state.browserPanelExpanded).toBe(false);
  });

  it("keeps the current pane open when only its expansion scope changes", () => {
    let state = reducer(undefined, context("run-a"));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, setBrowserPanelExpanded(true));
    state = reducer(state, setSessionPanelOpen(true));
    state = reducer(state, context("run-a", workspaceBrowserExpansionKey("local", "ws-a")));

    expect(state.browserPanelOpen).toBe(true);
    expect(state.browserPanelExpanded).toBe(false);
    expect(state.sessionPanelOpen).toBe(true);
  });

  it("restores the browser or workspace panel when returning to a chat", () => {
    let state = reducer(undefined, context("chat-a"));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, context("chat-b"));
    expect(state.browserPanelOpen).toBe(false);
    state = reducer(state, setRightPanelOpen(true));
    state = reducer(state, context("chat-a"));
    expect(state.browserPanelOpen).toBe(true);
    expect(state.rightPanelOpen).toBe(false);
    state = reducer(state, context("chat-b"));
    expect(state.rightPanelOpen).toBe(true);
  });

  it("restores an open document when returning to its chat in the same session", () => {
    const doc = { path: "/tmp/report.pdf", fileName: "report.pdf", docType: "pdf" as const };
    let state = reducer(undefined, context("chat-a"));
    state = reducer(state, setDocumentViewerDoc(doc));
    state = reducer(state, setDocumentViewerOpen(true));
    state = reducer(state, context("chat-b"));
    expect(state.documentViewerOpen).toBe(false);
    state = reducer(state, context("chat-a"));
    expect(state.documentViewerDoc).toEqual(doc);
    expect(state.documentViewerOpen).toBe(true);
  });

  it("does not restore a deleted chat's pane", () => {
    const deleted = runOwnerKey("local", "run-a");
    const kept = runOwnerKey("local", "run-b");
    let state = reducer(undefined, context(deleted));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, context(kept));
    state = reducer(state, setRightPanelOpen(true));
    state = reducer(state, forgetRunRightPane({ backendId: "local", runId: "run-a" }));
    expect(state.rightPaneByContext[deleted]).toBeUndefined();
    state = reducer(state, context(deleted));
    expect(state.browserPanelOpen).toBe(false);
  });

  it("removes only a deleted workspace's draft pane", () => {
    const draft = JSON.stringify(["local", "draft", "space", "codex", "developer", "ws-a", null]);
    const expansionKey = workspaceBrowserExpansionKey("local", "ws-a");
    const run = runOwnerKey("local", "run-a");
    let state = reducer(undefined, context(run));
    state = reducer(state, setRightPanelOpen(true));
    state = reducer(state, context(draft, expansionKey));
    state = reducer(state, setBrowserPanelOpen(true));
    state = reducer(state, setBrowserPanelExpanded(true));
    state = reducer(state, forgetWorkspaceRightPanes({ backendId: "local", workspaceId: "ws-a" }));
    expect(state.activeRightPaneContextKey).toBe("default");
    expect(state.browserPanelOpen).toBe(false);
    expect(state.rightPaneByContext[draft]).toBeUndefined();
    expect(state.rightPaneByContext[run]).toBe("workspace");
    expect(state.browserExpandedByContext[expansionKey]).toBeUndefined();
  });
});

// These two used to be one localStorage key per group / per project. As slice
// records their defaults are no longer "whatever the key parsed to", so the
// absent case is what needs pinning down.
describe("appSettingsSlice — per-entity UI records", () => {
  it("defaults a group to expanded and only stores the ones touched", () => {
    const state = reducer(
      undefined,
      setWorkspaceGroupExpanded({ groupKey: "in_progress", expanded: false }),
    );

    expect(state.workspaceGroupExpanded).toEqual({ in_progress: false });
    // Untouched groups hold no entry — the reader's `?? true` is the default.
    expect(state.workspaceGroupExpanded["done"]).toBeUndefined();
  });

  it("keeps groups independent", () => {
    let state = reducer(
      undefined,
      setWorkspaceGroupExpanded({ groupKey: "todo", expanded: false }),
    );
    state = reducer(
      state,
      setWorkspaceGroupExpanded({ groupKey: "done", expanded: true }),
    );

    expect(state.workspaceGroupExpanded).toEqual({ todo: false, done: true });
  });
});
