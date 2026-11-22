// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceData } from "./use-workspace-data";

const fixture = vi.hoisted(() => ({
  workspaces: [{ id: "bridge-workspace", isReplica: true }],
}));
vi.mock("@/lib/redux/hooks", () => ({
  useAppSelector: (select: (state: unknown) => unknown) =>
    select({ workspace: { activeWorkspaceIdByProvider: { codex: "bridge-workspace" } } }),
}));
vi.mock("@/lib/redux/api/workspaceApi", () => ({
  useListWorkspacesQuery: () => ({ data: fixture.workspaces }),
  useGetWorkspaceQuery: () => ({}),
}));
vi.mock("@/lib/redux/api/providersApi", () => ({ useGetProvidersByKindQuery: () => ({}) }));

function open(path: string) {
  return renderHook(() => useWorkspaceData("codex", "developer"), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/code/:workspaceId?" element={children} /></Routes>
    </MemoryRouter>,
  });
}

afterEach(() => cleanup());

describe("Code workspace selection", () => {
  it("opens only an owned workspace by default, even with a saved Bridge workspace", () => {
    fixture.workspaces = [{ id: "bridge-workspace", isReplica: true }, { id: "local-workspace", isReplica: false }];
    expect(open("/code").result.current.workspaceId).toBe("local-workspace");
  });

  it("keeps Code home empty with only Bridge workspaces and still opens an explicitly selected replica", () => {
    fixture.workspaces = [{ id: "bridge-workspace", isReplica: true }];
    expect(open("/code").result.current.currentWorkspace).toBeNull();
    expect(open("/code/bridge-workspace").result.current.currentWorkspace?.isReplica).toBe(true);
  });
});
