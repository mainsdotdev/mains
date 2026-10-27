// @vitest-environment jsdom
import { useState } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { fail, ok, type ServiceResponse } from "@mains/contracts/service-response";
import { WORKSPACE_CLONE_CANCELED, type CancelWorkspaceClonePayload } from "@mains/contracts/workspace-intake";
import { baseApi } from "@/lib/redux/api/baseApi";
import { useListWorkspacesQuery, type Workspace, type WorkspaceIntakePayload } from "@/lib/redux/api/workspaceApi";
import appSettingsReducer, { setWorkspaceListGrouping } from "@/lib/redux/slices/appSettingsSlice";
import backendsReducer, { setActiveBackend } from "@/lib/redux/slices/backendsSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { resetTransport, setTransport, type Transport } from "@/lib/transport";
import { Input, toast } from "@/components/ui";
import AddProjectModal from "@/components/layout/sidebar/add-project-modal";
import WorkspacesList from "@/components/layout/sidebar/workspace-list";
import { useSidebarActions } from "./use-sidebar-actions";

vi.mock("@/features/bridge/hooks/use-bridge", () => ({ useBridgeStatus: () => ({ data: undefined }) }));

vi.mock("@/hooks/use-active-space", () => ({
  useActiveSpace: () => ({ spaces: [], activeSpace: { id: "space", providerId: "codex", mode: "developer" } }),
}));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/platform")>(),
  useCapabilities: () => ({ nativeDialogs: false }),
}));

const jobs: Array<{
  payload: WorkspaceIntakePayload;
  finish: (result: ServiceResponse<unknown>) => void;
}> = [];
const cancellations: Array<{
  payload: CancelWorkspaceClonePayload;
  finish: (result: ServiceResponse<unknown>) => void;
}> = [];
let savedWorkspaces: Workspace[] = [];

function makeTransport(workspaces = savedWorkspaces): Transport {
  return {
    kind: "test",
    invoke: vi.fn(async (channel, args) => {
      if (channel === CHANNELS.account.get) return ok({ id: "account" });
      if (channel === CHANNELS.workspace.list) return ok([...workspaces]);
      if (channel === CHANNELS.projects.list) return ok(workspaces.map((workspace) => ({
        id: workspace.projectId, accountId: "account", name: workspace.name, sortOrder: 0, isArchived: false,
      })));
      if (channel === CHANNELS.workspace.getLatestDiffSummary) return ok(null);
      if (channel === CHANNELS.workspace.createFromSource) {
        return new Promise<ServiceResponse<unknown>>((finish) => jobs.push({
          payload: args![0] as WorkspaceIntakePayload, finish,
        }));
      }
      if (channel === CHANNELS.workspace.cancelClone) {
        return new Promise<ServiceResponse<unknown>>((finish) => cancellations.push({
          payload: args![0] as CancelWorkspaceClonePayload, finish,
        }));
      }
      throw new Error(`Unexpected channel: ${channel}`);
    }),
    subscribe: () => () => {},
    status: () => "connected",
    onStatusChange: () => () => {},
  };
}

function CloneSurface() {
  const actions = useSidebarActions();
  const { data: workspaces = [], isLoading } = useListWorkspacesQuery();
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={actions.handleOpenAddProjectModal}>Add Project</button>
      <button onClick={() => actions.handleOpenCloneFor("git@github.com:mainsdotdev/docs.git")}>Clone docs to this device</button>
      <button onClick={() => navigate("/code/other")}>Other workspace</button>
      <Input aria-label="Search workspaces" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
      <output data-testid="route">{location.pathname}</output>
      <WorkspacesList
        workspaces={workspaces}
        pendingClones={actions.pendingClones}
        onCancelClone={actions.handleCancelClone}
        onRetryClone={actions.handleRetryClone}
        onDismissClone={actions.handleDismissClone}
        gitStateByWorkspaceId={new Map(workspaces.map((workspace) => [workspace.id, { workspaceId: workspace.id, branch: "main", pathExists: true }]))}
        isLoading={isLoading}
        searchQuery={searchQuery}
      />
      {actions.addProjectTab && (
        <AddProjectModal
          activeTab={actions.addProjectTab}
          onTabChange={actions.handleAddProjectTabChange}
          isAddingLocal={actions.isAddingLocal}
          isCreating={actions.isCreatingProject}
          onAddLocal={actions.handleAddProject}
          onClone={actions.handleCloneRepo}
          cloneUrl={actions.cloneDraftUrl || undefined}
          onCreate={actions.handleCreateProject}
          onClose={actions.handleCloseAddProjectModal}
        />
      )}
    </>
  );
}

function harness(grouping: "project" | "none" = "project") {
  const store = configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer, appSettings: appSettingsReducer, backends: backendsReducer, workspace: workspaceReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(baseApi.middleware),
  });
  store.dispatch(setWorkspaceListGrouping(grouping));
  const view = render(<Provider store={store}><MemoryRouter initialEntries={["/code/existing"]}><CloneSurface /></MemoryRouter></Provider>);
  return { ...view, store };
}

async function submitClone(user: ReturnType<typeof userEvent.setup>, name = "website") {
  await user.click(screen.getByRole("button", { name: "Add Project" }));
  await user.type(screen.getByRole("textbox", { name: "Git URL" }), `https://github.com/mainsdotdev/${name}.git`);
  await user.type(screen.getByRole("textbox", { name: "Clone location" }), "/tmp/projects");
  await user.click(screen.getByRole("button", { name: "Clone" }));
}

async function completeClone(index: number, name = "website") {
  const workspace: Workspace = {
    id: `workspace-${name}`, accountId: "account", projectId: `project-${name}`, name,
    rootPath: `/tmp/projects/${name}`, repoUrl: `https://github.com/mainsdotdev/${name}.git`,
    baseBranch: "main", metadata: null, status: "backlog", isArchived: false,
    sortOrder: index, pinnedAt: null, createdAt: new Date(), updatedAt: new Date(),
  };
  await act(async () => {
    savedWorkspaces.push(workspace);
    jobs[index].finish(ok(workspace));
  });
}

beforeEach(() => {
  jobs.length = 0;
  cancellations.length = 0;
  savedWorkspaces = [];
  setTransport(makeTransport());
  vi.spyOn(toast, "success").mockReturnValue("success");
  vi.spyOn(toast, "error").mockReturnValue("error");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  resetTransport();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("background repository clones", () => {
  it("offers only cloning, prefilled, for a repository from another device", async () => {
    harness();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Clone docs to this device" }));
    screen.getByRole("dialog", { name: "Clone to this device" });
    expect((screen.getByRole("textbox", { name: "Git URL" }) as HTMLInputElement).value).toBe("git@github.com:mainsdotdev/docs.git");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Add from local")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Add Project" }));
    screen.getByRole("tablist", { name: "Project setup method" });
    expect((screen.getByRole("textbox", { name: "Git URL" }) as HTMLInputElement).value).toBe("");
    screen.getByText("Add from local");
  });

  it.each(["project", "none"] as const)("closes the modal and displays the first clone with %s grouping", async (grouping) => {
    const h = harness(grouping);
    const user = userEvent.setup();
    await submitClone(user);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("No projects yet")).toBeNull();
    expect(screen.getByText("website")).toBeTruthy();
    expect(screen.getByRole("status", { name: "website clone status" }).textContent).toContain("Cloning…");
    expect(screen.getByTestId("route").textContent).toBe("/code/existing");
    await completeClone(0);
    await waitFor(() => expect(screen.queryByText("Cloning…")).toBeNull());
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByTestId("route").textContent).toBe("/code/existing");
    const options = vi.mocked(toast.success).mock.calls[0][1]!;
    expect(options.action?.label).toBe("Open");
    act(() => options.action!.onClick());
    expect(screen.getByTestId("route").textContent).toBe("/code/workspace-website");
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("keeps concurrent clones independent and ignores duplicate submissions", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    await submitClone(user);
    expect(jobs).toHaveLength(1);
    await submitClone(user, "mains");
    expect(screen.getAllByText("Cloning…")).toHaveLength(2);
    await completeClone(0);
    expect(screen.getAllByText("Cloning…")).toHaveLength(1);
    expect(screen.getByText("mains")).toBeTruthy();
    await completeClone(1, "mains");
    expect(screen.queryByText("Cloning…")).toBeNull();
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("retains a failed clone for retry with its original URL and location, then permits dismissal", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    await act(async () => jobs[0].finish(fail("Permission denied (publickey)")));
    expect(screen.getByText("Clone failed")).toBeTruthy();
    expect(screen.getByText("Permission denied (publickey)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry cloning website" }));
    expect(jobs[1].payload).toEqual(jobs[0].payload);
    expect(screen.getByText("Cloning…")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => jobs[1].finish(fail("Still denied")));
    await user.click(screen.getByRole("button", { name: "Dismiss clone error for website" }));
    expect(screen.queryByText("Clone failed")).toBeNull();
    expect(screen.getByText("No projects yet")).toBeTruthy();
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("cancels only the selected clone and waits for backend termination before removing its row", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    await submitClone(user, "mains");
    await user.click(screen.getByRole("button", { name: "Cancel cloning website" }));
    expect(cancellations[0].payload).toEqual({
      accountId: "account", cloneId: (jobs[0].payload.source as { cloneId: string }).cloneId,
    });
    expect(screen.getByText("Canceling…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel cloning website" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Cloning…")).toBeTruthy();
    await act(async () => {
      jobs[0].finish(fail(WORKSPACE_CLONE_CANCELED));
      cancellations[0].finish(ok(true));
    });
    expect(screen.queryByText("website")).toBeNull();
    expect(screen.getByText("mains")).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    await completeClone(1, "mains");
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("keeps the real workspace when clone completion wins a cancellation race", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    await user.click(screen.getByRole("button", { name: "Cancel cloning website" }));
    await completeClone(0);
    await act(async () => cancellations[0].finish(ok(false)));
    expect(screen.queryByText("Canceling…")).toBeNull();
    expect(screen.queryByText("Cloning…")).toBeNull();
    expect(screen.getByText("main")).toBeTruthy();
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("leaves a newly opened dialog and the current workspace alone when an older clone finishes", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    await user.click(screen.getByRole("button", { name: "Other workspace" }));
    await user.click(screen.getByRole("button", { name: "Add Project" }));
    await user.type(screen.getByRole("textbox", { name: "Git URL" }), "https://github.com/next/repo.git");
    await completeClone(0);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Git URL" }) as HTMLInputElement).value).toBe("https://github.com/next/repo.git");
    expect(screen.getByTestId("route").textContent).toBe("/code/other");
    h.store.dispatch(baseApi.util.resetApiState());
  });

  it("isolates pending rows and late results when switching backends", async () => {
    const h = harness();
    const user = userEvent.setup();
    await submitClone(user);
    act(() => {
      setTransport(makeTransport([]));
      h.store.dispatch(setActiveBackend("remote"));
      h.store.dispatch(baseApi.util.resetApiState());
    });
    await waitFor(() => expect(screen.getByText("No projects yet")).toBeTruthy());
    await completeClone(0);
    expect(screen.queryByText("website")).toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId("route").textContent).toBe("/code/existing");
    h.store.dispatch(baseApi.util.resetApiState());
  });
});
