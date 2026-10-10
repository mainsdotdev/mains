// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import workspaceReducer, { setReviewFileReviewed } from "@/lib/redux/slices/workspaceSlice";
import backendsReducer from "@/lib/redux/slices/backendsSlice";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { workspaceReviewKey } from "../../../../shared/ui-state-keys";
import { reviewFiles } from "../lib/review-diff";
import { WorkspaceReview } from "./workspace-review";

const query = vi.hoisted(() => ({
  currentData: undefined as { diffText: string; files: string[] } | null | undefined,
  isFetching: false,
}));
const resyncWorkspaceDiff = vi.hoisted(() => vi.fn(() => ({ unwrap: () => Promise.resolve(null) })));
const virtualizer = vi.hoisted(() => ({ markDOMDirty: vi.fn(), scrollTo: vi.fn(), getOffsetInScrollContainer: () => 0 }));
vi.mock("@/lib/redux/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/redux/api")>(),
  useGetLatestWorkspaceDiffQuery: () => query,
  useResyncWorkspaceDiffMutation: () => [resyncWorkspaceDiff, { isLoading: false }],
}));
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: ({ fileDiff }: { fileDiff: { name: string } }) => <div data-testid={`diff-${fileDiff.name}`} />,
  Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useVirtualizer: () => virtualizer,
}));
vi.mock("./review-diff-provider", () => ({ ReviewDiffProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../hooks/use-review-panel-transition", () => ({
  useReviewPanelTransition: () => ({ anchorRef: { current: null }, expandedBoundsRef: { current: null }, panelStyle: {}, headerStyle: {}, bodyStyle: {} }),
}));
vi.mock("@/hooks/use-is-dark-mode", () => ({ useIsDarkMode: () => false }));

const patch = (path: string, value = "new") => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+${value}\n`;
const snapshot = (value = "new") => ({ diffText: patch("a.ts", value) + patch("b.ts"), files: ["a.ts", "b.ts"] });
const props = {
  workspaceId: "ws", rootPath: "/repo", isExpanded: false, onToggleExpanded: () => {},
  chatVisible: false, onToggleChat: () => {}, setChatHost: () => {}, onCommentAdded: () => {},
};
const setup = () => {
  const store = configureStore({ reducer: { workspace: workspaceReducer, backends: backendsReducer, appSettings: appSettingsReducer } });
  const view = (overrides: Partial<typeof props> = {}) => <Provider store={store}><WorkspaceReview {...props} {...overrides} /></Provider>;
  return { store, view };
};
beforeEach(() => { query.currentData = snapshot(); query.isFetching = false; resyncWorkspaceDiff.mockClear(); });
afterEach(cleanup);

describe("workspace reviewed files", () => {
  it("resyncs on each Review opening without resyncing for file or layout interactions", () => {
    const { view } = setup();
    const first = render(view());
    expect(resyncWorkspaceDiff).toHaveBeenCalledExactlyOnceWith("ws");
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle changes in a.ts" }));
    first.rerender(view({ isExpanded: true }));
    expect(resyncWorkspaceDiff).toHaveBeenCalledTimes(1);
    first.unmount();
    render(view());
    expect(resyncWorkspaceDiff).toHaveBeenCalledTimes(2);
    expect(resyncWorkspaceDiff).toHaveBeenLastCalledWith("ws");
  });

  it("resyncs the new workspace when the Review target changes", () => {
    const { view } = setup();
    const { rerender } = render(view());
    rerender(view({ workspaceId: "ws-2" }));
    expect(resyncWorkspaceDiff.mock.calls).toEqual([["ws"], ["ws-2"]]);
  });

  it("collapses a reviewed file, persists a manual reopen and expands when unchecked", () => {
    const { store, view } = setup();
    const first = render(view());
    const toggle = screen.getByRole("button", { name: "Toggle changes in a.ts" });
    const checkbox = screen.getByRole("checkbox", { name: "Reviewed a.ts" }) as HTMLInputElement;
    expect(checkbox.closest("button")).toBeNull();
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diff-a.ts")).toBeNull();
    expect(screen.getByText("Uncommitted changes · 2 files · 1 reviewed")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByTestId("diff-a.ts")).toBeTruthy();
    expect(checkbox.checked).toBe(true);
    first.unmount();
    render(view());
    expect((screen.getByRole("checkbox", { name: "Reviewed a.ts" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Toggle changes in a.ts" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Toggle changes in a.ts" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed a.ts" }));
    expect(screen.getByText("Uncommitted changes · 2 files · 0 reviewed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle changes in a.ts" }).getAttribute("aria-expanded")).toBe("true");
    expect(store.getState().workspace.reviewFileStatesByWorkspace).toEqual({});
  });

  it("unchecks only the changed file when a fresh diff arrives", () => {
    const { store, view } = setup();
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed a.ts" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed b.ts" }));
    query.currentData = snapshot("changed");
    rerender(view());
    expect((screen.getByRole("checkbox", { name: "Reviewed a.ts" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Reviewed b.ts" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Toggle changes in a.ts" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Toggle changes in b.ts" }).getAttribute("aria-expanded")).toBe("false");
    expect(Object.keys(store.getState().workspace.reviewFileStatesByWorkspace[workspaceReviewKey(null, "ws")])).toEqual(["b.ts"]);
  });

  it("retains marks while loading, then clears them for an authoritative empty diff", () => {
    const { store, view } = setup();
    const file = reviewFiles(snapshot().diffText, ["a.ts"])[0];
    act(() => store.dispatch(setReviewFileReviewed({ backendId: null, workspaceId: "ws", path: file.path, patchId: file.patchId, reviewed: true })));
    query.currentData = undefined;
    query.isFetching = true;
    const { rerender } = render(view());
    const key = workspaceReviewKey(null, "ws");
    expect(store.getState().workspace.reviewFileStatesByWorkspace[key]).toBeTruthy();
    query.currentData = null;
    query.isFetching = false;
    rerender(view());
    expect(store.getState().workspace.reviewFileStatesByWorkspace[key]).toBeUndefined();
  });

  it("retains manual collapse choices and reviewed auto-collapse after remount", () => {
    const { view } = setup();
    const first = render(view());
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle changes in b.ts" }));
    first.unmount();
    render(view());
    expect(screen.queryByTestId("diff-a.ts")).toBeNull();
    expect(screen.queryByTestId("diff-b.ts")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Reviewed b.ts" }) as HTMLInputElement).checked).toBe(false);
  });

  it("persists opening a reviewed file through the jump-to-file toolbar", () => {
    const { view } = setup();
    const first = render(view());
    fireEvent.click(screen.getByRole("checkbox", { name: "Reviewed a.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Jump to file" }));
    fireEvent.click(screen.getByRole("option", { name: "a.ts" }));
    expect(screen.getByTestId("diff-a.ts")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Reviewed a.ts" }) as HTMLInputElement).checked).toBe(true);
    first.unmount();
    render(view());
    expect(screen.getByTestId("diff-a.ts")).toBeTruthy();
  });

  it("disables reviewed marking when the snapshot contains no verifiable file version", () => {
    query.currentData = { diffText: "", files: ["missing.bin"] };
    const { view } = setup();
    render(view());
    expect((screen.getByRole("checkbox", { name: "Reviewed missing.bin" }) as HTMLInputElement).disabled).toBe(true);
  });
});
