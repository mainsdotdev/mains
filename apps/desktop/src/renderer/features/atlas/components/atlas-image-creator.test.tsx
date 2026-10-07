// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginListResponse, SkillInfo } from "@/lib/redux/api/providersApi";
import workspaceReducer, { addContextItem, setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import { clearTransientUploads } from "@/features/workspace/hooks/use-transient-uploads";
import { useActiveSpace } from "@/hooks/use-active-space";
import AtlasImageCreator from "./atlas-image-creator";

const mocks = vi.hoisted(() => ({
  getState: vi.fn(), execute: vi.fn(), continue: vi.fn(), abort: vi.fn(), create: vi.fn(), invoke: vi.fn(), serialize: vi.fn(),
  provider: vi.fn(), mode: vi.fn(), selection: undefined as unknown,
  spaces: [
    { id: "claude-chat", accountId: "account", name: "Claude", mode: "chat", providerId: "claude_code" },
    { id: "codex-chat", accountId: "account", name: "Codex", mode: "chat", providerId: "codex" },
  ],
  installed: undefined as PluginListResponse | undefined, catalog: undefined as PluginListResponse | undefined,
  skills: [] as SkillInfo[],
  skillsLoading: false, skillsError: false, refreshSkills: vi.fn(),
  settings: { defaultModel: "test-model", config: { modelReasoningEffort: "medium", serviceTier: "" } },
  models: [{ id: "test-model", displayName: "Test Model", supportedEffortLevels: ["low", "medium", "high"] }],
  runMode: "work", runStatus: "succeeded", transport: "backend", error: null as string | null, empty: [],
}));
vi.mock("@/lib/redux", () => ({ store: { getState: () => mocks.getState() } }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: "claude-chat" }, isLoading: false }),
  useGetSpacesQuery: () => ({ data: mocks.spaces, isLoading: false }),
  useCreateSpaceMutation: () => [mocks.create],
  useGetRunByIdQuery: (id: string) => ({ data: id ? {
    id, accountId: "account", providerId: "codex", mode: mocks.runMode, spaceId: "codex-chat", collectionId: "project",
  } : undefined }),
  useAbortRunMutation: () => [mocks.abort],
  useGetProviderAccountInfoQuery: () => ({ data: undefined }),
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderInstalledPluginsQuery: () => ({ data: mocks.installed, isLoading: false, refetch: vi.fn() }),
  useGetProviderPluginsQuery: () => ({ data: mocks.catalog }),
  useGetProviderByIdQuery: () => ({ data: mocks.settings }),
  useGetProviderModelsQuery: () => ({ data: mocks.models }),
  useGetProviderCommandsQuery: () => ({ data: mocks.empty }),
  useGetProviderSkillsQuery: () => ({ data: mocks.skills, isLoading: mocks.skillsLoading, error: mocks.skillsError, refetch: mocks.refreshSkills }),
}));
vi.mock("@/features/workspace/hooks/use-workspace-runs", () => ({
  useWorkspaceRuns: (_workspace: unknown, provider: string, mode: string, runId: string, _prefetch: unknown, selection: unknown) => {
    mocks.provider(provider); mocks.mode(useActiveSpace().activeSpace?.mode); mocks.selection = selection;
    const activeRun = runId ? { id: runId, providerId: provider, mode, status: mocks.runStatus,
      spaceId: "codex-chat", goal: "Create an image", configSnapshot: { conversationSettings: { model: "test-model", config: {} } } } : undefined;
    return { runsLoaded: true, activeRun, activeRunId: runId, runs: activeRun ? [activeRun] : mocks.empty,
      currentEvents: mocks.empty, currentTurns: mocks.empty, eventsEndRef: { current: null }, history: undefined,
      isLoading: false, error: mocks.error, executeRun: mocks.execute, continueRun: mocks.continue };
  },
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => mocks.transport, appEvents: { providers: { onModelsUpdated: () => () => {} } } }));
vi.mock("@/features/workspace/lib/conversation-settings-writer", () => ({ persistConversationSettings: (...args: unknown[]) => mocks.invoke(...args) }));
vi.mock("@/features/workspace/lib/run-helpers", () => ({ serializeAttachments: (...args: unknown[]) => mocks.serialize(...args) }));
vi.mock("@/features/workspace/hooks/use-tool-approval", () => ({ useToolApproval: () => ({ pendingApprovals: [], respond: vi.fn() }) }));
vi.mock("@/features/workspace/hooks/use-plugin-logos", () => ({ PluginLogoProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/workspace/components/workspace-events", () => ({ WorkspaceEvents: () => <div>Image run conversation</div> }));
vi.mock("@/features/workspace/components/tools/tool-approval-dialog", () => ({ ToolApprovalDialog: () => null }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcut: () => {}, useKeyboardShortcutBinding: () => null }));
vi.mock("@/features/workspace/hooks/use-realtime-voice", () => ({ useRealtimeVoice: () => ({ state: { phase: "idle", runId: null, muted: false } }) }));
vi.mock("@/features/workspace/hooks/use-context-usage", () => ({ useContextUsage: () => null }));
vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: vi.fn() }) }));
vi.mock("@/features/workspace/components/unified-context-dropdown", () => ({ UnifiedContextDropdown: () => null }));

const imagegen: SkillInfo = {
  name: "imagegen", displayName: "Image Gen", path: "/codex/skills/.system/imagegen/SKILL.md",
  scope: "system", userInvokable: true, enabled: true,
};
const list = (): PluginListResponse => ({ marketplaces: [], marketplaceLoadErrors: [], remoteSyncError: null, featuredPluginIds: [] });

function Location() {
  const location = useLocation(); const navigate = useNavigate();
  return <><output data-testid="url">{location.pathname}{location.search}</output><button onClick={() => navigate("/plugins")}>Leave creator</button>
    <output data-testid="saved-mode">{useActiveSpace().activeSpace?.mode}</output></>;
}
const owners = new Set<string>();
function setup(initial = "/atlas/images/new?project=project") {
  const store = configureStore({ reducer: { workspace: workspaceReducer, backends: () => ({ activeBackendId: null }) } });
  mocks.getState.mockImplementation(() => store.getState());
  store.dispatch(setComposerContextKey("other-draft"));
  store.dispatch(addContextItem({ kind: "skill", name: "keep-this" }));
  const result = render(<Provider store={store}><MemoryRouter initialEntries={[initial]}><Location /><Routes>
    <Route path="/atlas/images/new" element={<AtlasImageCreator accountId="account" collectionId="project" />} />
    <Route path="/atlas/images/runs/:id" element={<AtlasImageCreator accountId="account" collectionId="project" runId="image-run" />} />
    <Route path="/plugins" element={<div>Plugin catalog</div>} />
  </Routes></MemoryRouter></Provider>);
  const owner = store.getState().workspace.composerContextKey;
  owners.add(owner);
  return { ...result, store, owner };
}
function typePrompt(value: string) {
  const input = screen.getByRole("textbox", { name: "Image prompt" });
  input.textContent = value; fireEvent.input(input);
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.transport = "backend"; mocks.runMode = "work"; mocks.error = null;
  mocks.spaces = [
    { id: "claude-chat", accountId: "account", name: "Claude", mode: "chat", providerId: "claude_code" },
    { id: "codex-chat", accountId: "account", name: "Codex", mode: "chat", providerId: "codex" },
  ];
  mocks.installed = list(); mocks.catalog = list();
  mocks.skills = [imagegen]; mocks.skillsLoading = false; mocks.skillsError = false;
  mocks.execute.mockResolvedValue("image-run"); mocks.continue.mockResolvedValue(true); mocks.invoke.mockResolvedValue(undefined);
  mocks.create.mockImplementation(() => ({ unwrap: async () => ({ ...mocks.spaces[0], id: "new-codex", providerId: "codex", mode: "work" }) }));
  mocks.serialize.mockResolvedValue([{ type: "image", name: "photo.png", content: "base64" }]);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); for (const owner of owners) clearTransientUploads(owner); owners.clear(); });

describe("Atlas image creator", () => {
  it("detects the installed Image Gen skill when no Image Gen plugin exists", () => {
    mocks.installed = list(); mocks.catalog = list();
    mocks.skills = [imagegen];
    const { store } = setup();
    expect(store.getState().workspace.contextItems).toEqual([expect.objectContaining({
      kind: "skill", name: "imagegen", scope: "system", path: "/codex/skills/.system/imagegen/SKILL.md",
    })]);
    typePrompt("A mountain");
    expect(screen.queryByText("Install Image Gen to create images with Codex.")).toBeNull();
    expect((screen.getByRole("button", { name: "Create image" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("selects Codex Work and the actual skill path without changing the saved agent or mode", () => {
    const { store } = setup();
    expect(mocks.provider).toHaveBeenLastCalledWith("codex");
    expect(mocks.mode).toHaveBeenLastCalledWith("work");
    expect(mocks.selection).toEqual({ selection: "local" });
    expect(screen.getByTestId("saved-mode").textContent).toBe("chat");
    expect(store.getState().workspace.contextItems).toEqual([expect.objectContaining({ name: "imagegen", scope: "system", path: imagegen.path, mentionPath: undefined })]);
    expect(screen.getByRole("textbox", { name: "Image prompt" }).textContent).toContain("Image Gen");
    expect((screen.getByRole("button", { name: "Create image" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Start voice chat" })).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });

  // Re-enable with the temporarily hidden templates section.
  it.skip("replaces the previous template and draft, keeps the skill attached and leaves artwork empty", () => {
    const { store, owner } = setup(); typePrompt("My old idea");
    fireEvent.click(screen.getByRole("button", { name: "Poster template" }));
    expect(store.getState().workspace.draftTextByKey[owner]).toContain("$imagegen Create a poster");
    fireEvent.click(screen.getByRole("button", { name: "Logo template" }));
    const text = store.getState().workspace.draftTextByKey[owner];
    expect(text).toContain("$imagegen Design a distinctive"); expect(text).not.toContain("poster"); expect(text).not.toContain("My old idea");
    expect(store.getState().workspace.contextItems).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Logo template" }).querySelector("img")).toBeNull();
  });

  it.each([false, true])("offers skill guidance and refresh when Image Gen is missing or disabled (present=%s)", (present) => {
    mocks.skills = present ? [{ ...imagegen, enabled: false }] : [];
    setup(); typePrompt("A mountain");
    expect((screen.getByRole("button", { name: "Create image" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(present ? "Enable the Image Gen skill in Codex, then refresh." : "Add the Image Gen skill to Codex, then refresh.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mocks.refreshSkills).toHaveBeenCalledOnce();
    expect(screen.getByTestId("url").textContent).toBe("/atlas/images/new?project=project");
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("waits for skill discovery without showing missing-skill guidance", () => {
    mocks.skills = []; mocks.skillsLoading = true;
    setup(); typePrompt("A mountain");
    expect(screen.getByText("Checking Image Gen skill…")).toBeTruthy();
    expect(screen.queryByText("Add the Image Gen skill to Codex, then refresh.")).toBeNull();
    expect((screen.getByRole("button", { name: "Create image" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("retries a failed skill query", () => {
    mocks.skills = []; mocks.skillsError = true;
    setup();
    expect(screen.getByText("Could not check Codex skills.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refreshSkills).toHaveBeenCalledOnce();
  });

  it("uses a direct image-only picker for plus", () => {
    setup();
    const input = screen.getByLabelText("Upload images") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
    expect(input.accept).toBe("image/*"); expect(click).toHaveBeenCalledOnce();
    const file = new File(["pixels"], "photo.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file, new File(["pdf"], "report.pdf", { type: "application/pdf" })] } });
    expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy();
    expect(screen.queryByText("report.pdf")).toBeNull();
  });

  it("saves a Codex Work run with images, project and structured skill context, then opens its conversation", async () => {
    const { store, owner } = setup();
    typePrompt("A quiet mountain at sunrise");
    fireEvent.change(screen.getByLabelText("Upload images"), { target: { files: [new File(["pixels"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await screen.findByText("Image run conversation");
    expect(mocks.execute).toHaveBeenCalledOnce();
    const args = mocks.execute.mock.calls[0];
    expect(args[0]).toBe("$imagegen A quiet mountain at sunrise"); expect(args[2]).toBe("codex");
    expect(args[4]).toEqual([{ type: "image", name: "photo.png", content: "base64" }]);
    expect(args[5]).toEqual([expect.objectContaining({ scope: "system", path: imagegen.path, mentionPath: undefined })]);
    expect(args[6]).toBe("project"); expect(mocks.mode).toHaveBeenLastCalledWith("work");
    expect(screen.getByTestId("url").textContent).toBe("/atlas/images/runs/image-run?project=project");
    expect(store.getState().workspace.draftTextByKey[owner]).toBeUndefined();
    expect(screen.getByTestId("saved-mode").textContent).toBe("chat");
  });

  it("keeps the prompt and photo after a rejected start", async () => {
    mocks.execute.mockResolvedValue(null);
    const { store, owner } = setup(); typePrompt("Keep my idea");
    fireEvent.change(screen.getByLabelText("Upload images"), { target: { files: [new File(["pixels"], "photo.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    expect(store.getState().workspace.draftTextByKey[owner]).toBe("Keep my idea");
    expect(screen.getByRole("img", { name: "photo.png" })).toBeTruthy();
    expect(screen.getByTestId("url").textContent).toBe("/atlas/images/new?project=project");
  });

  it("accepts images through paste and drop while ignoring documents", () => {
    setup();
    const input = screen.getByRole("textbox", { name: "Image prompt" });
    const pdf = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    fireEvent.paste(input, { clipboardData: { files: [new File(["pixels"], "pasted.png", { type: "image/png" }), pdf] } });
    expect(screen.getByRole("img", { name: "pasted.png" })).toBeTruthy();
    fireEvent.drop(input.closest('[class*="container/composer"]')!, {
      dataTransfer: { types: ["Files"], files: [new File(["pixels"], "dropped.png", { type: "image/png" }), pdf] },
    });
    expect(screen.getByRole("img", { name: "dropped.png" })).toBeTruthy();
    expect(screen.queryByText("report.pdf")).toBeNull();
  });

  it("ignores a late run response from a previous backend", async () => {
    let finish!: (id: string) => void; mocks.execute.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { store, owner } = setup(); typePrompt("Keep this backend's draft");
    fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    mocks.transport = "other-backend";
    await act(async () => { finish("image-run"); });
    expect(store.getState().workspace.draftTextByKey[owner]).toBe("Keep this backend's draft");
    expect(screen.getByTestId("url").textContent).toBe("/atlas/images/new?project=project");
  });

  it("does not navigate back when a submission finishes after leaving, and restores the previous composer", async () => {
    let finish!: (id: string) => void; mocks.execute.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { store } = setup(); typePrompt("A mountain");
    fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Leave creator" }));
    await act(async () => { finish("image-run"); });
    expect(screen.getByTestId("url").textContent).toBe("/plugins");
    expect(store.getState().workspace.composerContextKey).toBe("other-draft");
    expect(store.getState().workspace.contextItems).toEqual([{ kind: "skill", name: "keep-this" }]);
  });

  it("creates a Codex Work Space if none exists while keeping the active Claude Space", async () => {
    mocks.spaces = [mocks.spaces[0]]; setup();
    await screen.findByRole("textbox", { name: "Image prompt" });
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providerId: "codex", mode: "work" }));
    expect(screen.getByTestId("saved-mode").textContent).toBe("chat");
    expect(mocks.mode).toHaveBeenLastCalledWith("work");
  });

  it("continues an existing image run and rejects a routed Chat run", async () => {
    const view = setup("/atlas/images/runs/image-run"); typePrompt("Make the sky warmer");
    fireEvent.click(screen.getByRole("button", { name: "Create image" }));
    await waitFor(() => expect(mocks.continue).toHaveBeenCalledOnce());
    expect(mocks.continue.mock.calls[0][0]).toBe("image-run"); expect(mocks.execute).not.toHaveBeenCalled();
    view.unmount(); mocks.runMode = "chat"; setup("/atlas/images/runs/image-run");
    expect(screen.getByRole("alert").textContent).toContain("Could not open this image run");
    expect(screen.queryByRole("textbox", { name: "Image prompt" })).toBeNull();
  });
});
