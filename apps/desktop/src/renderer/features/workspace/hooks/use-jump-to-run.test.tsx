// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJumpToRun, type RunJumpTarget } from "./use-jump-to-run";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), switchSpace: vi.fn(), updateSpace: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/redux/hooks", () => ({ useAppDispatch: () => mocks.dispatch }));
vi.mock("@/components/ui", () => ({ toast: { error: mocks.error } }));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({ activeSpaceId: "space-a", spaces: [
  { id: "space-a", providerId: "codex", mode: "developer" },
  { id: "space-b", providerId: "codex", mode: "developer" },
] }) }));
vi.mock("@/lib/redux/api", () => ({
  useSetActiveSpaceMutation: () => [mocks.switchSpace], useUpdateSpaceMutation: () => [mocks.updateSpace],
}));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const run: RunJumpTarget = { id: "worktree-chat", spaceId: "space-b", providerId: "codex", mode: "developer",
  workspaceId: "tree", collectionId: null };
function setup() {
  return renderHook(() => ({ jump: useJumpToRun(), path: useLocation().pathname }), {
    wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={["/code/local"]}>{children}</MemoryRouter>,
  });
}
describe("opening project chats", () => {
  it("publishes the selected chat only after its space switch completes", async () => {
    let resolve!: () => void;
    mocks.switchSpace.mockReturnValue({ unwrap: () => new Promise<void>((done) => { resolve = done; }) });
    const view = setup(); let pending!: Promise<void>;
    act(() => { pending = view.result.current.jump(run); });
    expect(view.result.current.path).toBe("/");
    expect(mocks.dispatch).not.toHaveBeenCalled();
    await act(async () => { resolve(); await pending; });
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "workspace/setPendingRunId", payload: run.id });
    expect(view.result.current.path).toBe("/code/tree");
  });
  it("does not leave a pending chat to open later when switching space fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.switchSpace.mockReturnValue({ unwrap: async () => { throw new Error("Offline"); } });
    const view = setup();
    await act(async () => { await view.result.current.jump(run); });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("Failed to switch space");
  });
  it("opens a same-space chat in its worktree without creating or switching a space", async () => {
    const view = setup();
    await act(async () => { await view.result.current.jump({ ...run, spaceId: "space-a" }); });
    expect(mocks.switchSpace).not.toHaveBeenCalled();
    expect(view.result.current.path).toBe("/code/tree");
    expect(mocks.dispatch).toHaveBeenCalledWith({ type: "workspace/setPendingRunId", payload: run.id });
  });
});
