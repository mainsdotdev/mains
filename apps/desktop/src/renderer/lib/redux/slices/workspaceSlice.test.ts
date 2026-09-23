import { describe, it, expect } from "vitest";
import reducer, {
  activateWorkspaceView,
  addContextItem,
  addContextItemForKey,
  clearContextItems,
  forgetRunUiState,
  forgetWorkspaceUiState,
  closeProviderAuthTerminal,
  markProviderAuthCommandSent,
  openProviderAuthTerminal,
  removeContextItem,
  setActiveTab,
  setComposerContextKey,
  setDraftText,
  setSelectedFile,
  setWorkspaceSidebarTab,
  toggleExplorerPath,
} from "./workspaceSlice";
import type { ContextItem } from "@/features/workspace/lib/composer-context";
import { runOwnerKey } from "../../../../shared/ui-state-keys";

describe("workspaceSlice — provider auth terminal", () => {
  const opened = () =>
    reducer(
      undefined,
      openProviderAuthTerminal({
        providerId: "claude_code",
        command: "claude auth login",
      }),
    );

  it("opens with a command for exactly one provider", () => {
    expect(opened().providerAuthTerminal).toEqual({
      providerId: "claude_code",
      pendingCommand: "claude auth login",
    });
  });

  it("keeps the terminal open after the queued command is sent", () => {
    const state = reducer(opened(), markProviderAuthCommandSent());
    expect(state.providerAuthTerminal).toEqual({
      providerId: "claude_code",
      pendingCommand: null,
    });
  });

  it("clears the terminal and any pending command when closed", () => {
    const state = reducer(opened(), closeProviderAuthTerminal());
    expect(state.providerAuthTerminal).toBeNull();
  });

  it("does not carry an auth terminal across provider switches", () => {
    const state = reducer(
      opened(),
      activateWorkspaceView({ key: "codex/space/ws-a", workspaceId: "ws-a", providerId: "codex" }),
    );
    expect(state.providerAuthTerminal).toBeNull();
  });
});

// Six kinds of attachment, one list. The reducers stay generic by delegating
// identity to `composer-context.ts`; these cover the wiring between them.
describe("workspaceSlice — composer context", () => {
  const file = (fullPath: string): ContextItem => ({
    kind: "file",
    name: fullPath.split("/").pop() ?? fullPath,
    fullPath,
    type: "file",
  });
  const skill = (name: string): ContextItem => ({ kind: "skill", name });

  const withItems = (...items: ContextItem[]) => {
    let state = reducer(undefined, clearContextItems());
    for (const item of items) state = reducer(state, addContextItem(item));
    return state;
  };

  it("attaches items in the order they arrive, across kinds", () => {
    const state = withItems(file("/repo/a.ts"), skill("reviewer"), file("/repo/b.ts"));
    expect(state.contextItems.map((i) => i.kind)).toEqual(["file", "skill", "file"]);
  });

  it("ignores a re-add of something already attached", () => {
    const state = withItems(file("/repo/a.ts"), file("/repo/a.ts"));
    expect(state.contextItems).toHaveLength(1);
  });

  it("removes only the addressed kind, even when keys collide", () => {
    // A skill named after a path is contrived, but the reducer must not rely
    // on keys being unique across kinds.
    const state = reducer(
      withItems(file("/repo/a.ts"), skill("/repo/a.ts")),
      removeContextItem({ kind: "file", key: "/repo/a.ts" }),
    );
    expect(state.contextItems).toHaveLength(1);
    expect(state.contextItems[0].kind).toBe("skill");
  });

  it("leaves the list alone when the key matches nothing", () => {
    const before = withItems(file("/repo/a.ts"));
    const after = reducer(before, removeContextItem({ kind: "file", key: "/repo/z.ts" }));
    expect(after.contextItems).toHaveLength(1);
  });

  it("clears every kind at once", () => {
    const state = reducer(
      withItems(file("/repo/a.ts"), skill("reviewer")),
      clearContextItems(),
    );
    expect(state.contextItems).toEqual([]);
  });
});

describe("workspaceSlice — saved workspace views", () => {
  const activate = (key: string, workspaceId: string) =>
    activateWorkspaceView({ key, workspaceId, providerId: "codex" });

  it("restores the selected file, tab, explorer and sidebar for each workspace", () => {
    let state = reducer(undefined, activate("space/ws-a", "ws-a"));
    state = reducer(state, setSelectedFile({ name: "a.ts", fullPath: "/a/a.ts", type: "file" }));
    state = reducer(state, toggleExplorerPath("/a"));
    state = reducer(state, setWorkspaceSidebarTab("changes"));
    state = reducer(state, setActiveTab("run-a"));
    state = reducer(state, activate("space/ws-b", "ws-b"));
    expect(state.selectedFile).toBeNull();
    expect(state.activeTab).toBe("editor");
    state = reducer(state, setActiveTab("run-b"));
    state = reducer(state, activate("space/ws-a", "ws-a"));
    expect(state.selectedFile?.fullPath).toBe("/a/a.ts");
    expect(state.explorerExpandedPaths).toEqual(["/a"]);
    expect(state.sidebarTab).toBe("changes");
    expect(state.activeTab).toBe("run-a");
    state = reducer(state, activate("space/ws-b", "ws-b"));
    expect(state.activeTab).toBe("run-b");
  });

  it("does not restore generated diff files whose content is transient", () => {
    let state = reducer(undefined, activate("space/ws-a", "ws-a"));
    state = reducer(state, setSelectedFile({ name: "diff", fullPath: "/a/diff", type: "file", extension: "diff" }));
    state = reducer(state, activate("space/ws-b", "ws-b"));
    state = reducer(state, activate("space/ws-a", "ws-a"));
    expect(state.selectedFile).toBeNull();
  });

  it("keeps an intentionally selected editor tab when revisiting a workspace", () => {
    let state = reducer(undefined, activate("space/ws-a", "ws-a"));
    expect(state.workspaceViewNeedsDefaultRun).toBe(true);
    state = reducer(state, setActiveTab("run-a"));
    state = reducer(state, setActiveTab("editor"));
    state = reducer(state, activate("space/ws-b", "ws-b"));
    state = reducer(state, activate("space/ws-a", "ws-a"));
    expect(state.activeTab).toBe("editor");
    expect(state.workspaceViewNeedsDefaultRun).toBe(false);
  });

  it("separates providers in the same physical workspace", () => {
    let state = reducer(
      undefined,
      activateWorkspaceView({ key: "claude/space/ws-a", workspaceId: "ws-a", providerId: "claude" }),
    );
    state = reducer(state, setActiveTab("claude-run"));
    state = reducer(
      state,
      activateWorkspaceView({ key: "codex/space/ws-a", workspaceId: "ws-a", providerId: "codex" }),
    );
    expect(state.activeTab).toBe("editor");
    state = reducer(
      state,
      activateWorkspaceView({ key: "claude/space/ws-a", workspaceId: "ws-a", providerId: "claude" }),
    );
    expect(state.activeTab).toBe("claude-run");
  });
});

describe("workspaceSlice — composer owners", () => {
  const file: ContextItem = { kind: "file", name: "a.ts", fullPath: "/a.ts", type: "file" };

  it("keeps draft text and attachments with their conversation in the live renderer", () => {
    let state = reducer(undefined, setComposerContextKey("chat-a"));
    state = reducer(state, setDraftText({ key: "chat-a", text: "unfinished" }));
    state = reducer(state, addContextItem(file));
    state = reducer(state, setComposerContextKey("chat-b"));
    expect(state.contextItems).toEqual([]);
    state = reducer(state, setComposerContextKey("chat-a"));
    expect(state.contextItems).toEqual([file]);
    expect(state.draftTextByKey["chat-a"]).toBe("unfinished");
  });

  it("places an asynchronous browser selection in the chat that produced it", () => {
    let state = reducer(undefined, setComposerContextKey("chat-b"));
    state = reducer(state, addContextItemForKey({ key: "chat-a", item: file }));
    expect(state.contextItems).toEqual([]);
    state = reducer(state, setComposerContextKey("chat-a"));
    expect(state.contextItems).toEqual([file]);
  });

  it("carries a global Appshot to the next chat while leaving files with their owner", () => {
    const appshot: ContextItem = {
      kind: "appshot", id: "cap-1", appName: "Browser", bundleIdentifier: null,
      windowTitle: "Page", timestamp: "2026-09-23T00:00:00Z",
      screenshotPath: "/tmp/cap.png", screenshotCaptureName: "cap.png",
      screenshotMimeType: "image/png", accessibilityText: "",
      accessibilityStatus: "captured", accessibilityTruncated: false,
    };
    let state = reducer(undefined, setComposerContextKey("chat-a"));
    state = reducer(state, addContextItem(file));
    state = reducer(state, addContextItem(appshot));
    state = reducer(state, setComposerContextKey("chat-b"));
    expect(state.contextItems).toEqual([appshot]);
    state = reducer(state, setComposerContextKey("chat-a"));
    expect(state.contextItems).toEqual([file, appshot]);
  });
});

describe("workspaceSlice — deleted UI owners", () => {
  const viewA = JSON.stringify(["local", "space", "codex", "developer", "ws-a"]);
  const viewB = JSON.stringify(["local", "space", "codex", "developer", "ws-b"]);
  const draftA = JSON.stringify(["local", "draft", "space", "codex", "developer", "ws-a", null]);
  const runA = runOwnerKey("local", "run-a");
  const runB = runOwnerKey("local", "run-b");

  it("clears a deleted run from drafts and saved tabs without touching another run", () => {
    let state = reducer(undefined, activateWorkspaceView({ key: viewA, workspaceId: "ws-a", providerId: "codex" }));
    state = reducer(state, setActiveTab("run-a"));
    state = reducer(state, setComposerContextKey(runA));
    state = reducer(state, setDraftText({ key: runA, text: "deleted" }));
    state = reducer(state, setDraftText({ key: runB, text: "kept" }));
    state = reducer(state, activateWorkspaceView({ key: viewB, workspaceId: "ws-b", providerId: "codex" }));
    state = reducer(state, setActiveTab("run-a"));

    state = reducer(state, forgetRunUiState({ backendId: "local", runId: "run-a" }));

    expect(state.workspaceViews[viewA].activeTab).toBe("editor");
    expect(state.activeTab).toBe("editor");
    expect(state.workspaceViewNeedsDefaultRun).toBe(false);
    expect(state.draftTextByKey[runA]).toBeUndefined();
    expect(state.draftTextByKey[runB]).toBe("kept");
    expect(state.composerContextKey).toBe("default");
  });

  it("discards a deleted workspace view and drafts while keeping its existing runs", () => {
    let state = reducer(undefined, activateWorkspaceView({ key: viewA, workspaceId: "ws-a", providerId: "codex" }));
    state = reducer(state, setSelectedFile({ name: "a.ts", fullPath: "/a/a.ts", type: "file" }));
    state = reducer(state, setComposerContextKey(draftA));
    state = reducer(state, setDraftText({ key: draftA, text: "unsent" }));
    state = reducer(state, setDraftText({ key: runA, text: "run draft" }));

    state = reducer(state, forgetWorkspaceUiState({ backendId: "local", workspaceId: "ws-a" }));
    state = reducer(state, activateWorkspaceView({ key: viewB, workspaceId: "ws-b", providerId: "codex" }));

    expect(state.workspaceViews[viewA]).toBeUndefined();
    expect(state.selectedFile).toBeNull();
    expect(state.draftTextByKey[draftA]).toBeUndefined();
    expect(state.draftTextByKey[runA]).toBe("run draft");
    expect(state.activeWorkspaceIdByProvider.codex).toBe("ws-b");
  });
});
