// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
