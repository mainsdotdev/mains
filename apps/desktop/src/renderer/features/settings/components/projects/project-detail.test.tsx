// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { baseApi } from "@/lib/redux/api/baseApi";
import { projectsApi, type Project, type UpdateProjectPayload } from "@/lib/redux/api/projectsApi";
import ProjectDetail from "./project-detail";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", async (original) => ({
  ...await original<typeof import("@/lib/transport")>(),
  getTransport: () => ({ invoke: mocks.invoke }),
}));
vi.mock("@/lib/redux/api", () => import("@/lib/redux/api/projectsApi"));
vi.mock("./project-linked-resources", () => ({ ProjectLinkedResources: () => null }));
vi.mock("./project-instructions-section", () => ({ ProjectInstructionsSection: () => null }));
vi.mock("@/features/workspace/components/link-resources-modal", () => ({ LinkResourcesModal: () => null }));
// Emoji data is fetched remotely; these tests exercise the real registry picker.
vi.mock("frimousse", () => ({
  EmojiPicker: Object.fromEntries(["Root", "Search", "Viewport", "Loading", "Empty", "List"].map((name) => [name, () => null])),
}));

let project: Project;
let store: ReturnType<typeof createStore>;

function createStore() {
  return configureStore({
    reducer: { [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false }).concat(baseApi.middleware),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  project = {
    id: "project", accountId: "default", name: "Example", rootPath: "/tmp/example",
    workspacesPath: null, branches: null, remoteOrigin: null, defaultBranch: "main",
    setupScript: null, runScript: null, archiveScript: null, icon: null, sortOrder: 0,
    commitInstructions: null, prInstructions: null, isArchived: false,
    createdAt: new Date("2026-10-15T10:00:00Z"), updatedAt: new Date("2026-10-15T10:00:00Z"),
  };
  mocks.invoke.mockImplementation(async (handler: string, args: unknown[]) => {
    if (handler === CHANNELS.projects.get) return { success: true, data: project };
    if (handler === CHANNELS.projects.listBranches) return { success: true, data: ["main"] };
    if (handler === CHANNELS.projects.update) {
      project = { ...project, ...args[1] as UpdateProjectPayload, updatedAt: new Date(project.updatedAt.getTime() + 1000) };
      return { success: true, data: project };
    }
    throw new Error(`Unexpected channel: ${handler}`);
  });
  store = createStore();
});

afterEach(() => {
  cleanup();
  store.dispatch(baseApi.util.resetApiState());
});

async function openIconPicker() {
  const user = userEvent.setup();
  render(<Provider store={store}><MemoryRouter><ProjectDetail id={project.id} /></MemoryRouter></Provider>);
  await user.click(await screen.findByRole("button", { name: /Choose an icon|Change icon/ }));
  await user.click(screen.getByRole("button", { name: "Icon" }));
  return user;
}

async function expectSavedIcon(icon: string) {
  await waitFor(() => expect(projectsApi.endpoints.getProject.select(project.id)(store.getState()).data?.icon).toBe(icon));
}

describe("Project settings icon picker", () => {
  it.each([null, "emoji:🚀"])("keeps a color selected before picking an icon (stored icon: %s)", async (icon) => {
    project = { ...project, icon };
    const user = await openIconPicker();
    await user.click(screen.getByRole("button", { name: "Blue" }));
    // Include pending mutation/refetch work in the reproduction.
    await act(async () => { await Promise.resolve(); });

    const blue = screen.getByRole("button", { name: "Blue" });
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    expect(blue.closest(".invisible")).toBeNull();
    expect(mocks.invoke.mock.calls.filter(([handler]) => handler === CHANNELS.projects.update)).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "heart" }));
    await expectSavedIcon("icon:heart|blue");
    await user.click(screen.getByRole("button", { name: "Change icon" }));
    expect(screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("still auto-saves the tint of an existing registry icon and keeps the picker open after refetch", async () => {
    project = { ...project, icon: "icon:heart" };
    const user = await openIconPicker();
    await user.click(screen.getByRole("button", { name: "Violet" }));
    await expectSavedIcon("icon:heart|violet");

    const violet = screen.getByRole("button", { name: "Violet" });
    expect(violet.getAttribute("aria-pressed")).toBe("true");
    expect(violet.closest(".invisible")).toBeNull();
  });
});
