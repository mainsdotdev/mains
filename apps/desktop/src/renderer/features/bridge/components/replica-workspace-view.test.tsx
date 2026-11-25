// @vitest-environment jsdom

import { configureStore } from "@reduxjs/toolkit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import type { Run, Workspace } from "@/lib/redux/api";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { ReplicaWorkspaceView } from "./replica-workspace-view";

const fixture = vi.hoisted(() => ({ runs: [] as Run[], list: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetRunByIdQuery: (id: string) => ({ currentData: fixture.runs.find((run) => run.id === id) }),
  useGetRunsByWorkspaceQuery: (args: unknown, options: { skip: boolean }) => {
    fixture.list(args, options);
    return { currentData: options.skip ? undefined : fixture.runs };
  },
}));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({ activeSpaceId: "codex-space" }) }));
vi.mock("../hooks/use-bridge", () => ({ useBridgeRun: () => ({}) }));
vi.mock("@/features/workspace/hooks/use-run-event-refetch", () => ({ useRunEventRefetch: () => {} }));
vi.mock("@/features/workspace/hooks/use-run-history", () => ({
  useRunHistory: () => ({ load: () => {}, runTurns: {}, runEvents: {} }),
}));
vi.mock("@/features/workspace/components/workspace-events", () => ({
  WorkspaceEvents: ({ activeTab }: { activeTab: string }) => <output aria-label="Transcript">{activeTab}</output>,
}));
vi.mock("@/features/workspace/components/todo-summary-bar", () => ({
  TodoSummaryBar: () => null, parseStructuralPlanSnapshot: () => null,
}));

const replica = { id: "source-workspace", name: "Source workspace", isReplica: true, ownerBackendId: "source" } as Workspace;
const chat = (id: string, title: string, mode: Run["mode"]): Run => ({
  id, title, mode, workspaceId: replica.id, providerId: "codex", isReplica: true, ownerBackendId: "source", status: "succeeded",
} as Run);

function Header() {
  const { header } = useMainHeader();
  return <header aria-label="Main header">{header}</header>;
}

function open(mode: "developer" | "work", initialRun?: Run) {
  const store = configureStore({ reducer: {
    workspace: workspaceReducer, backends: () => ({ activeBackendId: null }), appSettings: () => ({ sidebarCollapsed: false }),
  } });
  render(<Provider store={store}>
    <MemoryRouter initialEntries={[initialRun ? `/code/runs/${initialRun.id}` : "/code/source-workspace"]}>
      <MainHeaderProvider>
        <Header />
        <Routes><Route path={initialRun ? "/code/runs/:runId" : "/code/:workspaceId"} element={
          <ReplicaWorkspaceView workspace={replica} initialRun={initialRun} mode={mode} providerId="codex" variant="codex" />
        } /></Routes>
      </MainHeaderProvider>
    </MemoryRouter>
  </Provider>);
}

afterEach(() => { cleanup(); fixture.list.mockClear(); });

describe("Bridge conversation navigation", () => {
  it("keeps Code replicas out of the main header and lets users switch via the workspace picker", () => {
    fixture.runs = [chat("one", "First Code chat", "developer"), chat("two", "Second Code chat", "developer"), chat("work", "Work chat", "work")];
    open("developer");
    expect(screen.getByRole("banner", { name: "Main header" }).textContent).toBe("");
    expect(screen.getByLabelText("Transcript").textContent).toBe("one");

    fireEvent.click(screen.getByRole("button", { name: "Workspace conversations" }));
    const list = screen.getByRole("listbox");
    expect(within(list).queryByRole("option", { name: "Work chat" })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "Second Code chat" }));
    expect(screen.getByLabelText("Transcript").textContent).toBe("two");
  });

  it("opens a Work replica without loading a Code workspace list or adding a header tab", () => {
    const work = chat("work", "Work chat", "work");
    fixture.runs = [work, chat("code", "Code chat", "developer")];
    open("work", work);
    expect(fixture.list).toHaveBeenCalledWith(expect.objectContaining({ mode: "work" }), { skip: true });
    expect(screen.getByRole("banner", { name: "Main header" }).textContent).toBe("");
    expect(screen.getByLabelText("Transcript").textContent).toBe("work");
    expect(screen.queryByRole("button", { name: "Workspace conversations" })).toBeNull();
  });
});
