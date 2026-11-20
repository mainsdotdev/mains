// @vitest-environment jsdom
import { useLayoutEffect, useState, type ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantConversation, AssistantTeam, AssistantWelcome, UpdateAssistantProfile } from "@mains/contracts/assistants";
import type { Pulse } from "@/lib/redux/api/pulseApi";
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

const mocks = vi.hoisted(() => ({ routines: [] as Pulse[], chats: [] as AssistantConversation[], assistants: [] as Assistant[], teams: [] as AssistantTeam[], savingProfile: false, loadingChats: false, chatsError: undefined as unknown, refetchChats: vi.fn(), websiteChats: [{ id: "website-first", title: "Website announcement", goal: "Page", status: "succeeded", mode: "work", workspaceId: null, workspaceName: null, projectName: null, createdAt: new Date(0), updatedAt: new Date(0) }] }));
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const createTeam = vi.hoisted(() => vi.fn());
const createMate = vi.hoisted(() => vi.fn());
const archiveMate = vi.hoisted(() => vi.fn());
const removeMate = vi.hoisted(() => vi.fn());
const updateProfile = vi.hoisted(() => vi.fn());
const welcomes = vi.hoisted(() => [] as AssistantWelcome[]);
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useGetProvidersQuery: () => ({ data: [{ id: "codex", isEnabled: true }] }),
  useGetSpacesQuery: () => ({ data: [{ id: "codex", accountId: "account", providerId: "codex", isArchived: false }] }),
  useGetProviderModelsQuery: () => ({ currentData: [{ id: "model", displayName: "Test model" }], isFetching: false }),
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssistantOverviewQuery: () => ({ currentData: { assistants: mocks.assistants, teams: mocks.teams, assignments: [], memories: [], welcomes }, refetch: vi.fn() }),
  useAssistantConversationsQuery: ({ id }: { id: string }) => ({ currentData: mocks.loadingChats ? undefined : id === "website" ? mocks.websiteChats : mocks.chats, error: mocks.chatsError, refetch: mocks.refetchChats }),
  useArchiveAssistantMutation: () => [archiveMate, {}],
  useRemoveAssistantMutation: () => [removeMate, {}],
  useUpdateAssistantProfileMutation: () => [updateProfile, { isLoading: mocks.savingProfile }],
  useCreateAssistantMutation: () => [createMate, {}],
  useCreateAssistantTeamMutation: () => [createTeam, {}],
}));
vi.mock("@/lib/redux/api/pulseApi", () => ({
  useGetPulsesQuery: () => ({ currentData: mocks.routines, refetch: vi.fn() }),
  useDeletePulseMutation: () => [vi.fn(), {}], useTogglePulseMutation: () => [vi.fn(), {}], useRunPulseNowMutation: () => [vi.fn(), {}],
}));
vi.mock("@/features/assistants/hooks/use-assistant-updates", () => ({ useAssistantUpdates() {} }));
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
vi.mock("@/features/assistants/components/assistant-assignments", () => ({ AssistantAssignments: () => null }));
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
  return { store, ...render(<Wrapper><AssistantsSidebar /><AssistantsPage /><HeaderOutlet /><Location /></Wrapper>) };
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  createMate.mockReset();
  archiveMate.mockReset().mockReturnValue({ unwrap: async () => undefined });
  removeMate.mockReset().mockReturnValue({ unwrap: async () => undefined });
  welcomes.length = 0;
  createTeam.mockReset().mockImplementation((input: Pick<AssistantTeam, "accountId" | "name">) =>
    ({ unwrap: () => Promise.resolve({ ...input, id: "new-team", createdAt: new Date(0) }) }));
  updateProfile.mockReset().mockImplementation(({ id, profile, teamChange }: UpdateAssistantProfile) => ({
    unwrap: async () => {
      const assistant = mocks.assistants.find(assistant => assistant.id === id)!;
      Object.assign(assistant, profile);
      if (teamChange) assistant.teamId = teamChange.teamId;
      return assistant;
    },
  }));
  mocks.savingProfile = false;
  mocks.routines = [];
  mocks.loadingChats = false;
  mocks.chatsError = undefined;
  mocks.refetchChats.mockReset();
  mocks.teams = [{ id: "team", accountId: "account", name: "Mains", createdAt: new Date(0) }, { id: "website-team", accountId: "account", name: "Website team", createdAt: new Date(0) }, { id: "foreign-team", accountId: "foreign-account", name: "Foreign team", createdAt: new Date(0) }];
  mocks.chats = ["first", "second"].map((id, index) => ({ id, title: index ? "Second release" : "First release", goal: id, status: "succeeded", mode: index ? "work" : "developer", workspaceId: index ? null : "mains-ios", workspaceName: index ? null : "feat/ios", projectName: index ? null : "mains", createdAt: new Date(), updatedAt: new Date(Date.now() - (index + 1) * 60_000) }));
  mocks.assistants = [{ id: "release", accountId: "account", teamId: "team", name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", isArchived: false, providerId: "codex", avatar: { shape: "sphere", color: "blue" }, model: "model", effort: "high", spaceSnapshot: { name: "Codex" } } as Assistant];
  mocks.assistants.push({ ...mocks.assistants[0], id: "website", name: "Website", description: "Own the website" });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("assistant profile and conversation", () => {
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
    expect(avatars.map(avatar => avatar.getAttribute("data-avatar-shape"))).toEqual(["terminal-amber", "clear-violet", "metal-silver"]);
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
    setup("/assistants?assistant=release&run=first&tab=profile");
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const edit = within(panel).getByRole("button", { name: "Edit" });
    const archive = within(panel).getByRole("button", { name: "Archive mate" });
    expect(archive.nextElementSibling).toBe(edit);
    const openEditor = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(edit, openEditor);
    expect(openEditor.defaultPrevented).toBe(true);
    const form = within(panel).getByRole("form", { name: "Edit mate profile" });
    const save = within(form).getByRole("button", { name: "Save" });
    expect(save).not.toBe(edit);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(within(form).queryByRole("textbox", { name: "Model" })).toBeNull();
    fireEvent.change(within(form).getByRole("textbox", { name: "Name" }), { target: { value: "Release bot" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Description" }), { target: { value: "Checks beta releases" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Instructions" }), { target: { value: "Verify signing first." } });
    fireEvent.click(within(form).getByRole("radio", { name: "Clear Shell" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Coral Kite" }));
    fireEvent.click(save);
    await waitFor(() => expect(within(panel).queryByRole("form", { name: "Edit mate profile" })).toBeNull());
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      accountId: "account", id: "release",
      expectedProfile: { name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", avatar: { shape: "sphere", color: "blue" } },
      profile: { name: "Release bot", description: "Checks beta releases", instructions: "Verify signing first.", avatar: { shape: "clear-coral", color: "coral" } },
    });
    expect(within(panel).getByText("Verify signing first.")).toBeTruthy();
    expect(within(panel).getByText("model", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
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

  it("disables the team picker and team creation while saving the profile", async () => {
    mocks.savingProfile = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    fireEvent.click(within(panel).getByRole("button", { name: "Edit" }));
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "Team" }).disabled).toBe(true);
    expect(within(panel).getByRole<HTMLButtonElement>("button", { name: "New team" }).disabled).toBe(true);
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
    expect(within(panel).getByText("model", { exact: true })).toBeTruthy();
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
    expect(sidebar.getAllByRole("button", { expanded: true }).map(button => button.textContent)).toEqual(["Mains", "No team", "Website team"]);
    const mains = within(sidebar.getByRole("region", { name: "Mains" }));
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
    fireEvent.click(within(form).getByRole("radio", { name: "Clear Shell" }));
    fireEvent.click(within(form).getByRole("radio", { name: "Rose Prism" }));
    expect(header.querySelector("[data-avatar-shape='clear-rose']")).toBeTruthy();

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
