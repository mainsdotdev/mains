// @vitest-environment jsdom
import { useLayoutEffect, useState, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantAssignment, AssistantConversation, AssistantSkill, AssistantTeam, AssistantTeamWork, AssistantWelcome, SetAssistantPinned, UpdateAssistantProfile } from "@mains/contracts/assistants";
import type { ToolApprovalRequest } from "@mains/contracts/runs";
import type { Pulse } from "@/lib/redux/api/pulseApi";
import type { ModelInfo } from "@/lib/redux/api/providersApi";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import { useAppDispatch } from "@/lib/redux/hooks";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import assistantsReducer from "@/lib/redux/slices/assistantsSlice";
import workspaceReducer, { setComposerContextKey } from "@/lib/redux/slices/workspaceSlice";
import previewReducer, { openPreviewTab, setPreviewOpen, type PreviewTab } from "@/lib/redux/slices/previewSlice";
import { composerOwnerKey } from "@/features/workspace/lib/ui-context";
import { runOwnerKey } from "../../shared/ui-state-keys";
import { AssistantsSidebar } from "@/features/assistants/components/assistants-sidebar";
import AssistantsPage from "./Assistants";

const mocks = vi.hoisted(() => ({ routines: [] as Pulse[], chats: [] as AssistantConversation[], assistants: [] as Assistant[], teams: [] as AssistantTeam[], models: [] as ModelInfo[], savingProfile: false, loadingChats: false, chatsError: undefined as unknown, refetchChats: vi.fn(), websiteChats: [{ id: "website-first", title: "Website announcement", goal: "Page", status: "succeeded", mode: "work", workspaceId: null, workspaceName: null, projectName: null, createdAt: new Date(0), updatedAt: new Date(0) }] }));
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const createTeam = vi.hoisted(() => vi.fn());
const createMate = vi.hoisted(() => vi.fn());
const archiveMate = vi.hoisted(() => vi.fn());
const archiveResult = vi.hoisted(() => ({
  current: {} as {
    originalArgs?: { accountId: string; id: string; archived: boolean };
    isLoading?: boolean;
    isSuccess?: boolean;
    reset?: () => void;
  },
}));
const setPinned = vi.hoisted(() => vi.fn());
const removeMate = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const generateSkill = vi.hoisted(() => vi.fn());
const saveSkill = vi.hoisted(() => vi.fn());
const catalogSkills = vi.hoisted(() => [] as AssistantSkill[]);
const readTeamWork = vi.hoisted(() => vi.fn());
const readAssignment = vi.hoisted(() => vi.fn());
const assignTask = vi.hoisted(() => vi.fn());
const pendingApprovals = vi.hoisted(() => [] as ToolApprovalRequest[]);
const welcomes = vi.hoisted(() => [] as AssistantWelcome[]);
const assignments = vi.hoisted(() => [] as AssistantAssignment[]);
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useGetProvidersQuery: () => ({ data: [{ id: "codex", isEnabled: true }] }),
  useGetSpacesQuery: () => ({ data: [{ id: "codex", accountId: "account", providerId: "codex", isArchived: false }] }),
  useGetProviderModelsQuery: (_providerId: string, options?: { skip?: boolean }) => ({
    currentData: options?.skip ? undefined : mocks.models, isFetching: false,
  }),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssistantOverviewQuery: () => ({ currentData: { assistants: mocks.assistants, teams: mocks.teams, assignments, memories: [], welcomes }, refetch: vi.fn() }),
  useAssistantSkillCatalogQuery: () => ({ currentData: {
    skills: catalogSkills,
    pluginSkillIds: [],
  } }),
  useGenerateAssistantSkillMutation: () => [generateSkill, {}],
  useSaveAssistantSkillMutation: () => [saveSkill, {}],
  useAssistantTeamWorkQuery: readTeamWork,
  useAssistantAssignmentQuery: readAssignment,
  useAssignAssistantTaskMutation: () => [assignTask, {}],
  useAssistantConversationsQuery: ({ id }: { id: string }) => ({ currentData: mocks.loadingChats ? undefined : id === "website" ? mocks.websiteChats : mocks.chats, error: mocks.chatsError, refetch: mocks.refetchChats }),
  useArchiveAssistantMutation: () => [archiveMate, archiveResult.current],
  useSetAssistantPinnedMutation: () => [setPinned, {}],
  useRemoveAssistantMutation: () => [removeMate, {}],
  useUpdateAssistantProfileMutation: () => [updateProfile, { isLoading: mocks.savingProfile }],
  useCreateAssistantMutation: () => [createMate, {}],
  useCreateAssistantTeamMutation: () => [createTeam, {}],
}));
vi.mock("@/lib/redux/api/providersApi", () => ({
  useGetProviderByIdQuery: () => ({ currentData: { config: { approvalMode: "on-request" } } }),
  useGetCodexPermissionsQuery: () => ({ currentData: { profilesSupported: true, profiles: [], allowedSandboxModes: null, allowedApprovalPolicies: null, requiresNamedProfile: false } }),
}));
vi.mock("@/lib/redux/api/pulseApi", () => ({
  useGetPulsesQuery: () => ({ currentData: mocks.routines, refetch: vi.fn() }),
  useDeletePulseMutation: () => [vi.fn(), {}], useTogglePulseMutation: () => [vi.fn(), {}], useRunPulseNowMutation: () => [vi.fn(), {}],
}));
vi.mock("@/features/assistants/hooks/use-assistant-updates", () => ({ useAssistantUpdates() {} }));
vi.mock("@/features/workspace/hooks/use-tool-approval", () => ({
  useToolApproval: (runs: { id: string }[]) => ({ pendingApprovals: pendingApprovals.filter(item => runs.some(run => run.id === item.runId)) }),
}));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
vi.mock("@/features/assistants/components/assistant-chat", () => ({
  AssistantChat: ({ assistant, selectedRunId, animateWelcome, onSelectRun, onOpenDetails }: {
    assistant: Assistant; selectedRunId: string | null; animateWelcome?: boolean; onSelectRun(id: string): void; onOpenDetails(): void;
  }) => {
    const [animateIntro] = useState(animateWelcome);
    const dispatch = useAppDispatch();
    const owner = composerOwnerKey({ backendId: "local", assistantId: assistant.id, spaceId: assistant.spaceId,
      providerId: assistant.providerId, mode: assistant.spaceSnapshot.mode }, selectedRunId);
    useLayoutEffect(() => { dispatch(setComposerContextKey(owner)); }, [dispatch, owner]);
    return <div>{!selectedRunId && <button aria-label="Center assistant monogram" onClick={onOpenDetails}>R</button>}
      <output data-testid="conversation" data-animate-welcome={animateIntro}>{selectedRunId ?? "draft"}</output>
      <button onClick={() => {
        mocks.chats = [{ id: "third", title: "Third release", goal: "Third", status: "succeeded", mode: "work", workspaceId: null,
          workspaceName: null, projectName: null, createdAt: new Date(), updatedAt: new Date() }, ...mocks.chats];
        onSelectRun("third");
      }}>Send draft</button>
    </div>;
  },
}));
vi.mock("@/features/assistants/components/assistant-memory", () => ({ AssistantMemoryPanel: () => null }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView() {} }));
vi.mock("@/lib/platform", () => ({ useIsMobile: () => false, useCapabilities: () => ({ windowChrome: false }) }));

function HeaderOutlet() { return <header aria-label="Assistant header">{useMainHeader().header}</header>; }
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
const releaseChatOwner = runOwnerKey("local", "first");
const browserPreview: PreviewTab = { kind: "browser", id: "browser", title: "New tab", faviconUrl: null, isLoading: false, isCrashed: false };
function setup(initial = "/assistants?assistant=release&run=first", openPreview?: PreviewTab) {
  const store = configureStore({ reducer: {
    appSettings: appSettingsReducer, workspace: workspaceReducer, assistants: assistantsReducer, preview: previewReducer,
    backends: () => ({ activeBackendId: "local" }),
  } });
  if (openPreview) store.dispatch(openPreviewTab({ ownerKey: releaseChatOwner, tab: openPreview }));
  const Wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter initialEntries={[initial]}><MainHeaderProvider>{children}</MainHeaderProvider></MemoryRouter></Provider>;
  const tree = () => <Wrapper><AssistantsSidebar /><AssistantsPage /><HeaderOutlet /><Location /></Wrapper>;
  const view = render(tree());
  return { store, ...view, refresh: () => view.rerender(tree()) };
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  createMate.mockReset();
  readTeamWork.mockReset().mockReturnValue({});
  readAssignment.mockReset().mockReturnValue({});
  assignTask.mockReset();
  pendingApprovals.length = 0;
  archiveMate.mockReset().mockReturnValue({ unwrap: async () => undefined });
  archiveResult.current = {};
  setPinned.mockReset().mockReturnValue({ unwrap: async () => undefined });
  removeMate.mockReset().mockReturnValue({ unwrap: async () => undefined });
  welcomes.length = 0;
  assignments.length = 0;
  createTeam.mockReset().mockImplementation((input: Pick<AssistantTeam, "accountId" | "name">) =>
    ({ unwrap: () => Promise.resolve({ ...input, id: "new-team", createdAt: new Date(0) }) }));
  catalogSkills.splice(0, catalogSkills.length, { id: "travel-skill", name: "Travel research", description: "Compare transport" });
  updateProfile.mockReset().mockImplementation(({ id, profile, teamChange, modelChange, skillChange }: UpdateAssistantProfile) => ({
    unwrap: async () => {
      const assistant = mocks.assistants.find(assistant => assistant.id === id)!;
      Object.assign(assistant, profile);
      if (teamChange) assistant.teamId = teamChange.teamId;
      if (modelChange) {
        assistant.model = modelChange.model;
        assistant.effort = modelChange.effort;
      }
      if (skillChange) assistant.skills = skillChange.ids.map(id => catalogSkills.find(skill => skill.id === id)!);
      return assistant;
    },
  }));
  mocks.savingProfile = false;
  mocks.models = [
    { id: "model", displayName: "Test model", supportedEffortLevels: ["low", "medium", "high"] },
    { id: "new-model", displayName: "New model", supportedEffortLevels: ["low", "xhigh"] },
  ];
  mocks.routines = [];
  mocks.loadingChats = false;
  mocks.chatsError = undefined;
  mocks.refetchChats.mockReset();
  mocks.teams = [{ id: "team", accountId: "account", name: "Mains", createdAt: new Date(0) }, { id: "website-team", accountId: "account", name: "Website team", createdAt: new Date(0) }, { id: "foreign-team", accountId: "foreign-account", name: "Foreign team", createdAt: new Date(0) }];
  mocks.chats = ["first", "second"].map((id, index) => ({ id, title: index ? "Second release" : "First release", goal: id, status: "succeeded", mode: index ? "work" : "developer", workspaceId: index ? null : "mains-ios", workspaceName: index ? null : "feat/ios", projectName: index ? null : "mains", createdAt: new Date(), updatedAt: new Date(Date.now() - (index + 1) * 60_000) }));
  mocks.assistants = [{ id: "release", accountId: "account", teamId: "team", name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", isArchived: false, providerId: "codex", avatar: { shape: "sphere", color: "blue" }, model: "model", effort: "high", conversationSettings: { model: "model", config: { sandboxMode: "workspace-write" } }, spaceSnapshot: { name: "Codex" } } as Assistant];
  mocks.assistants.push({ ...mocks.assistants[0], id: "website", name: "Website", description: "Own the website" });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("assistant profile and conversation", () => {
  it("keeps mate hover cards closed and opens pinned mate details from the tile", async () => {
    mocks.assistants[1].pinnedAt = new Date(1);
    setup();
    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    const release = sidebar.getByRole("button", { name: /^Release/ });
    const website = sidebar.getByRole("button", { name: "Open Website" });

    vi.useFakeTimers();
    try {
      for (const mate of [release, website]) {
        const row = mate.parentElement!;
        fireEvent.mouseEnter(row);
        act(() => vi.advanceTimersByTime(500));
        expect(screen.queryByRole("dialog", { name: /^(Release|Website)$/ })).toBeNull();
        fireEvent.mouseLeave(row);
      }
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(sidebar.getByRole("button", { name: "About Website" }));
    expect(await screen.findByRole("complementary", { name: "About Website" })).toBeTruthy();
  });

  it("puts pinned mates first by pin date and returns an unpinned mate to its team", async () => {
    const [release, website] = mocks.assistants;
    release.pinnedAt = null;
    website.pinnedAt = new Date(1);
    mocks.assistants.push({ ...release, id: "retired", name: "Retired", isArchived: true, pinnedAt: new Date(3) });
    setPinned.mockImplementation(({ pinned }: SetAssistantPinned) => ({ unwrap: async () => {
      release.pinnedAt = pinned ? new Date(2) : null;
    } }));
    const { refresh } = setup();
    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    const group = within(sidebar.getByRole("region", { name: "Pinned" }));
    const names = () => group.getAllByRole("button", { name: /^Open / }).map(button => button.getAttribute("aria-label"));
    expect(names()).toEqual(["Open Website"]);

    await act(async () => fireEvent.click(sidebar.getByRole("button", { name: "Pin mate Release" })));
    expect(setPinned).toHaveBeenLastCalledWith({ id: "release", accountId: "account", pinned: true });
    refresh();
    expect(names()).toEqual(["Open Release", "Open Website"]);
    expect(sidebar.queryByRole("region", { name: "Mains" })).toBeNull();
    fireEvent.click(group.getByRole("button", { name: "Open Website" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("website-first"));
    expect(group.getByRole("button", { name: "Open Website" }).getAttribute("aria-current")).toBe("page");

    await act(async () => fireEvent.click(group.getByRole("button", { name: "Unpin mate Release" })));
    expect(setPinned).toHaveBeenLastCalledWith({ id: "release", accountId: "account", pinned: false });
    refresh();
    expect(names()).toEqual(["Open Website"]);
    expect(within(sidebar.getByRole("region", { name: "Mains" })).getByRole("button", { name: "About Release" })).toBeTruthy();
  });

  it("opens a searchable archive from the sidebar and restores a mate from its row", async () => {
    mocks.assistants[1].isArchived = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    const archive = within(screen.getByRole("menu", { name: "Archived" }));
    const search = archive.getByRole("textbox", { name: "Search archived mates" });
    expect(document.activeElement).toBe(search);
    expect(archive.queryByRole("menuitem", { name: "Open Release" })).toBeNull();
    fireEvent.change(search, { target: { value: "nonmatching" } });
    expect(archive.getByText("No matching mates")).toBeTruthy();
    fireEvent.change(search, { target: { value: "website" } });
    fireEvent.click(archive.getByRole("menuitem", { name: "Restore Website" }));
    await waitFor(() => expect(archiveMate).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "website", archived: false }));
  });

  it("opens an archived Mate's saved conversation with a restore action", () => {
    mocks.assistants[1].isArchived = true;
    setup("/assistants?assistant=website&run=website-first");
    expect(screen.getByTestId("conversation").textContent).toBe("website-first");
    const header = screen.getByRole("button", { name: "Website profile" });
    expect(within(header).getByText("Archived")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore mate" })).toBeTruthy();
  });

  it("keeps the outgoing chat hidden until archiving opens the empty Mates screen", async () => {
    let finishArchive!: () => void;
    const pendingArchive = new Promise<void>(resolve => { finishArchive = resolve; });
    archiveMate.mockReturnValueOnce({ unwrap: () => pendingArchive });
    const { refresh } = setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Archive mate" }));
    const request = { accountId: "account", id: "release", archived: true };
    const reset = vi.fn(() => { archiveResult.current = {}; });
    archiveResult.current = { originalArgs: request, isLoading: true, reset };
    refresh();
    expect(screen.getByText("Archiving mate…")).toBeTruthy();
    expect(screen.queryByTestId("conversation")).toBeNull();

    mocks.assistants[0].isArchived = true;
    archiveResult.current = { originalArgs: request, isSuccess: true, reset };
    refresh();
    expect(screen.getByText("Archiving mate…")).toBeTruthy();
    expect(screen.queryByTestId("conversation")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(reset).not.toHaveBeenCalled();

    await act(async () => finishArchive());
    const heading = await screen.findByRole("heading", { name: "Your mates" });
    expect(archiveMate).toHaveBeenCalledExactlyOnceWith(request);
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("conversation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Release profile" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "About Release" })).toBeNull();
    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    expect(sidebar.getByRole("button", { name: "About Website" })).toBeTruthy();
    expect(sidebar.queryByRole("button", { name: "About Release" })).toBeNull();

    fireEvent.click(within(heading.parentElement!).getByRole("button", { name: "New mate" }));
    fireEvent.click(screen.getByRole("button", { name: "Close new mate" }));
    expect(screen.getByRole("heading", { name: "Your mates" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(screen.getByRole("menuitem", { name: "Open Release" })).toBeTruthy();
  });

  it("keeps the selected chat and shows the error when archiving fails", async () => {
    archiveMate.mockReturnValueOnce({ unwrap: async () => { throw new Error("Stop the running conversation first."); } });
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = within(await screen.findByRole("complementary", { name: "About Release" }));
    fireEvent.click(panel.getByRole("button", { name: "Archive mate" }));

    expect((await panel.findByRole("alert")).textContent).toBe("Stop the running conversation first.");
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("keeps a different mate selected if an earlier archive request completes", async () => {
    let finishArchive!: () => void;
    const pendingArchive = new Promise<void>(resolve => { finishArchive = resolve; });
    archiveMate.mockReturnValueOnce({ unwrap: () => pendingArchive });
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = within(await screen.findByRole("complementary", { name: "About Release" }));
    fireEvent.click(panel.getByRole("button", { name: "Archive mate" }));

    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    fireEvent.click(sidebar.getByRole("button", { name: /^Website\s*Own the website$/ }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("website-first"));
    await act(async () => finishArchive());
    expect(screen.getByTestId("conversation").textContent).toBe("website-first");
  });

  it("asks before permanent deletion and clears the deleted mate's selection", async () => {
    mocks.assistants[1].isArchived = true;
    removeMate.mockReturnValue({ unwrap: async () => {
      mocks.assistants = mocks.assistants.filter(mate => mate.id !== "website");
    } });
    setup("/assistants?assistant=website");
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Website permanently" }));
    const confirmation = within(screen.getByRole("alertdialog", { name: "Delete Website permanently?" }));
    expect(confirmation.getByText(/conversations, private memory, routines/)).toBeTruthy();
    expect(removeMate).not.toHaveBeenCalled();
    fireEvent.click(confirmation.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(removeMate).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "website" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("assistant=release"));
  });

  it("shows the three robot styles on the empty screen and opens the first mate form", () => {
    mocks.assistants = [];
    const { container } = setup("/assistants");
    const heading = screen.getByRole("heading", { name: "Your mates" });
    const emptyState = heading.parentElement!;
    const avatars = [...emptyState.querySelectorAll('.assistant-avatar--floating[data-avatar-family="robot"]')];
    expect(avatars.map(avatar => avatar.getAttribute("data-avatar-shape"))).toEqual(["terminal-amber", "specialist-travel", "metal-silver"]);
    expect(avatars.every(avatar => avatar.getAttribute("aria-hidden") === "true")).toBe(true);
    fireEvent.click(within(emptyState).getByRole("button", { name: "New mate" }));
    expect(screen.getByRole("form", { name: "Create mate" })).toBeTruthy();
    expect(container.querySelector(".assistant-avatar--floating")).toBeNull();
  });

  it("lists the new mate first, plays its welcome, and opens a revisited setup without replaying it", async () => {
    const mate = { ...mocks.assistants[0], id: "new-mate", name: "Travel planner", description: "" };
    const runId = "assistant-welcome-new-mate";
    createMate.mockReturnValue({ unwrap: async () => {
      mocks.assistants.push(mate);
      welcomes.push({ assistantId: mate.id, runId, state: "ready", answer: null, wasSkipped: false, error: null, createdAt: new Date(),
        question: { header: "Set up", question: "How can I help?", options: [], idleMessage: "Ready", profileSetup: { turns: [] } } });
      return mate;
    } });
    setup();
    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    const team = sidebar.getByRole("button", { name: "Mains" });
    fireEvent.click(team);
    expect(team.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "New mate" }));
    const form = within(screen.getByRole("form", { name: "Create mate" }));
    fireEvent.change(form.getByLabelText("Name"), { target: { value: mate.name } });
    fireEvent.click(form.getByRole("button", { name: "Team" }));
    fireEvent.click(screen.getByRole("option", { name: "Mains" }));
    fireEvent.click(form.getByRole("button", { name: "Create mate" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe(runId));
    expect(screen.getByTestId("conversation").getAttribute("data-animate-welcome")).toBe("true");

    expect(team.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.getAllByRole("button", { name: /^About / }).map(button => button.getAttribute("aria-label")))
      .toEqual(["About Travel planner", "About Website", "About Release"]);
    const setupRow = sidebar.getByRole("button", { name: /^Travel planner\s*Finish setup$/ });
    expect(within(setupRow).getByText("Finish setup").nextElementSibling?.matches('svg[aria-hidden="true"]')).toBe(true);
    fireEvent.click(sidebar.getByRole("button", { name: /^Website/ }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("website-first"));
    fireEvent.click(setupRow);
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe(runId));
    expect(screen.getByTestId("conversation").getAttribute("data-animate-welcome")).toBe("false");

    welcomes[0].question!.profileSetup!.saved = true;
    welcomes[0].state = "skipped";
    mate.description = "Plans trips abroad";
    fireEvent.click(sidebar.getByRole("button", { name: /^Website/ }));
    expect(sidebar.getByRole("button", { name: /^Travel planner\s*Plans trips abroad$/ })).toBeTruthy();
    expect(sidebar.queryByText("Finish setup")).toBeNull();
  });

  it("opens Routines and its last task without closing the panel or losing chat selection", async () => {
    mocks.routines = [{ id: "routine", accountId: "account", assistantId: "release", title: "Daily release check", prompt: "Check the release", frequency: "daily", hour: 9, minute: 0, timezone: "Europe/Istanbul", isActive: true, mode: "work", lastRunId: "second" } as Pulse];
    setup("/assistants?assistant=release&run=first&tab=routines");
    const panel = screen.getByRole("tabpanel", { name: "Routines" });
    expect(within(panel).getByRole("article", { name: "Daily release check" })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
    fireEvent.click(within(panel).getByRole("button", { name: "Open last chat" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    expect(screen.getByRole("tabpanel", { name: "Routines" })).toBe(panel);
    expect(new URLSearchParams(screen.getByTestId("location").textContent ?? "").get("tab")).toBe("routines");
  });
  it("opens compact chat rows with titles and relative activity while keeping Chats open", async () => {
    const now = Date.now();
    mocks.chats[0].updatedAt = new Date(now - 8 * 60 * 60 * 1000);
    mocks.chats[1].updatedAt = new Date(now - 24 * 60 * 60 * 1000);
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Chats" }));
    const panel = screen.getByRole("tabpanel", { name: "Chats" });
    const first = within(panel).getByRole("button", { name: /First release/ });
    const second = within(panel).getByRole("button", { name: /Second release/ });
    expect(first.getAttribute("aria-current")).toBe("page");
    expect(within(panel).queryByRole("heading", { name: "Chats" })).toBeNull();
    expect(within(first).getByText("8h ago")).toBe(first.querySelector("time"));
    expect(within(second).getByText("1d ago")).toBe(second.querySelector("time"));
    expect(within(first).queryByText("mains / feat/ios")).toBeNull();
    expect(within(second).queryByText("Work")).toBeNull();
    expect(first.querySelector("time")?.getAttribute("datetime")).toBe(mocks.chats[0].updatedAt.toISOString());

    fireEvent.click(second);
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    expect(screen.getByRole("tabpanel", { name: "Chats" })).toBe(panel);
    expect(second.getAttribute("aria-current")).toBe("page");
    expect(first.hasAttribute("aria-current")).toBe(false);
    expect(new URLSearchParams(screen.getByTestId("location").textContent ?? "").get("tab")).toBe("chats");
    expect(Object.values(store.getState().assistants.views)[0].activeRunId).toBe("second");
  });

  it("starts a new task from Chats and keeps previous conversations accessible after sending", async () => {
    setup("/assistants?assistant=release&run=second&tab=chats");
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(screen.getByTestId("conversation").textContent).toBe("draft");
    expect(screen.getByRole("tabpanel", { name: "Chats" }).querySelector("[aria-current]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send draft" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("third"));
    const panel = screen.getByRole("tabpanel", { name: "Chats" });
    expect(within(panel).getByRole("button", { name: /Third release/ }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(panel).getByRole("button", { name: /Second release/ }));
    expect(screen.getByTestId("conversation").textContent).toBe("second");
  });

  it("can retry the chat list before the first conversation is selected", async () => {
    mocks.loadingChats = true;
    const view = setup("/assistants?assistant=release");
    expect(screen.getByText("Loading conversation…").getAttribute("role")).toBe("status");
    view.unmount();

    mocks.chatsError = { error: "Could not load conversations" };
    setup("/assistants?assistant=release");
    expect(screen.queryByText("Loading conversation…")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Could not load conversations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetchChats).toHaveBeenCalledOnce();
  });

  it("shows loading, retry and empty states without mixing them with another assistant’s chats", async () => {
    mocks.loadingChats = true;
    const view = setup("/assistants?assistant=release&run=first&tab=chats");
    expect(within(screen.getByRole("tabpanel", { name: "Chats" })).getByRole("status").textContent).toContain("Loading chats");
    view.unmount();

    mocks.chatsError = { error: "Could not load conversations" };
    const failed = setup("/assistants?assistant=release&run=first&tab=chats");
    expect(screen.getByRole("alert").textContent).toContain("Could not load conversations");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetchChats).toHaveBeenCalledOnce();
    expect(within(screen.getByRole("tabpanel", { name: "Chats" })).queryByRole("status")).toBeNull();
    failed.unmount();

    mocks.loadingChats = false;
    mocks.chatsError = undefined;
    mocks.chats = [];
    const empty = setup("/assistants?assistant=release&run=new&tab=chats");
    expect(screen.getByText(/No conversations yet/)).toBeTruthy();
    empty.unmount();

    setup("/assistants?assistant=website&run=website-first&tab=chats");
    expect(screen.getByRole("button", { name: /Website announcement/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /First release/ })).toBeNull();
  });
  it("shows the saved team as text and applies a different team only on Save", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    expect(within(panel).getByText("Mains", { exact: true })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Team" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "New team" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const select = within(panel).getByRole("button", { name: "Team" });
    expect(select.textContent).toContain("Mains");
    fireEvent.click(select);
    expect(screen.queryByRole("option", { name: "Foreign team" })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "Website team" }));
    expect(select.textContent).toContain("Website team");
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      accountId: "account", id: "release", teamChange: { teamId: "website-team", expectedTeamId: "team" },
    }));
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Team" })).toBeNull());
    expect(within(panel).getByText("Website team", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("edits the name, avatar, description and instructions from the Details action row", async () => {
    mocks.models = [];
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const edit = within(panel).getByRole("button", { name: "Edit" });
    const archive = within(panel).getByRole("button", { name: "Archive mate" });
    expect(edit.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(edit.getAttribute("type")).toBe("button");
    fireEvent.click(edit);
    const form = within(panel).getByRole("form", { name: "Edit mate profile" });
    const save = within(form).getByRole("button", { name: "Save" });
    expect(save).not.toBe(edit);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(within(form).getByRole<HTMLButtonElement>("button", { name: "Model" }).disabled).toBe(true);
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Release bot" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Description" }), { target: { value: "Checks beta releases" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Instructions" }), { target: { value: "Verify signing first." } });
    fireEvent.click(within(form).getByRole("radio", { name: "One-Eye Metal" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Copper" }));
    fireEvent.click(save);
    await waitFor(() => expect(within(panel).queryByRole("form", { name: "Edit mate profile" })).toBeNull());
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Edit" }));
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      accountId: "account", id: "release",
      expectedProfile: { name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", avatar: { shape: "sphere", color: "blue" } },
      profile: { name: "Release bot", description: "Checks beta releases", instructions: "Verify signing first.", avatar: { shape: "metal-copper", color: "coral" } },
    });
    expect(within(panel).getByText("Verify signing first.")).toBeTruthy();
    expect(within(panel).getByText("model", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("shows Claude model versions in Details and saves the selected id and compatible effort", async () => {
    const assistant = mocks.assistants[0];
    assistant.providerId = "claude_code";
    assistant.model = "opus";
    assistant.spaceSnapshot = { ...assistant.spaceSnapshot, name: "Claude" };
    mocks.models = [
      { id: "opus", displayName: "Opus", description: "Opus 5.5 · Complex work", supportedEffortLevels: ["low", "medium", "high"] },
      { id: "fable", displayName: "Fable", description: "Fable 5.2 · Creative work", supportedEffortLevels: ["low", "xhigh"] },
    ];
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    expect(within(panel).getByText("Opus 5.5", { exact: true })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const form = within(panel).getByRole("form", { name: "Edit mate profile" });
    const model = within(form).getByRole("button", { name: "Model" });
    const effort = within(form).getByRole("button", { name: "Effort" });
    expect(model.textContent).toContain("Opus 5.5");
    expect(effort.textContent).toContain("High");

    fireEvent.click(model);
    fireEvent.click(await screen.findByRole("option", { name: "Fable 5.2" }));
    expect(effort.textContent).toContain("Extra High");
    fireEvent.click(effort);
    const low = await screen.findByRole("option", { name: "Low" });
    expect(screen.getAllByRole("option").map(option => option.textContent?.trim())).toEqual(["Low", "Extra High"]);
    fireEvent.click(low);
    fireEvent.change(within(form).getByRole("textbox", { name: "Description" }), { target: { value: "Checks signing" } });
    expect(updateProfile).not.toHaveBeenCalled();

    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(panel).queryByRole("form", { name: "Edit mate profile" })).toBeNull());
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: "release",
      profile: expect.objectContaining({ description: "Checks signing" }),
      modelChange: { model: "fable", effort: "low", expectedModel: "opus", expectedEffort: "high" },
    }));
    expect(within(panel).getByText("Fable 5.2", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("saves skills and permission choices with the Mate profile", async () => {
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const form = within(panel).getByRole("form", { name: "Edit mate profile" });
    fireEvent.click(within(form).getByRole("button", { name: "Expand Skills" }));
    const skills = within(screen.getByRole("dialog", { name: "Skills" }));
    fireEvent.click(skills.getByRole("button", { name: "Add skills" }));
    expect(await screen.findByRole("searchbox", { name: "Search skills" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("option", { name: /Travel research/ }));
    expect(skills.getByText("Travel research")).toBeTruthy();
    fireEvent.click(skills.getByRole("button", { name: "Minimize Skills" }));
    expect(within(form).getByRole("region", { name: "Skills" }).textContent).toContain("1 assigned");
    fireEvent.click(within(form).getByRole("button", { name: "Mate sandbox or profile" }));
    fireEvent.click(await screen.findByRole("option", { name: /Read Only/ }));
    fireEvent.click(within(form).getByRole("button", { name: "Mate approval policy" }));
    fireEvent.click(await screen.findByRole("option", { name: /Untrusted/ }));
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(panel).queryByRole("form", { name: "Edit mate profile" })).toBeNull());
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: "release", skillChange: { ids: ["travel-skill"], expectedIds: [] },
      permissionChange: { mode: "read-only", expectedMode: "workspace-write", approvalMode: "untrusted", expectedApprovalMode: null },
    }));
  });

  it("generates a local skill and saves its assignment from the expanded Skills editor", async () => {
    const draft = { name: "cheap-flight-finder", title: "Cheap flight finder", description: "Find low fares.",
      markdown: "Prefer Skyscanner when available and use another source when needed." };
    generateSkill.mockReturnValueOnce({ unwrap: async () => draft });
    saveSkill.mockReturnValueOnce({ unwrap: async () => {
      const created: AssistantSkill = { id: "new-skill", name: draft.title, description: draft.description, storage: "local" };
      catalogSkills.push(created);
      return created;
    } });
    const { refresh } = setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    expect(within(panel).queryByRole("region", { name: "Plugins" })).toBeNull();
    const summary = within(panel).getByRole("region", { name: "Skills" });
    expect(summary.textContent).toContain("0 assigned");
    fireEvent.click(within(summary).getByRole("button", { name: "Expand Skills" }));
    const skills = within(screen.getByRole("dialog", { name: "Skills" }));
    expect(skills.getByRole("heading", { name: "Release Skills" })).toBeTruthy();
    expect(skills.getByText("No skills assigned")).toBeTruthy();
    expect(skills.getByRole("button", { name: "Import SKILL.md" })).toBeTruthy();
    expect(skills.queryByRole("button", { name: /Unavailable skills/ })).toBeNull();
    fireEvent.click(skills.getByRole("button", { name: "Create with Mains" }));
    fireEvent.change(skills.getByRole("textbox", { name: "Skill workflow" }), { target: { value: "Compare cheap flights" } });
    fireEvent.click(skills.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(skills.getByRole<HTMLTextAreaElement>("textbox", { name: "Skill Markdown" }).value).toBe(draft.markdown));
    fireEvent.click(skills.getByRole("button", { name: "Save skill" }));
    expect(await skills.findByText(draft.title)).toBeTruthy();
    expect(saveSkill).toHaveBeenCalledWith({ accountId: "account", id: "release", input: { draft } });
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(skills.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Skills" })).toBeNull());
    refresh();
    expect(screen.getByRole("region", { name: "Skills" }).textContent).toContain("1 assigned");
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ skillChange: { ids: ["new-skill"], expectedIds: [] } }));
  });

  it("animates the Skills panel in both directions and keeps its draft when minimizing", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, "startViewTransition");
    const start = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve(), skipTransition: vi.fn() };
    });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    try {
      setup("/assistants?assistant=release&run=first&tab=profile");
      const summary = await screen.findByRole("region", { name: "Skills" });
      const expand = within(summary).getByRole("button", { name: "Expand Skills" });
      expect(summary.style.viewTransitionName).toBe("mate-skills");
      fireEvent.click(expand);
      const dialog = screen.getByRole("dialog", { name: "Skills" });
      expect(start).toHaveBeenCalledTimes(1);
      expect(dialog.style.viewTransitionName).toBe("mate-skills");
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      fireEvent.click(within(dialog).getByRole("button", { name: "Create with Mains" }));
      fireEvent.change(within(dialog).getByRole("textbox", { name: "Skill workflow" }), { target: { value: "Check routes" } });
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(start).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog", { name: "Skills" })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(expand));
      fireEvent.click(expand);
      expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Skill workflow" }).value).toBe("Check routes");
    } finally {
      if (descriptor) Object.defineProperty(document, "startViewTransition", descriptor);
      else Reflect.deleteProperty(document, "startViewTransition");
    }
  });

  it("switches the skills section in place from the warning next to New skill", async () => {
    mocks.assistants[0].skills = [...catalogSkills, { id: "missing", name: "Meeting prep", description: "Prepare meetings and follow-ups" }];
    setup("/assistants?assistant=release&run=first&tab=profile");
    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    const skills = within(screen.getByRole("dialog", { name: "Skills" }));
    const modalHeading = skills.getByRole("heading", { name: "Skills" });
    const sectionHeading = skills.getByRole("heading", { name: "Release Skills" });
    expect(skills.getByText("Travel research")).toBeTruthy();
    const newSkill = skills.getByRole("button", { name: "New skill" });
    const unavailable = skills.getByRole("button", { name: "Unavailable skills, 1" });
    expect(unavailable.compareDocumentPosition(newSkill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skills.queryByRole("button", { name: "Remove Meeting prep" })).toBeNull();
    fireEvent.click(unavailable);
    expect(skills.getByRole("heading", { name: "Skills" })).toBe(modalHeading);
    expect(skills.getByRole("heading", { name: "Unavailable skills" })).toBe(sectionHeading);
    expect(skills.getByRole("button", { name: "New skill" })).toBe(newSkill);
    expect(skills.queryByText("Travel research")).toBeNull();
    expect(skills.queryByRole("button", { name: "Add skills" })).toBeNull();
    expect(skills.getByRole("list", { name: "Unavailable skill list" }).textContent).toContain("Prepare meetings and follow-ups");

    const back = skills.getByRole("button", { name: "Back to Skills" });
    expect(back).toBe(unavailable);
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    const restoredWarning = skills.getByRole("button", { name: "Unavailable skills, 1" });
    expect(document.activeElement).toBe(restoredWarning);
    expect(skills.getByRole("heading", { name: "Release Skills" })).toBe(sectionHeading);
    fireEvent.click(restoredWarning);
    fireEvent.click(skills.getByRole("button", { name: "Remove Meeting prep" }));

    expect(skills.queryByRole("button", { name: /Unavailable skills/ })).toBeNull();
    expect(skills.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("fades the bottom of the skill list only while more rows can scroll into view", async () => {
    catalogSkills.push(
      { id: "second", name: "Review notes", description: "Review notes" },
      { id: "third", name: "Plan meetings", description: "Plan meetings" },
      { id: "fourth", name: "Prepare slides", description: "Prepare slides" },
      { id: "fifth", name: "Write summary", description: "Write summary" },
    );
    mocks.assistants[0].skills = [...catalogSkills];
    setup("/assistants?assistant=release&run=first&tab=profile");
    fireEvent.click(await screen.findByRole("button", { name: "Expand Skills" }));
    const list = screen.getByRole("list", { name: "Active skills" });
    Object.defineProperties(list, {
      clientHeight: { value: 242 },
      scrollHeight: { get: () => list.childElementCount * 56 + (list.childElementCount - 1) * 6 },
    });
    fireEvent.scroll(list);
    expect(list.className).toContain("mask-image");
    expect(list.getAttribute("tabindex")).toBe("0");
    list.scrollTop = 62;
    fireEvent.scroll(list);
    expect(list.className).not.toContain("mask-image");

    fireEvent.click(within(list).getByRole("button", { name: "Remove Write summary" }));
    expect(list.className).not.toContain("mask-image");
    expect(list.getAttribute("tabindex")).toBeNull();
  });

  it("keeps the draft on save failure and lets the user cancel it", async () => {
    updateProfile.mockReturnValueOnce({ unwrap: async () => { throw new Error("Stop this assistant’s running conversations before changing teams"); } });
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    const instructions = within(panel).getByRole<HTMLTextAreaElement>("textbox", { name: "Instructions" });
    fireEvent.change(instructions, { target: { value: "Check signing." } });
    const select = within(panel).getByRole("button", { name: "Team" });
    fireEvent.click(select);
    fireEvent.click(await screen.findByRole("option", { name: "No team" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("Stop this mate’s running conversations before changing teams");
    expect(instructions.value).toBe("Check signing.");
    expect(select.textContent).toContain("No team");
    fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
    expect(within(panel).queryByRole("textbox", { name: "Instructions" })).toBeNull();
    expect(within(panel).getByText("Mains", { exact: true })).toBeTruthy();
    expect(within(panel).getByText("Verify the release before distribution.")).toBeTruthy();
  });

  it("disables the team, model and effort controls while saving the profile", async () => {
    mocks.savingProfile = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Team" }).disabled).toBe(true);
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "New team" }).disabled).toBe(true);
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Model" }).disabled).toBe(true);
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Effort" }).disabled).toBe(true);
  });

  it("can save No team without leaving the conversation", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Team" }));
    fireEvent.click(await screen.findByRole("option", { name: "No team" }));
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ teamChange: { teamId: null, expectedTeamId: "team" } }));
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Team" })).toBeNull());
    expect(within(panel).getByText("No team", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("stages a team created in Edit before the team list refreshes", async () => {
    mocks.teams = [];
    mocks.assistants[0].teamId = null;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(within(panel).getByRole("button", { name: "Team" }).textContent).toContain("No team");
    fireEvent.click(within(panel).getByRole("button", { name: "New team" }));
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText("Team name"), { target: { value: "Releases" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Create team" }));
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Team" }).textContent).toContain("Releases"));
    expect(createTeam).toHaveBeenCalledExactlyOnceWith({ accountId: "account", name: "Releases" });
    expect(updateProfile).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ teamChange: { teamId: "new-team", expectedTeamId: null } }));
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Team" })).toBeNull());
    expect(within(panel).getByText("Releases", { exact: true })).toBeTruthy();
  });

  it("resizes the information panel live and saves its width on release", async () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const handle = within(panel).getByRole("separator", { name: "Resize mate panel" });
    const frame = panel.closest<HTMLElement>("[data-assistant-info-panel]")!;
    expect(handle.getAttribute("aria-valuenow")).toBe("416");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(store.getState().appSettings.assistantInfoPanelWidth).toBe(432);
    expect(frame.style.getPropertyValue("--assistant-info-preferred-width")).toBe("432px");

    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(568, 0, 432, 700));
    Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent(handle, new MouseEvent("pointermove", { bubbles: true, clientX: 450 }));
    expect(frame.style.getPropertyValue("--assistant-info-preferred-width")).toBe("550px");
    expect(store.getState().appSettings.assistantInfoPanelWidth).toBe(432);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(store.getState().appSettings.assistantInfoPanelWidth).toBe(550);
    expect(document.body.hasAttribute("data-resizing")).toBe(false);

    fireEvent.click(within(panel).getByRole("button", { name: "Close mate panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const reopened = await screen.findByRole("complementary", { name: "About Release" });
    const restoredHandle = within(reopened).getByRole("separator", { name: "Resize mate panel" });
    expect(restoredHandle.getAttribute("aria-valuenow")).toBe("550");
    fireEvent.doubleClick(restoredHandle);
    expect(store.getState().appSettings.assistantInfoPanelWidth).toBe(416);
  });

  it("centers the profile tab over the rendered chat column throughout panel changes", async () => {
    let syncChatWidth: (() => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(private readonly onResize: () => void) {}
      observe(target: Element) {
        if (target.hasAttribute("data-assistant-chat-column")) syncChatWidth = this.onResize;
      }
      unobserve() {}
      disconnect() {}
    });
    const { container } = setup();
    const chat = container.querySelector<HTMLElement>("[data-assistant-chat-column]")!;
    const profile = screen.getByRole("button", { name: "Release profile" });
    const track = profile.closest<HTMLElement>("[data-assistant-header-track]")!;
    const bounds = vi.spyOn(chat, "getBoundingClientRect");
    const resizeChat = (width: number) => {
      bounds.mockReturnValue(new DOMRect(0, 0, width, 700));
      syncChatWidth?.();
      expect(track.style.width).toBe(`${width}px`);
    };

    resizeChat(1000);
    fireEvent.click(profile);
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    resizeChat(579);
    resizeChat(445);
    fireEvent.click(within(panel).getByRole("button", { name: "Close mate panel" }));
    resizeChat(1000);
    fireEvent.click(screen.getByRole("button", { name: "New mate" }));
    const creationTrack = screen.getByRole("heading", { name: "New mate" }).closest<HTMLElement>("[data-assistant-header-track]");
    expect(creationTrack?.style.width).toBe("");
  });

  it("opens assistant information from the header profile and keeps the selected chat", async () => {
    setup();
    const header = within(screen.getByRole("banner", { name: "Assistant header" }));
    expect(header.getByRole("button", { name: "Release profile" })).toBeTruthy();
    expect(header.getByText("Release")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Assistant conversations" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New mate chat tab" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Closed chats" })).toBeNull();
    fireEvent.click(header.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const trigger = header.getByRole("button", { name: "Release profile" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.classList.contains("rounded-2xl")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(panel).getByText("Verify the release before distribution.")).toBeTruthy();
    expect(within(panel).getByText("Test model", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Close mate panel" }));
    fireEvent.click(within(panel).getByRole("tab", { name: "Memory" }));
    expect(screen.getByRole("tabpanel", { name: "Memory" })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "About Release" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByTestId("conversation").textContent).toBe("first");
    fireEvent.click(screen.getByRole("button", { name: "About Release" }));
    await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("complementary", { name: "About Release" })).toBeNull();
  });

  it("lists and counts only assignments addressed to the selected Mate", async () => {
    const own: AssistantAssignment = {
      id: "release-review", accountId: "account", teamId: "team", toAssistantId: "release",
      fromAssistantId: null, fromRunId: null, parentId: null, taskKey: "review", title: "Review the release",
      prompt: "Check the changelog.", status: "running", execution: { mode: "work" }, workerRunId: "first",
      result: null, evidence: [], error: null, createdAt: new Date(0), updatedAt: new Date(0),
    };
    assignments.push(own,
      { ...own, id: "website-task", toAssistantId: "website", title: "Update the website", status: "queued" },
      { ...own, id: "old-review", teamId: "website-team", title: "Review the previous release", status: "completed" },
    );
    setup("/assistants?assistant=release&run=first&tab=tasks");
    const panel = within(await screen.findByRole("complementary", { name: "About Release" }));

    expect(panel.getByRole("tab", { name: "Assignments · 1" })).toBeTruthy();
    const list = within(panel.getByRole("list", { name: "Assignment list" }));
    expect(list.getByRole("article", { name: own.title })).toBeTruthy();
    expect(list.getByRole("article", { name: "Review the previous release" })).toBeTruthy();
    expect(list.queryByRole("article", { name: "Update the website" })).toBeNull();
  });

  it.each([
    browserPreview,
    { kind: "document", id: "report", doc: { path: "/tmp/report.pdf", fileName: "Report.pdf", docType: "pdf" } },
    { kind: "app", id: "app", title: "Canvas" },
    { kind: "pull-request", id: "pr", title: "PR #1", prRef: { provider: "github", owner: "acme", repo: "app", number: 1 }, url: "https://github.com/acme/app/pull/1" },
  ] satisfies PreviewTab[])("gives the right lane to a $kind preview and keeps Details closed after hiding it", async tab => {
    const { store, container } = setup("/assistants?assistant=release&run=first&tab=profile");
    await screen.findByRole("complementary", { name: "About Release" });
    act(() => store.dispatch(openPreviewTab({ ownerKey: releaseChatOwner, tab })));
    expect(container.querySelector("[data-assistant-info-panel]")).toBeNull();
    expect(new URLSearchParams(screen.getByTestId("location").textContent ?? "").has("tab")).toBe(false);
    act(() => store.dispatch(setPreviewOpen({ ownerKey: releaseChatOwner, open: false })));
    expect(screen.queryByRole("complementary", { name: "About Release" })).toBeNull();
  });

  it("replaces an open preview with Details and keeps the preview tab available", async () => {
    const { store } = setup(undefined, browserPreview);
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    await screen.findByRole("complementary", { name: "About Release" });
    expect(store.getState().preview.byOwner[releaseChatOwner]).toMatchObject({ open: false, tabs: [browserPreview] });
  });

  it("honors a Routines link even if that conversation has an open preview", async () => {
    const { store } = setup("/assistants?assistant=release&tab=routines", browserPreview);
    await screen.findByRole("tabpanel", { name: "Routines" });
    expect(store.getState().preview.byOwner[releaseChatOwner].open).toBe(false);
  });

  it("groups active mates by team and keeps the newest mate first", () => {
    const [release, website] = mocks.assistants;
    website.teamId = "website-team";
    mocks.assistants.push(
      { ...release, id: "travel", name: "Travel planner", teamId: null },
      { ...release, id: "review", name: "PR reviewer" },
      { ...release, id: "archived", name: "Archived mate", isArchived: true },
    );
    setup();

    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    expect(sidebar.getAllByRole("button", { expanded: true }).map(button => button.getAttribute("aria-label"))).toEqual(["Mains", "No team", "Website team"]);
    const mains = within(sidebar.getByRole("region", { name: "Mains" }));
    expect(mains.queryByRole("button", { name: "View assignments for Mains" })).toBeNull();
    expect(mains.getAllByRole("button", { name: /^About / }).map(button => button.getAttribute("aria-label")))
      .toEqual(["About PR reviewer", "About Release"]);
    expect(within(sidebar.getByRole("region", { name: "No team" })).getByRole("button", { name: "About Travel planner" })).toBeTruthy();
    const websiteTeam = within(sidebar.getByRole("region", { name: "Website team" }));
    expect(websiteTeam.getByRole("button", { name: "About Website" })).toBeTruthy();
    expect(sidebar.queryByRole("button", { name: "About Archived mate" })).toBeNull();

    fireEvent.click(websiteTeam.getByRole("button", { name: "Website team", expanded: true }));
    expect(websiteTeam.getByRole("button", { name: "Website team", expanded: false })).toBeTruthy();
    expect(websiteTeam.queryByRole("button", { name: "About Website" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search mates" }));
    const search = screen.getByRole("textbox", { name: "Search mates" });
    fireEvent.change(search, { target: { value: "website" } });
    expect(sidebar.queryByRole("region", { name: "Mains" })).toBeNull();
    expect(websiteTeam.getByRole("button", { name: "About Website" })).toBeTruthy();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(websiteTeam.queryByRole("button", { name: "About Website" })).toBeNull();
    fireEvent.keyDown(websiteTeam.getByRole("button", { name: "Website team", expanded: false }), { key: "Enter" });
    expect(websiteTeam.getByRole("button", { name: "About Website" })).toBeTruthy();
  });

  it("opens Team assignments and links a pending request to its exact Mate conversation", () => {
    const team: AssistantTeamWork = { team: { id: "team", name: "Mains" }, items: [
      { id: "review", kind: "assignment", assistantId: "release", runId: "second", title: "Release review",
        status: "needs_you", pendingKinds: ["ask_user"], pullRequestKey: "github:mains/app#184", updatedAt: new Date() },
      { id: "other", kind: "conversation", assistantId: "website", runId: "website-first", title: "Website announcement",
        status: "running", pendingKinds: [], pullRequestKey: null, updatedAt: new Date() },
    ] };
    pendingApprovals.push(
      { requestId: "secret", runId: "second", kind: "ask_user", toolName: "AskAssistantQuestion", question: "Enter a confidential value", isSecret: true, timestamp: 1 },
      { requestId: "review-question", runId: "second", kind: "ask_user", toolName: "AskAssistantQuestion", question: "Should I review iOS too?", timestamp: 2 },
    );
    readTeamWork.mockReturnValue({ currentData: team });
    setup("/assistants?team=team");

    expect(screen.getByTestId("location").textContent).toBe("?team=team");
    expect(screen.getByRole("heading", { name: "Team assignments" })).toBeTruthy();
    expect(readTeamWork).toHaveBeenCalledWith({ accountId: "account", teamId: "team" }, expect.anything());
    const waiting = within(screen.getByRole("region", { name: "Needs you" }));
    const row = waiting.getByRole("button", { name: /Release review.*Question/ });
    expect(within(row).getByText("mains/app#184")).toBeTruthy();
    fireEvent.click(row);
    const details = within(screen.getByRole("complementary", { name: "Assignment details" }));
    expect(details.getByText("Should I review iOS too?")).toBeTruthy();
    expect(details.queryByText("Enter a confidential value")).toBeNull();
    expect(screen.getByTestId("location").textContent).toBe("?team=team");
    fireEvent.click(details.getByRole("button", { name: "Open chat" }));
    expect(screen.getByTestId("conversation").textContent).toBe("second");
  });

  it("opens assignment details for work without a dispatched conversation", () => {
    readTeamWork.mockReturnValue({ currentData: { team: { id: "team", name: "Mains" }, items: [
      { id: "queued-task", kind: "assignment", assistantId: "release", runId: null, title: "Draft release notes",
        status: "queued", pendingKinds: [], pullRequestKey: null, updatedAt: new Date() },
    ] } satisfies AssistantTeamWork });
    setup("/assistants?team=team");
    fireEvent.click(screen.getByRole("button", { name: /Draft release notes/ }));
    const details = within(screen.getByRole("complementary", { name: "Assignment details" }));
    expect(details.queryByRole("button", { name: "Open chat" })).toBeNull();
    expect(readAssignment).toHaveBeenCalledWith({ accountId: "account", id: "queued-task" }, { skip: false });
    expect(screen.queryByTestId("conversation")).toBeNull();
  });

  it("assigns work to a selected teammate on the team page", async () => {
    readTeamWork.mockReturnValue({ currentData: { team: { id: "team", name: "Mains" }, items: [] } satisfies AssistantTeamWork });
    assignTask.mockReturnValue({ unwrap: async () => ({
      id: "release-notes", toAssistantId: "website", title: "Draft release notes", updatedAt: new Date(),
    }) });
    setup("/assistants?team=team");
    fireEvent.click(screen.getByRole("button", { name: "New assignment" }));
    const form = within(screen.getByRole("form", { name: "New assignment" }));
    expect(form.getByRole<HTMLButtonElement>("button", { name: "Assign task" }).disabled).toBe(true);
    fireEvent.click(form.getByRole("button", { name: "Assign to" }));
    fireEvent.click(screen.getByRole("option", { name: "Website" }));
    fireEvent.change(form.getByLabelText("Assignment title"), { target: { value: "Draft release notes" } });
    fireEvent.change(form.getByLabelText("Scope and completion criteria"), { target: { value: "Summarize the merged PRs." } });
    fireEvent.click(form.getByRole("button", { name: "Assign task" }));

    const details = within(await screen.findByRole("complementary", { name: "Assignment details" }));
    expect(details.getByRole("heading", { name: "Draft release notes" })).toBeTruthy();
    expect(assignTask).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", toAssistantId: "website",
      expectedTeamId: "team", title: "Draft release notes", prompt: "Summarize the merged PRs.", execution: { mode: "work" } }));
  });

  it("filters only the assistant list without switching the current chat", async () => {
    setup();
    const sidebar = within(screen.getByRole("navigation", { name: "Mates" }));
    const heading = screen.getByRole("heading", { name: "Mates" });
    expect(heading.compareDocumentPosition(screen.getByRole("button", { name: "New mate" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sidebar.queryByRole("button", { name: "First release" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search mates" }));
    const search = screen.getByRole("textbox", { name: "Search mates" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "own the website" } });
    expect(sidebar.queryByRole("button", { name: /^Release/ })).toBeNull();
    expect(sidebar.getByRole("button", { name: /^Website/ })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search mates" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search mates" }));
    expect(sidebar.getByRole("button", { name: /^Release/ })).toBeTruthy();
  });

  it("preserves each assistant's selected conversation through creation and sidebar switches", async () => {
    setup("/assistants?assistant=release&run=second");
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    fireEvent.click(screen.getByRole("button", { name: "New mate" }));
    const form = screen.getByRole("form", { name: "Create mate" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("conversation")).toBeNull();
    const header = screen.getByRole("banner", { name: "Assistant header" });
    expect(within(header).getByRole("heading", { name: "New mate" })).toBeTruthy();
    expect(header.querySelector("[data-avatar-shape='terminal-amber']")).toBeTruthy();

    const name = within(form).getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Travel planner" } });
    expect(within(header).getByRole("heading", { name: "Travel planner" })).toBeTruthy();
    fireEvent.change(name, { target: { value: "" } });
    expect(within(header).getByRole("heading", { name: "New mate" })).toBeTruthy();

    const amber = within(form).getByRole("radio", { name: "Amber" });
    const frost = within(form).getByRole("radio", { name: "Frost" });
    fireEvent.keyDown(amber, { key: "End" });
    expect(document.activeElement).toBe(frost);
    expect(frost.getAttribute("aria-checked")).toBe("true");
    expect(header.querySelector("[data-avatar-shape='terminal-frost']")).toBeTruthy();
    fireEvent.click(within(form).getByRole("radio", { name: "Specialists" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Designer" }));
    expect(header.querySelector("[data-avatar-shape='specialist-design']")).toBeTruthy();

    fireEvent.click(within(header).getByRole("button", { name: "Close new mate" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    expect(within(header).queryByRole("button", { name: "Close new mate" })).toBeNull();
    expect(within(header).getByRole("button", { name: "Release profile" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Website/ }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("website-first"));
    expect(screen.getByRole("button", { name: "Website profile" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Release/ }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    expect(screen.getByRole("button", { name: "Release profile" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("keeps existing chats when a draft becomes a real conversation", async () => {
    const { store } = setup("/assistants?assistant=release&run=new");
    expect(screen.getByTestId("conversation").textContent).toBe("draft");
    const profile = screen.getByRole("button", { name: "Release profile" });
    fireEvent.click(screen.getByRole("button", { name: "Send draft" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("third"));
    expect(mocks.chats.map(chat => chat.id)).toEqual(["third", "first", "second"]);
    expect(Object.values(store.getState().assistants.views)[0].activeRunId).toBe("third");
    expect(screen.getByRole("button", { name: "Release profile" })).toBe(profile);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
