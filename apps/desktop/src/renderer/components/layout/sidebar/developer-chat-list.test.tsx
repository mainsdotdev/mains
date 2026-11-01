// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, RecentRun, Workspace } from "@/lib/redux/api";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";

const state = vi.hoisted(() => ({ projects: [] as Project[], chats: [] as RecentRun[], jump: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({ useListProjectsQuery: () => ({ data: state.projects }) }));
vi.mock("./use-recent-chats", () => ({ useRecentChats: () => ({ data: state.chats, isLoading: false, isFetching: false, refetch: state.refetch }) }));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({ activeSpaceId: "codex-space", activeSpace: { id: "codex-space", providerId: "codex" } }) }));
vi.mock("@/features/workspace/hooks/use-jump-to-run", () => ({ useJumpToRun: () => state.jump }));
vi.mock("@/features/workspace/hooks/use-chat-actions", () => ({ useChatActions: () => ({
  renameChat: vi.fn(), toggleChatPin: vi.fn(), archiveChat: vi.fn(), deleteChat: vi.fn(),
}) }));
vi.mock("@/features/bridge/hooks/use-bridge", () => ({ useBridgeStatus: () => ({}) }));
import { DeveloperChatList } from "./developer-chat-list";

const local = { id: "local", projectId: "mains", name: "Local", rootPath: "/repo", metadata: null } as Workspace;
const worktree = { id: "tree", projectId: "mains", name: "Login", rootPath: "/trees/login", metadata: { worktree: { enabled: true } } } as Workspace;
const makeChat = (id: string, title: string, workspaceId: string): RecentRun => ({
  id, title, goal: title, workspaceId, spaceId: "codex-space", providerId: "codex", mode: "developer",
  collectionId: null, status: "succeeded", pinnedAt: null, isArchived: false, updatedAt: Date.now(),
} as RecentRun);
const gitStates = new Map([["local", { workspaceId: "local", branch: "main", pathExists: true }],
  ["tree", { workspaceId: "tree", branch: "codex/login", pathExists: true }]]);
beforeEach(() => {
  state.projects = [{ id: "mains", name: "mains", rootPath: "/repo", icon: null, sortOrder: 0, isArchived: false } as Project];
  state.chats = [makeChat("review", "Review changes", "local"), makeChat("fix", "Fix login", "tree")];
  state.jump.mockReset();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(searchQuery = "") {
  const store = configureStore({ reducer: { workspace: workspaceReducer, appSettings: appSettingsReducer,
    backends: () => ({ activeBackendId: null }) } });
  function Location() { return <output aria-label="Location">{useLocation().pathname}</output>; }
  render(<Provider store={store}><MemoryRouter initialEntries={["/code/local"]}>
    <DeveloperChatList workspaces={[local, worktree]} gitStateByWorkspaceId={gitStates} searchQuery={searchQuery}
      pendingClones={[]} onCancelClone={vi.fn()} onRetryClone={vi.fn()} onDismissClone={vi.fn()} />
    <Location />
  </MemoryRouter></Provider>);
  return store;
}

describe("developer project chat sidebar", () => {
  it("keeps legacy pinned chats under their project without pin controls or a Pinned group", () => {
    state.chats[0].pinnedAt = Date.now();
    setup();
    const group = screen.getByText("mains").parentElement!.parentElement!;
    expect(within(group).getByRole("button", { name: /^Review changes/ })).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
    expect(screen.queryByRole("button", { name: /^(Unpin|Pin) chat$/ })).toBeNull();
  });

  it("renders chat titles directly under the project, marks worktrees, and opens the owning chat", () => {
    setup();
    const group = screen.getByText("mains").parentElement!.parentElement!;
    expect(within(group).getByRole("button", { name: /^Review changes/ })).toBeTruthy();
    const fix = within(group).getByRole("button", { name: /^Fix login/ });
    expect(within(fix).getByRole("img", { name: "Worktree: codex/login" })).toBeTruthy();
    expect(screen.queryByText("Local")).toBeNull();
    fireEvent.click(fix);
    expect(state.jump).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "fix", workspaceId: "tree" }));
    expect(screen.queryByRole("button", { name: "Workspace chats" })).toBeNull();
  });

  it("shows five chats initially and reveals older project chats with Show more", () => {
    state.chats = Array.from({ length: 6 }, (_, index) => makeChat(`chat-${index}`, `Chat ${index}`, "local"));
    setup();
    expect(screen.queryByRole("button", { name: /^Chat 5/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByRole("button", { name: /^Chat 5/ })).toBeTruthy();
  });

  it("starts a new conversation in the project's existing checkout", () => {
    const store = setup();
    fireEvent.click(screen.getByRole("button", { name: "New chat in mains" }));
    expect(store.getState().workspace.activeWorkspaceId).toBe("local");
    expect(store.getState().workspace.activeTab).toBe("new-run");
    expect(screen.getByRole("status", { name: "Location" }).textContent).toBe("/code/local");
  });

  it("keeps the original workspace view accessible from the sidebar menu", () => {
    const store = setup();
    fireEvent.click(screen.getByRole("button", { name: "Sidebar view" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Chats by project" }));
    expect(store.getState().appSettings.developerSidebarView).toBe("chats");
    fireEvent.click(screen.getByRole("button", { name: "Sidebar view" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Workspaces" }));
    expect(store.getState().appSettings.developerSidebarView).toBe("workspaces");
  });

  it("filters by chat title while preserving the correct project heading", () => {
    setup("login");
    expect(screen.getByText("mains")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Fix login/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Review changes/ })).toBeNull();
  });
});
