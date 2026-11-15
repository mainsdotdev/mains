// @vitest-environment jsdom
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantConversation } from "@mains/contracts/assistants";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import assistantsReducer from "@/lib/redux/slices/assistantsSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import { AssistantsSidebar } from "@/features/assistants/components/assistants-sidebar";
import AssistantsPage from "./Assistants";

const mocks = vi.hoisted(() => ({ chats: [] as AssistantConversation[], assistants: [] as Assistant[], websiteChats: [{ id: "website-first", title: "Website announcement", goal: "Page", status: "succeeded", createdAt: new Date(0) }] }));
vi.mock("@/lib/redux/api", () => ({ useGetAccountQuery: () => ({ data: { id: "account" } }) }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssistantOverviewQuery: () => ({ currentData: { assistants: mocks.assistants, teams: [], assignments: [], memories: [] }, refetch: vi.fn() }),
  useAssistantConversationsQuery: ({ id }: { id: string }) => ({ currentData: id === "website" ? mocks.websiteChats : mocks.chats }),
  useArchiveAssistantMutation: () => [vi.fn(), {}],
}));
vi.mock("@/features/assistants/hooks/use-assistant-updates", () => ({ useAssistantUpdates() {} }));
vi.mock("@/features/assistants/components/assistant-chat", () => ({ AssistantChat: ({ selectedRunId, onSelectRun, onOpenDetails }: { selectedRunId: string | null; onSelectRun(id: string): void; onOpenDetails(): void }) => <div>{!selectedRunId && <button aria-label="Center assistant monogram" onClick={onOpenDetails}>R</button>}<output data-testid="conversation">{selectedRunId ?? "draft"}</output><button onClick={() => { mocks.chats = [...mocks.chats, { id: "third", title: "Third release", goal: "Third", status: "succeeded", createdAt: new Date() }]; onSelectRun("third"); }}>Send draft</button></div> }));
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
  mocks.chats = ["first", "second"].map((id, index) => ({ id, title: index ? "Second release" : "First release", goal: id, status: "succeeded", createdAt: new Date() }));
  mocks.assistants = [{ id: "release", accountId: "account", teamId: "team", name: "Release", description: "Own releases", instructions: "Verify the release before distribution.", isArchived: false, providerId: "codex", avatar: { shape: "sphere", color: "blue" }, model: "model", effort: "high", spaceSnapshot: { name: "Codex" } } as Assistant];
  mocks.assistants.push({ ...mocks.assistants[0], id: "website", name: "Website", description: "Own the website" });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("assistant profile and conversation", () => {
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
    expect(mocks.chats.map(chat => chat.id)).toEqual(["first", "second", "third"]);
    expect(Object.values(store.getState().assistants.views)[0].activeRunId).toBe("third");
    expect(screen.getByRole("button", { name: "Release profile" })).toBe(profile);
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
