import { describe, it, expect } from "vitest";
import reducer, {
  addContextItem,
  clearContextItems,
  closeProviderAuthTerminal,
  markProviderAuthCommandSent,
  openProviderAuthTerminal,
  removeContextItem,
  setActiveTab,
  setActiveWorkspaceId,
  setActiveWorkspaceForProvider,
  setWorkspaceProvider,
} from "./workspaceSlice";
import type { ContextItem } from "@/features/workspace/lib/composer-context";

// `activeTab` is one global field, but a run tab belongs to exactly one
// workspace. Carrying it across a switch pointed every tab-derived reader — the
// transcript's auto-select, the session panel's run — at a run the new
// workspace doesn't have.
describe("workspaceSlice — the active tab across a workspace switch", () => {
  const onRunTab = (workspaceId: string | null) => {
    let state = reducer(undefined, setActiveWorkspaceId(workspaceId));
    state = reducer(state, setActiveTab("run-from-ws-a"));
    return state;
  };

  it("drops the previous workspace's run tab", () => {
    const state = reducer(onRunTab("ws-a"), setActiveWorkspaceId("ws-b"));
    expect(state.activeTab).toBe("editor");
  });

  it("drops it on the per-provider switch too", () => {
    let state = onRunTab("ws-a");
    state = reducer(
      state,
      setActiveWorkspaceForProvider({ providerId: "claude_code", workspaceId: "ws-b" }),
    );
    expect(state.activeTab).toBe("editor");
  });

  it("keeps the tab when the same workspace is set again", () => {
    const state = reducer(onRunTab("ws-a"), setActiveWorkspaceId("ws-a"));
    expect(state.activeTab).toBe("run-from-ws-a");
  });

  it("keeps the tab when the same workspace is set again per provider", () => {
    let state = reducer(
      undefined,
      setActiveWorkspaceForProvider({ providerId: "claude_code", workspaceId: "ws-a" }),
    );
    state = reducer(state, setActiveTab("run-1"));
    state = reducer(
      state,
      setActiveWorkspaceForProvider({ providerId: "claude_code", workspaceId: "ws-a" }),
    );
    expect(state.activeTab).toBe("run-1");
  });
});

// A space switch changes the provider but can land on the SAME workspace, so
// none of the workspace-switch resets above fire. Without a provider-keyed
// reset the tab keeps naming the previous space's run, and the session /
// subagent panels resurrect a run the new space doesn't list.
describe("workspaceSlice — the active tab across a space (provider) switch", () => {
  const onRunTab = () => {
    let state = reducer(undefined, setWorkspaceProvider("claude_code"));
    state = reducer(state, setActiveWorkspaceId("ws-a"));
    state = reducer(state, setActiveTab("run-from-claude"));
    return state;
  };

  it("drops the previous provider's run tab", () => {
    const state = reducer(onRunTab(), setWorkspaceProvider("codex"));
    expect(state.activeTab).toBe("editor");
    expect(state.previousNonEditorTab).toBeNull();
  });

  it("drops the editor fallback too, so nothing resurrects the run", () => {
    let state = onRunTab();
    // Landing on "editor" archives the run tab as the fallback the session
    // panels read — the provider switch must clear that as well.
    state = reducer(state, setActiveTab("editor"));
    expect(state.previousNonEditorTab).toBe("run-from-claude");
    state = reducer(state, setWorkspaceProvider("codex"));
    expect(state.previousNonEditorTab).toBeNull();
  });

  it("keeps the tab when the same provider is set again", () => {
    const state = reducer(onRunTab(), setWorkspaceProvider("claude_code"));
    expect(state.activeTab).toBe("run-from-claude");
  });
});

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
    const state = reducer(opened(), setWorkspaceProvider("codex"));
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
