// @vitest-environment jsdom
import { useEffect, useImperativeHandle, useRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import atlasReducer from "@/lib/redux/slices/atlasSlice";
import { MainHeaderProvider, useMainHeader } from "@/hooks/use-main-header";
import type { AtlasPageEditorHandle } from "@/features/atlas/components/atlas-page-editor";
import Atlas from "./Atlas";
import type { ProviderVariant } from "@/lib/provider-variants";
import { requestAtlasPage, type AtlasPageAction, type AtlasPendingPageAction } from "@/features/atlas/lib/page-actions";
import { useModeConfig } from "@/hooks/use-mode-config";

const mocks = vi.hoisted(() => ({
  flush: vi.fn(), create: vi.fn(), error: vi.fn(), performAction: vi.fn(),
  providerVariant: "codex" as ProviderVariant,
  spaceMode: "chat" as "chat" | "work" | "developer",
  readAccount: vi.fn(),
  transport: "backend-a",
  items: [{ id: "one", title: "Page One" }, { id: "two", title: "Page Two" }],
}));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { activeSpaceId: "active-space" }, isLoading: false }),
  useGetSpacesQuery: () => ({ data: [{ id: "active-space", accountId: "account-1", providerId: "codex", mode: mocks.spaceMode }], isLoading: false }),
  useGetAccountQuery: () => {
  mocks.readAccount();
  return { data: { id: "account-1" } };
} }));
vi.mock("@/hooks/use-space-provider-variant", async () => {
  const { getProviderVariant } = await import("@/lib/provider-variants");
  return { useSpaceProviderVariant: () => getProviderVariant(mocks.providerVariant) };
});
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasQuery: () => ({ data: mocks.items }),
  useCreateAtlasPageMutation: () => [mocks.create, {}],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => mocks.transport }));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error },
}));
vi.mock("@/features/atlas/components/atlas-page-editor", () => ({
  default: function Editor({ id, handleRef, onTitleChange, requestedAction, onActionHandled }: {
    id: string; handleRef: React.Ref<AtlasPageEditorHandle>; onTitleChange: (title: string) => void;
    requestedAction?: AtlasPendingPageAction; onActionHandled?: (token: string) => void;
  }) {
    useImperativeHandle(handleRef, () => ({ flush: () => mocks.flush(id), collectionId: "project-1", performAction: (action: AtlasPageAction) => mocks.performAction(id, action) }), [id]);
    const handled = useRef<string | null>(null);
    useEffect(() => {
      if (!requestedAction || handled.current === requestedAction.token) return;
      handled.current = requestedAction.token;
      onActionHandled?.(requestedAction.token);
      mocks.performAction(id, requestedAction.action);
    }, [id, requestedAction, onActionHandled]);
    useEffect(() => { onTitleChange(mocks.items.find((item) => item.id === id)?.title ?? "Untitled page"); }, [id, onTitleChange]);
    const mode = useModeConfig().mode;
    return <><div data-testid="editor">{id}</div><output data-testid="editor-mode">{mode}</output><button onClick={() => onTitleChange("Edited title")}>Rename page</button></>;
  },
}));
vi.mock("@/features/atlas/components/atlas-library", () => ({ AtlasLibrary: function Library() {
  const navigate = useNavigate();
  const mode = useModeConfig().mode;
  return <><div>Library</div><output data-testid="library-mode">{mode}</output>{mocks.items.map((item) => <button key={item.id} onClick={() => navigate(`/atlas/${item.id}`)}>Open {item.title}</button>)}</>;
} }));

function Home() { return <output data-testid="home-mode">{useModeConfig().mode}</output>; }
vi.mock("@/features/atlas/components/atlas-image-creator", () => ({ default: () => <div>Image creator</div> }));

function HeaderHost() {
  const { header } = useMainHeader();
  const location = useLocation();
  const navigate = useNavigate();
  return <><div>{header}</div><output data-testid="route">{location.pathname}{location.search}</output>
    <output data-testid="pending-action">{location.state?.atlasPageAction?.token ?? ""}</output>
    <button onClick={() => navigate("/atlas?type=page")}>Pages library</button>
    <button onClick={() => navigate("/")}>Home</button></>;
}
function setup(path = "/atlas/one") {
  const store = configureStore({ reducer: {
    atlas: atlasReducer,
    appSettings: () => ({ sidebarCollapsed: false }),
    backends: () => ({ activeBackendId: null }),
  } });
  render(<Provider store={store}><MemoryRouter initialEntries={[path]}>
    <MainHeaderProvider><HeaderHost /><Routes>
      <Route path="/atlas/images/new" element={<Atlas imageCreation />} />
      <Route path="/atlas/images/runs/:runId" element={<Atlas imageCreation />} />
      <Route path="/atlas/:itemId?" element={<Atlas />} /><Route path="/" element={<Home />} /></Routes></MainHeaderProvider>
  </MemoryRouter></Provider>);
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.providerVariant = "codex";
  mocks.spaceMode = "chat";
  mocks.transport = "backend-a";
  mocks.performAction.mockResolvedValue(undefined);
  mocks.flush.mockResolvedValue(true);
  mocks.create.mockImplementation(() => ({ unwrap: async () => ({ item: { id: "new-page" } }) }));
});
afterEach(cleanup);

describe("Atlas page tabs", () => {
  it.each(["/atlas/images/new", "/atlas/images/runs/image-run"])("opens %s without creating a Page tab", async (path) => {
    setup(path);
    expect(await screen.findByText("Image creator")).toBeTruthy();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
  it.each(["chat", "developer"] as const)("uses Work throughout Atlas and restores %s when returning Home", async (mode) => {
    mocks.spaceMode = mode;
    setup();
    await screen.findByTestId("editor");
    expect(screen.getByTestId("editor-mode").textContent).toBe("work");
    fireEvent.click(screen.getByRole("button", { name: "Pages library" }));
    await screen.findByText("Library");
    expect(screen.getByTestId("library-mode").textContent).toBe("work");
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(screen.getByTestId("home-mode").textContent).toBe(mode);
    expect(mocks.spaceMode).toBe(mode);
  });
  it.each(["copilot", "cursor"] as const)("blocks direct Page URLs for %s before mounting Atlas data and tabs", (provider) => {
    mocks.providerVariant = provider;
    setup();
    expect(screen.getByText("Atlas isn't available for this agent yet.")).toBeTruthy();
    expect(mocks.readAccount).not.toHaveBeenCalled();
    expect(screen.queryByTestId("editor")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("allows Claude to open an existing Atlas Page", async () => {
    mocks.providerVariant = "claude";
    setup();
    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.queryByText("Atlas isn't available for this agent yet.")).toBeNull();
  });

  it("opens existing pages once, keeps the strip in the library, and switches between them", async () => {
    setup();
    await screen.findByRole("tab", { name: "Page One" });
    fireEvent.click(screen.getByRole("button", { name: "Pages library" }));
    await screen.findByText("Library");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open Page Two" }));
    await screen.findByRole("tab", { name: "Page Two" });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "Page One" }));
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("one"));
    expect(screen.getByRole("tab", { name: "Page One" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("creates a page with the plus button and opens it beside the current page", async () => {
    setup();
    await screen.findByRole("tab", { name: "Page One" });
    fireEvent.click(screen.getByRole("button", { name: "New Atlas page tab" }));
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("new-page"));
    expect(mocks.flush).toHaveBeenCalledWith("one");
    expect(mocks.create).toHaveBeenCalledWith({ accountId: "account-1", title: "Untitled page", collectionId: "project-1" });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("closes an inactive tab without changing the current page, then returns to Pages when the last tab closes", async () => {
    const store = setup();
    await screen.findByRole("tab", { name: "Page One" });
    fireEvent.click(screen.getByRole("button", { name: "New Atlas page tab" }));
    await screen.findByRole("tab", { name: "Untitled page" });
    fireEvent.click(screen.getByRole("button", { name: "Close Page One" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(screen.getByTestId("editor").textContent).toBe("new-page");
    fireEvent.click(screen.getByRole("button", { name: "Close Untitled page" }));
    await screen.findByText("Library");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(store.getState().atlas.byOwner['["local","account-1"]'].tabs).toEqual([]);
  });

  it("waits for saving before switching and keeps the page open if saving fails", async () => {
    setup();
    await screen.findByRole("tab", { name: "Page One" });
    fireEvent.click(screen.getByRole("button", { name: "New Atlas page tab" }));
    await screen.findByRole("tab", { name: "Untitled page" });
    let finish!: (saved: boolean) => void;
    mocks.flush.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("tab", { name: "Page One" }));
    expect(screen.getByTestId("editor").textContent).toBe("new-page");
    await act(async () => finish(false));
    expect(screen.getByTestId("editor").textContent).toBe("new-page");
    mocks.flush.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("tab", { name: "Page One" }));
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("one"));
  });

  it("updates the active tab title and supports arrow-key navigation", async () => {
    setup();
    await screen.findByRole("tab", { name: "Page One" });
    fireEvent.click(screen.getByRole("button", { name: "New Atlas page tab" }));
    const tab = await screen.findByRole("tab", { name: "Untitled page" });
    fireEvent.click(screen.getByRole("button", { name: "Rename page" }));
    expect(screen.getByRole("tab", { name: "Edited title" })).toBe(tab);
    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("one"));
  });

  it("performs a sidebar action against the active editor without switching or losing its draft", async () => {
    setup();
    await screen.findByTestId("editor");
    act(() => requestAtlasPage({ ownerKey: '["local","account-1"]', id: "one", action: { type: "copy" } }));
    await waitFor(() => expect(mocks.performAction).toHaveBeenCalledWith("one", { type: "copy" }));
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(screen.getByTestId("route").textContent).toBe("/atlas/one");
  });

  it("waits for saving, opens the requested Page, and consumes its action once", async () => {
    setup();
    await screen.findByTestId("editor");
    let finish!: (saved: boolean) => void;
    mocks.flush.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    act(() => requestAtlasPage({ ownerKey: '["local","account-1"]', id: "two", action: { type: "history" } }));
    expect(mocks.performAction).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor").textContent).toBe("one");
    await act(async () => finish(true));
    await waitFor(() => expect(mocks.performAction).toHaveBeenCalledExactlyOnceWith("two", { type: "history" }));
    expect(screen.getByTestId("pending-action").textContent).toBe("");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("keeps the current Page and skips the action if its draft cannot save", async () => {
    setup();
    await screen.findByTestId("editor");
    mocks.flush.mockResolvedValue(false);
    await act(async () => requestAtlasPage({ ownerKey: '["local","account-1"]', id: "two", action: { type: "trash" } }));
    expect(screen.getByTestId("editor").textContent).toBe("one");
    expect(mocks.performAction).not.toHaveBeenCalled();
  });

  it("ignores requests belonging to another account/backend and drops a switch after the transport changes", async () => {
    setup();
    await screen.findByTestId("editor");
    await act(async () => requestAtlasPage({ ownerKey: '["other","account-1"]', id: "two", action: { type: "import" } }));
    expect(mocks.flush).not.toHaveBeenCalled();
    let finish!: (saved: boolean) => void;
    mocks.flush.mockReturnValue(new Promise<boolean>((resolve) => { finish = resolve; }));
    act(() => requestAtlasPage({ ownerKey: '["local","account-1"]', id: "two", action: { type: "import" } }));
    mocks.transport = "backend-b";
    await act(async () => finish(true));
    expect(screen.getByTestId("editor").textContent).toBe("one");
    expect(mocks.performAction).not.toHaveBeenCalled();
  });
});
