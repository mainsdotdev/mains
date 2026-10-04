// @vitest-environment jsdom

import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The row only needs these two reads; neither is what the branch editor is
// about, so they are stubbed rather than backed by a store.
vi.mock("@/lib/redux/api", () => ({
  useGetInstalledAppsQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/lib/redux/api/workspaceApi", () => ({
  useGetLatestWorkspaceDiffSummaryQuery: () => ({ data: undefined }),
}));

import WorkspaceItem from "./workspace-item";

// The dropdown restores focus a frame after it closes; hold the frame so the
// test can assert what the editor's focus survives.
let frameCallbacks: FrameRequestCallback[] = [];

function flushFrames() {
  const pending = frameCallbacks;
  frameCallbacks = [];
  for (const callback of pending) callback(0);
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  frameCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openBranchEditor(onRenameBranch: (name: string) => void) {
  const user = userEvent.setup();
  render(
    createElement(WorkspaceItem, {
      id: "ws-1",
      name: "mains",
      branch: "feature/x",
      onRenameBranch,
    }),
  );

  await user.click(screen.getByRole("button", { name: "Workspace options" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename branch" }));

  return {
    user,
    input: screen.getByRole("textbox", {
      name: "Branch name",
    }) as HTMLInputElement,
  };
}

/** The editor is unmounted once the rename settles, either way it settled. */
function queryBranchEditor() {
  return screen.queryByRole("textbox", { name: "Branch name" });
}

describe("WorkspaceItem branch rename", () => {
  it("opens a focused editor seeded with the current branch", async () => {
    const { input } = await openBranchEditor(vi.fn());

    expect(input.value).toBe("feature/x");
    expect(document.activeElement).toBe(input);

    // The menu's focus restore runs here. Losing focus to it would fire the
    // editor's blur-commit and close it again — the "menu item does nothing"
    // the fix is about.
    flushFrames();
    expect(document.activeElement).toBe(input);
  });

  it("renames on Enter", async () => {
    const onRenameBranch = vi.fn();
    const { user, input } = await openBranchEditor(onRenameBranch);
    flushFrames();

    await user.clear(input);
    await user.type(input, "feature/renamed{Enter}");

    expect(onRenameBranch).toHaveBeenCalledExactlyOnceWith("feature/renamed");
    expect(queryBranchEditor()).toBeNull();
  });

  it("keeps the branch on Escape", async () => {
    const onRenameBranch = vi.fn();
    const { user, input } = await openBranchEditor(onRenameBranch);
    flushFrames();

    await user.clear(input);
    await user.type(input, "throwaway{Escape}");

    expect(onRenameBranch).not.toHaveBeenCalled();
    expect(queryBranchEditor()).toBeNull();
  });
});

describe("WorkspaceItem project actions", () => {
  it("keeps the native browser behind the workspace menu and releases suppression after an action", async () => {
    const setSuppressed = vi.fn<(lease: string, suppressed: boolean) => void>();
    const setVisible = vi.fn();
    vi.stubGlobal("api", { browser: { setSuppressed, setVisible } });
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(createElement(WorkspaceItem, { id: "ws-1", name: "mains", onArchive }));
    expect(setSuppressed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Workspace options" }));
    expect(setSuppressed).toHaveBeenCalledExactlyOnceWith(expect.any(String), true);
    const [lease] = setSuppressed.mock.calls[0];
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "Workspace actions" })).toBeNull();
    expect(setSuppressed.mock.calls).toEqual([[lease, true], [lease, false]]);
    expect(setVisible).not.toHaveBeenCalled();
  });

  it("separates workspace, project, and lifecycle actions", async () => {
    const user = userEvent.setup();
    render(
      createElement(WorkspaceItem, {
        id: "ws-1",
        name: "mains",
        projectId: "project-1",
        branch: "feature/x",
        onRenameBranch: vi.fn(),
        onCreateWorktree: vi.fn(),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Workspace options" }));

    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("creates a worktree from the workspace menu", async () => {
    const user = userEvent.setup();
    const onCreateWorktree = vi.fn();
    render(
      createElement(WorkspaceItem, {
        id: "ws-1",
        name: "mains",
        projectId: "project-1",
        onCreateWorktree,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Workspace options" }));
    await user.click(screen.getByRole("menuitem", { name: "New worktree" }));

    expect(onCreateWorktree).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("menu", { name: "Workspace actions" }),
    ).toBeNull();
  });
});

describe("WorkspaceItem quick actions", () => {
  it("requests deletion through the existing handler without selecting the workspace", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onClick = vi.fn();
    render(
      createElement(WorkspaceItem, {
        id: "ws-1",
        name: "mains",
        onDelete,
        onClick,
      }),
    );
    const row = screen.getByRole("button", { name: "mains" });
    fireEvent.keyDown(row, { key: "ArrowRight" });
    act(flushFrames);
    const card = screen.getByRole("dialog", { name: "mains" });
    expect(
      within(card).queryByRole("button", { name: "Open workspace" }),
    ).toBeNull();
    await user.click(
      within(card).getByRole("button", { name: "Delete workspace" }),
    );
    act(flushFrames);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renames from the hover card without selecting or dragging the workspace", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onRenameBranch = vi.fn();
    const onPointerDown = vi.fn();
    render(
      createElement(WorkspaceItem, {
        id: "ws-1",
        name: "mains",
        branch: "feature/x",
        rootPath: "/projects/mains",
        updatedAt: new Date(Date.now() - 7 * 60_000),
        onClick,
        onRenameBranch,
        sortHandle: {
          ref: vi.fn(),
          listeners: { onPointerDown },
          consumeDragClick: () => false,
        },
      }),
    );
    const row = screen.getByRole("button", { name: "mains feature/x" });
    fireEvent.keyDown(row, { key: "ArrowRight" });
    act(flushFrames);
    const card = screen.getByRole("dialog", { name: "mains" });
    expect(within(card).queryByText("/projects/mains")).toBeNull();
    expect(within(card).getByLabelText("Last updated 7m")).toBeTruthy();
    await user.click(
      within(card).getByRole("button", { name: "Rename branch" }),
    );
    act(flushFrames);
    const input = screen.getByRole("textbox", { name: "Branch name" });
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.clear(input);
    await user.type(input, "feature/quick-actions{Enter}");
    expect(onRenameBranch).toHaveBeenCalledExactlyOnceWith(
      "feature/quick-actions",
    );
    expect(onClick).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("offers the current pin state and runs its callback once", async () => {
    const user = userEvent.setup();
    const onTogglePin = vi.fn();
    render(
      createElement(WorkspaceItem, {
        id: "ws-1",
        name: "mains",
        isPinned: true,
        onTogglePin,
      }),
    );
    const row = screen.getByRole("button", { name: "mains" });
    fireEvent.keyDown(row, { key: "ArrowRight" });
    act(flushFrames);
    const button = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Unpin workspace",
    });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await user.click(button);
    act(flushFrames);
    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
