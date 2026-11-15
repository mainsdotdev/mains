// @vitest-environment jsdom
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantConversation, AssistantTeam } from "@mains/contracts/assistants";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import assistantsReducer from "@/lib/redux/slices/assistantsSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { AssistantsSidebar } from "@/features/assistants/components/assistants-sidebar";
import AssistantsPage from "./Assistants";

const mocks = vi.hoisted(() => ({ chats: [] as AssistantConversation[], assistants: [] as Assistant[], teams: [] as AssistantTeam[], changeTeam: vi.fn(), changingTeam: false, teamError: undefined as unknown, loadingChats: false, chatsError: undefined as unknown, refetchChats: vi.fn(), websiteChats: [{ id: "website-first", title: "Website announcement", goal: "Page", status: "succeeded", mode: "work", workspaceId: null, workspaceName: null, projectName: null, createdAt: new Date(0), updatedAt: new Date(0) }] }));
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
vi.mock("@/lib/redux/api", () => ({ useGetAccountQuery: () => ({ data: { id: "account" } }) }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssistantOverviewQuery: () => ({ currentData: { assistants: mocks.assistants, teams: mocks.teams, assignments: [], memories: [] }, refetch: vi.fn() }),
  useAssistantConversationsQuery: ({ id }: { id: string }) => ({ currentData: mocks.loadingChats ? undefined : id === "website" ? mocks.websiteChats : mocks.chats, error: mocks.chatsError, refetch: mocks.refetchChats }),
  useArchiveAssistantMutation: () => [vi.fn(), {}],
  useChangeAssistantTeamMutation: () => [mocks.changeTeam, { isLoading: mocks.changingTeam, error: mocks.teamError }],
}));
vi.mock("@/features/assistants/hooks/use-assistant-updates", () => ({ useAssistantUpdates() {} }));
vi.mock("@/features/assistants/components/assistant-chat", () => ({ AssistantChat: ({ selectedRunId, onSelectRun, onOpenDetails }: { selectedRunId: string | null; onSelectRun(id: string): void; onOpenDetails(): void }) => <div>{!selectedRunId && <button aria-label="Center assistant monogram" onClick={onOpenDetails}>R</button>}<output data-testid="conversation">{selectedRunId ?? "draft"}</output><button onClick={() => { mocks.chats = [{ id: "third", title: "Third release", goal: "Third", status: "succeeded", mode: "work", workspaceId: null, workspaceName: null, projectName: null, createdAt: new Date(), updatedAt: new Date() }, ...mocks.chats]; onSelectRun("third"); }}>Send draft</button></div> }));
vi.mock("@/features/assistants/components/assistant-profile-form", () => ({ AssistantProfileForm: ({ onClose }: { onClose(): void }) => <form aria-label="Create assistant"><button type="button" onClick={onClose}>Cancel</button></form> }));
vi.mock("@/features/assistants/components/assistant-memory", () => ({ AssistantMemoryPanel: () => null }));
vi.mock("@/features/assistants/components/assistant-assignments", () => ({ AssistantAssignments: () => null }));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView() {} }));
vi.mock("@/lib/platform", () => ({ useIsMobile: () => false, useCapabilities: () => ({ windowChrome: false }) }));

function HeaderOutlet() { return <header aria-label="Assistant header">{useMainHeader().header}</header>; }
function Location() { return <output data-testid="location">{useLocation().search}</output>; }
function setup(initial = "/assistants?assistant=release&run=first") {
  const store = configureStore({ reducer: {
    appSettings: appSettingsReducer, workspace: workspaceReducer, assistants: assistantsReducer,
    backends: () => ({ activeBackendId: "local" }),
  } });
  const Wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter initialEntries={[initial]}><MainHeaderProvider>{children}</MainHeaderProvider></MemoryRouter></Provider>;
  return { store, ...render(<Wrapper><AssistantsSidebar /><AssistantsPage /><HeaderOutlet /><Location /></Wrapper>) };
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.changeTeam.mockReset().mockResolvedValue({ data: {} });
  mocks.changingTeam = false;
  mocks.teamError = undefined;
  mocks.loadingChats = false;
  mocks.chatsError = undefined;
  mocks.refetchChats.mockReset();
  mocks.teams = [{ id: "team", accountId: "account", name: "Mains", createdAt: new Date(0) }, { id: "website-team", accountId: "account", name: "Website team", createdAt: new Date(0) }, { id: "foreign-team", accountId: "foreign-account", name: "Foreign team", createdAt: new Date(0) }];
  mocks.chats = ["first", "second"].map((id, index) => ({ id, title: index ? "Second release" : "First release", goal: id, status: "succeeded", mode: index ? "work" : "developer", workspaceId: index ? null : "mains-ios", workspaceName: index ? null : "feat/ios", projectName: index ? null : "mains", createdAt: new Date(), updatedAt: new Date(Date.now() - (index + 1) * 60_000) }));
  mocks.assistants = [{ id: "release", accountId: "account", teamId: "team", name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", isArchived: false, providerId: "codex", avatar: { shape: "sphere", color: "blue" }, model: "model", effort: "high", spaceSnapshot: { name: "Codex" } } as Assistant];
  mocks.assistants.push({ ...mocks.assistants[0], id: "website", name: "Website", description: "Own the website" });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

describe("assistant profile and conversation", () => {
  it("opens previous chats with location and activity while keeping the Chats panel open", async () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Chats" }));
    const panel = screen.getByRole("tabpanel", { name: "Chats" });
    const first = within(panel).getByRole("button", { name: /First release/ });
    const second = within(panel).getByRole("button", { name: /Second release/ });
    expect(first.getAttribute("aria-current")).toBe("page");
    expect(first.textContent).toContain("mains / feat/ios");
    expect(first.querySelector("time")?.getAttribute("datetime")).toBe(mocks.chats[0].updatedAt.toISOString());
    expect(second.textContent).toContain("Work");

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
  it("changes an existing assistant’s team with the library Select in Details", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const select = within(panel).getByRole("button", { name: "Team" });
    expect(select.textContent).toContain("Mains");
    fireEvent.click(select);
    expect(screen.queryByRole("option", { name: "Foreign team" })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "Website team" }));
    expect(mocks.changeTeam).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "release", teamId: "website-team" });
    expect(screen.getByTestId("conversation").textContent).toBe("first");
  });

  it("disables the team picker during a save and displays membership errors", async () => {
    mocks.changingTeam = true;
    mocks.teamError = { error: "Stop this assistant’s running conversations before changing teams" };
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    expect((within(panel).getByRole("button", { name: "Team" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByRole("status").textContent).toContain("Changing team");
    expect(within(panel).getByRole("alert").textContent).toContain("running conversations");
    expect(mocks.changeTeam).not.toHaveBeenCalled();
  });

  it("resizes the information panel live and saves its width on release", async () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const handle = within(panel).getByRole("separator", { name: "Resize assistant panel" });
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

    fireEvent.click(within(panel).getByRole("button", { name: "Close assistant panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Release profile" }));
    const reopened = await screen.findByRole("complementary", { name: "About Release" });
    const restoredHandle = within(reopened).getByRole("separator", { name: "Resize assistant panel" });
    expect(restoredHandle.getAttribute("aria-valuenow")).toBe("550");
    fireEvent.doubleClick(restoredHandle);
    expect(store.getState().appSettings.assistantInfoPanelWidth).toBe(416);
  });

  it("opens assistant information from the header profile and keeps the selected chat", async () => {
    setup();
    const header = within(screen.getByRole("banner", { name: "Assistant header" }));
    expect(header.getByRole("button", { name: "Release profile" })).toBeTruthy();
    expect(header.getByText("Release")).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Assistant conversations" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New assistant chat tab" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Closed chats" })).toBeNull();
    fireEvent.click(header.getByRole("button", { name: "Release profile" }));
    const panel = await screen.findByRole("complementary", { name: "About Release" });
    const trigger = header.getByRole("button", { name: "Release profile" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(panel).getByText("Verify the release before distribution.")).toBeTruthy();
    expect(within(panel).getByText("model", { exact: true })).toBeTruthy();
    expect(screen.getByTestId("conversation").closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Close assistant panel" }));
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

  it("filters only the assistant list without switching the current chat", async () => {
    setup();
    const sidebar = within(screen.getByRole("navigation", { name: "Assistants" }));
    expect(screen.queryByText("Assistants", { exact: true })).toBeNull();
    expect(sidebar.queryByRole("button", { name: "First release" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search assistants" }));
    const search = screen.getByRole("textbox", { name: "Search assistants" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "own the website" } });
    expect(sidebar.queryByRole("button", { name: /^Release/ })).toBeNull();
    expect(sidebar.getByRole("button", { name: /^Website/ })).toBeTruthy();
    expect(screen.getByTestId("conversation").textContent).toBe("first");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Search assistants" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search assistants" }));
    expect(sidebar.getByRole("button", { name: /^Release/ })).toBeTruthy();
  });

  it("preserves each assistant's selected conversation through creation and sidebar switches", async () => {
    setup("/assistants?assistant=release&run=second");
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    expect(screen.getByRole("form", { name: "Create assistant" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("conversation")).toBeNull();
    expect(within(screen.getByRole("banner", { name: "Assistant header" })).queryByRole("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByTestId("conversation").textContent).toBe("second"));
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
