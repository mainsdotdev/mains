// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection, Workspace } from "@/lib/redux/api";
import { NewConversationContextSelect } from "./new-conversation-context-select";
import { listenForCommandMenuQuickActions } from "@/features/command-menu/command-menu-bridge";

const data = vi.hoisted(() => ({
  mode: "work",
  collections: [{ id: "trips", name: "Trips", icon: null }, { id: "work", name: "Work", icon: null }, { id: "archived", name: "Archived", isArchived: true }],
  projects: [{ id: "mains", name: "mains", icon: null }, { id: "other", name: "Other", icon: null }],
  workspaces: [
    { id: "ws-1", name: "mains", projectId: "mains" },
    { id: "ws-2", name: "mains", projectId: "mains" },
    { id: "ws-3", name: "other", projectId: "other" },
    { id: "ws-missing", name: "missing", projectId: null },
    { id: "ws-archived", name: "Archived", projectId: null, isArchived: true },
  ],
  gitStates: [
    { workspaceId: "ws-1", branch: "main", pathExists: true },
    { workspaceId: "ws-2", branch: "feature/new", pathExists: true },
    { workspaceId: "ws-3", branch: "main", pathExists: true },
    { workspaceId: "ws-missing", branch: null, pathExists: false },
  ],
}));

vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: data.mode }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useListCollectionsQuery: () => ({ data: data.collections }),
  useListProjectsQuery: () => ({ data: data.projects }),
  useListWorkspacesQuery: () => ({ data: data.workspaces }),
  useListWorkspaceGitStatesQuery: () => ({ data: data.gitStates }),
}));

beforeEach(() => { data.mode = "work"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const trips: Pick<Collection, "id" | "name" | "icon"> = { id: "trips", name: "Trips", icon: null };

function setup(project?: Pick<Collection, "id" | "name" | "icon">, workspace: Pick<Workspace, "id" | "name" | "projectId"> | null = null) {
  const onChange = vi.fn();
  render(<NewConversationContextSelect workspace={workspace} project={project} onChange={onChange} />);
  const trigger = screen.getByRole("button");
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    top: 400, bottom: 432, left: 200, right: 380, width: 180, height: 32, x: 200, y: 400,
    toJSON: () => ({}),
  });
  return { onChange, trigger, user: userEvent.setup() };
}

describe("new conversation context selector", () => {
  it.each(["work", "chat"])("selects projects in %s and always opens above the trigger", async (mode) => {
    data.mode = mode;
    const { user, trigger, onChange } = setup(trips);
    expect(trigger.textContent).toBe("Trips");
    await user.click(trigger);
    const menu = screen.getByRole("menu", { name: "Select project" });
    // There is enough space below, but this picker still opens upward.
    expect(Number.parseFloat(menu.style.top)).toBeLessThan(400);
    expect(menu.style.transformOrigin).toBe("bottom left");
    expect(screen.getByRole("menuitemradio", { name: "Trips" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Archived")).toBeNull();
    await user.click(screen.getByRole("menuitemradio", { name: "Work" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ collectionId: "work" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("can detach the draft from its project", async () => {
    const { user, trigger, onChange } = setup(trips);
    await user.click(trigger);
    await user.click(screen.getByRole("menuitemradio", { name: "No project" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ collectionId: null });
  });

  it("shows project and branch on each row and selects the exact workspace", async () => {
    data.mode = "developer";
    const { user, trigger, onChange } = setup(undefined, data.workspaces[1]);
    expect(trigger.textContent).toBe("mains / feature/new");
    await user.click(trigger);
    expect(screen.getByRole("menuitemradio", { name: "mains / feature/new" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("Archived")).toBeNull();
    expect((screen.getByRole("menuitemradio", { name: "missing" }) as HTMLButtonElement).disabled).toBe(true);
    const choices = screen.getAllByRole("menuitemradio", { name: / \/ main$/ });
    expect(choices).toHaveLength(2);
    await user.click(choices[1]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws-3" });
  });

  it("supports keyboard selection and dismissal without changing the context", async () => {
    const { user, trigger, onChange } = setup(trips);
    trigger.focus();
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search projects" }));
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await user.keyboard("{ArrowUp}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ collectionId: "work" });
  });

  it("searches both project and branch names and keeps the new-project action available", async () => {
    data.mode = "developer";
    const { user, trigger, onChange } = setup(undefined, data.workspaces[0]);
    await user.click(trigger);
    const search = screen.getByRole("textbox", { name: "Search projects" });
    expect(document.activeElement).toBe(search);
    await user.type(search, "MAINS");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(2);
    await user.clear(search);
    await user.type(search, "no match");
    expect(screen.queryByRole("menuitemradio")).toBeNull();
    expect(screen.getByText("No matching projects or branches")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "New project" })).toBeTruthy();
    await user.clear(search);
    await user.type(search, "feature");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ workspaceId: "ws-2" });
  });

  it("filters chat projects and keeps Home/End available to edit the search", async () => {
    const { user, trigger, onChange } = setup(trips);
    await user.click(trigger);
    const search = screen.getByRole("textbox", { name: "Search projects" }) as HTMLInputElement;
    await user.type(search, "work");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(1);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(search);
    expect(search.selectionStart).toBe(0);
    await user.keyboard("{End}");
    expect(search.selectionStart).toBe(4);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ collectionId: "work" });
  });

  it.each([
    ["developer", "open-add-project"],
    ["work", "create-collection-project"],
    ["chat", "create-collection-project"],
  ])("opens the sidebar's project flow in %s mode", async (mode, action) => {
    data.mode = mode;
    const handler = vi.fn();
    const stopListening = listenForCommandMenuQuickActions(handler);
    try {
      const { user, trigger, onChange } = setup();
      await user.click(trigger);
      await user.click(screen.getByRole("menuitem", { name: "New project" }));
      expect(handler).toHaveBeenCalledExactlyOnceWith(action);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      stopListening();
    }
  });

  it("toggles shut on the trigger and dismisses outside clicks", async () => {
    const { user, trigger, onChange } = setup();
    expect(trigger.textContent).toBe("No project");
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    await user.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
