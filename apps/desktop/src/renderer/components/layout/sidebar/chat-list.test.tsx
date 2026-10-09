// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentRun } from "@/lib/redux/api";
import atlasReducer, { updateAtlasPageChat } from "@/lib/redux/slices/atlasSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { SidebarChatList } from "./chat-list";

const mocks = vi.hoisted(() => ({
  runs: [] as RecentRun[],
  activeSpaceId: "page-space",
  setActiveSpace: vi.fn(),
  updateSpace: vi.fn(),
}));
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useListCollectionsQuery: () => ({ data: [] }),
  useRemoveCollectionMutation: () => [vi.fn()],
  useReorderCollectionsMutation: () => [vi.fn(), { isLoading: false }],
  useSetActiveSpaceMutation: () => [mocks.setActiveSpace],
  useUpdateSpaceMutation: () => [mocks.updateSpace],
}));
vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({
    activeSpaceId: mocks.activeSpaceId,
    spaces: [{ id: "page-space", providerId: "codex", mode: "developer" }],
  }),
}));
vi.mock("./use-recent-chats", () => ({
  useRecentChats: () => ({ data: mocks.runs, isLoading: false }),
}));
vi.mock("@/features/workspace/hooks/use-chat-actions", () => ({
  useChatActions: () => ({
    renameChat: vi.fn(), toggleChatPin: vi.fn(), moveChat: vi.fn(),
    archiveChat: vi.fn(), deleteChat: vi.fn(),
  }),
}));
vi.mock("./collection-settings-modal", () => ({ CollectionSettingsModal: () => null }));

const run: RecentRun = {
  id: "page-chat", title: "Tokyo Running Guide", goal: "Create a guide",
  accountId: "account", spaceId: "page-space", mode: "work", providerId: "codex",
  configSnapshot: { atlasPageId: "tokyo-page" },
  workspaceId: null, collectionId: null, model: null, status: "succeeded",
  systemPrompt: null, toolPolicySnapshot: null, startedAt: null, endedAt: null,
  lastError: null, sessionId: null, isArchived: false, pinnedAt: null,
  createdAt: 1, updatedAt: 1,
};
const ownerKey = '["remote","account"]';
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
function setup() {
  const store = configureStore({ reducer: {
    atlas: atlasReducer,
    workspace: workspaceReducer,
    appSettings: () => ({ workspaceGroupExpanded: {} }),
    backends: () => ({ activeBackendId: "remote" }),
  } });
  render(<Provider store={store}><MemoryRouter initialEntries={["/code/runs/other-chat"]}>
    <SidebarChatList searchQuery="" onNewChatInCollection={vi.fn()} onCreateCollection={vi.fn()} />
    <Location />
  </MemoryRouter></Provider>);
  return { store, user: userEvent.setup() };
}
beforeEach(() => {
  mocks.runs = [run];
  mocks.activeSpaceId = "page-space";
  mocks.setActiveSpace.mockReset().mockReturnValue({ unwrap: () => Promise.resolve() });
  mocks.updateSpace.mockReset().mockReturnValue({ unwrap: () => Promise.resolve() });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sidebar chat Page navigation", () => {
  it("opens the Page with this chat selected, preserves its draft, and keeps the title's chat navigation", async () => {
    mocks.runs = [run, { ...run, id: "ordinary-chat", title: "Ordinary chat", configSnapshot: null }];
    const { store, user } = setup();
    act(() => store.dispatch(updateAtlasPageChat({ ownerKey, id: "tokyo-page",
      patch: { runId: "another-chat", spaceId: "page-space", draft: "Keep this Page draft", mode: "icon" } })));
    const row = screen.getByText(run.title!).closest('[role="button"]') as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Open page" }));
    expect(screen.getByTestId("location").textContent).toBe("/atlas/tokyo-page");
    expect(store.getState().atlas.byOwner[ownerKey].chats["tokyo-page"]).toEqual({
      runId: run.id, spaceId: run.spaceId, draft: "Keep this Page draft", mode: "details",
    });
    expect(store.getState().atlas.byOwner['["local","account"]']).toBeUndefined();
    expect(store.getState().workspace.pendingRunId).toBeNull();
    expect(mocks.setActiveSpace).not.toHaveBeenCalled();
    const ordinaryRow = screen.getByText("Ordinary chat").closest('[role="button"]') as HTMLElement;
    expect(within(ordinaryRow).queryByRole("button", { name: "Open page" })).toBeNull();

    const icon = within(row).getByRole("button", { name: "Open page" });
    icon.focus();
    await user.keyboard("{Enter}");
    expect(store.getState().workspace.pendingRunId).toBeNull();
    await user.click(screen.getByText(run.title!));
    expect(screen.getByTestId("location").textContent).toBe(`/code/runs/${run.id}`);
    expect(store.getState().workspace.pendingRunId).toBe(run.id);
  });

  it("waits for the chat's own Space before opening its Page without changing the saved mode", async () => {
    mocks.activeSpaceId = "other-space";
    let finishSwitch!: () => void;
    const switching = new Promise<void>((resolve) => { finishSwitch = resolve; });
    mocks.setActiveSpace.mockReturnValue({ unwrap: () => switching });
    const { store, user } = setup();
    await user.click(screen.getByRole("button", { name: "Open page" }));
    expect(mocks.setActiveSpace).toHaveBeenCalledExactlyOnceWith("page-space");
    expect(store.getState().atlas.byOwner[ownerKey]).toBeUndefined();
    expect(screen.getByTestId("location").textContent).toBe("/");
    await act(async () => finishSwitch());
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/atlas/tokyo-page"));
    expect(store.getState().atlas.byOwner[ownerKey].chats["tokyo-page"].runId).toBe(run.id);
    expect(mocks.updateSpace).not.toHaveBeenCalled();
    expect(store.getState().workspace.pendingRunId).toBeNull();
  });

  it("keeps the previous Page chat selection when switching Space fails", async () => {
    mocks.activeSpaceId = "other-space";
    const failure = new Error("Switch failed");
    mocks.setActiveSpace.mockReturnValue({ unwrap: () => Promise.reject(failure) });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, user } = setup();
    act(() => store.dispatch(updateAtlasPageChat({ ownerKey, id: "tokyo-page",
      patch: { runId: "previous-chat", spaceId: "page-space", draft: "Keep draft", mode: "input" } })));
    await user.click(screen.getByRole("button", { name: "Open page" }));
    await waitFor(() => expect(errorLog).toHaveBeenCalledWith("Failed to switch space for page:", failure));
    expect(store.getState().atlas.byOwner[ownerKey].chats["tokyo-page"]).toEqual({
      runId: "previous-chat", spaceId: "page-space", draft: "Keep draft", mode: "input",
    });
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(store.getState().workspace.pendingRunId).toBeNull();
  });
});
