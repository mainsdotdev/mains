// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import atlasReducer, { openAtlasPageTab } from "@/lib/redux/slices/atlasSlice";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { subscribeAtlasPageRequests, type AtlasPageRequest } from "../lib/page-actions";
import { AtlasSidebar } from "./atlas-sidebar";

const mocks = vi.hoisted(() => ({ items: [] as AtlasItem[], collections: [{ id: "project", name: "Launch" }],
  update: vi.fn(), remove: vi.fn(), openDocument: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/redux/api", () => ({
  useGetAccountQuery: () => ({ data: { id: "account" } }),
  useListCollectionsQuery: () => ({ data: mocks.collections }),
}));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasQuery: () => ({ data: mocks.items }),
  useCreateAtlasPageMutation: () => [vi.fn(), {}],
  useUpdateAtlasItemMutation: () => [mocks.update, {}],
  useRemoveAtlasItemMutation: () => [mocks.remove, {}],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => "backend" }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: mocks.openDocument }) }));
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: (path: string) => path ? "mains-localimg://preview" : undefined }));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error },
}));

function Location() { return <output data-testid="route">{useLocation().pathname}</output>; }
function setup(appSettings = appSettingsReducer(undefined, { type: "init" }), initialEntry = "/atlas/current") {
  const store = configureStore({
    reducer: { atlas: atlasReducer, appSettings: appSettingsReducer, backends: () => ({ activeBackendId: "backend" }) },
    preloadedState: { appSettings },
  });
  const view = render(<Provider store={store}><MemoryRouter initialEntries={[initialEntry]}><AtlasSidebar /><Location /></MemoryRouter></Provider>);
  return { store, ...view };
}
function openOptions() {
  const trigger = screen.getByRole("button", { name: "Page options for Notes" });
  fireEvent.click(trigger);
  return trigger;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.items = [{ id: "notes", accountId: "account", kind: "page", title: "Notes", metadata: null,
    collectionId: null, sourceRunId: null, sourceKey: null, path: null, fileName: null, mimeType: null,
    byteSize: null, isFavorite: false, trashedAt: null, version: 1, createdAt: "2026-10-06", updatedAt: "2026-10-06" }];
  mocks.update.mockImplementation(({ id }: { id: string }) => ({ unwrap: async () => {
    mocks.items = mocks.items.map((item) => item.id === id ? { ...item, trashedAt: null } : item);
  } }));
  mocks.remove.mockImplementation(({ id }: { id: string }) => ({ unwrap: async () => {
    mocks.items = mocks.items.filter((item) => item.id !== id);
  } }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

describe("Atlas image creator navigation", () => {
  it.each(["/atlas/images/new", "/atlas/images/runs/image-run"])("keeps Images selected at %s", (path) => {
    setup(undefined, path);
    expect(screen.getByRole("button", { name: "Images" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Pages" }).hasAttribute("aria-current")).toBe(false);
  });
});

describe("Atlas Trash dropdown", () => {
  function addTrash(patch: Partial<AtlasItem> = {}) {
    const item = { ...mocks.items[0], id: "deleted", title: "Deleted notes", collectionId: "project", trashedAt: "2026-10-06", ...patch };
    mocks.items.push(item);
    return item;
  }
  function openTrash() {
    const trigger = screen.getByRole("button", { name: "Trash" });
    fireEvent.click(trigger);
    return trigger;
  }

  it("opens a searchable menu without navigating and only shows this account's Trash", () => {
    addTrash();
    addTrash({ id: "image", title: "Beach", kind: "image", path: "/atlas/beach.png" });
    addTrash({ id: "foreign", title: "Other account", accountId: "other" });
    setup();
    const trigger = openTrash();
    const menu = screen.getByRole("menu", { name: "Trash" });
    const search = within(menu).getByRole("textbox", { name: "Search Trash" });
    expect(document.activeElement).toBe(search);
    expect(screen.getByTestId("route").textContent).toBe("/atlas/current");
    expect(within(menu).queryByRole("menuitem", { name: "Open Notes" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Open Other account" })).toBeNull();
    expect(within(within(menu).getByRole("menuitem", { name: "Open Deleted notes" })).getByText("Launch")).toBeTruthy();
    expect(within(menu).queryByRole("combobox")).toBeNull();
    fireEvent.change(search, { target: { value: "BEACH" } });
    expect(within(menu).getByRole("menuitem", { name: "Open Beach" })).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Open Deleted notes" })).toBeNull();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Open Beach" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("restores an item in place without opening it", async () => {
    addTrash();
    setup();
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore Deleted notes" }));
    await waitFor(() => expect(screen.getByText("Trash is empty")).toBeTruthy());
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "deleted", trashed: false });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByTestId("route").textContent).toBe("/atlas/current");
  });

  it("opens a trashed Page through the route's save-aware Page request", () => {
    addTrash();
    setup();
    const listener = vi.fn();
    const unsubscribe = subscribeAtlasPageRequests(listener);
    try {
      openTrash();
      fireEvent.click(screen.getByRole("menuitem", { name: "Open Deleted notes" }));
      expect(listener).toHaveBeenCalledExactlyOnceWith({ ownerKey: '["backend","account"]', id: "deleted" });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(mocks.update).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it("opens documents in the viewer and images in the shared preview", () => {
    addTrash({ id: "document", title: "Report", kind: "file", path: "/atlas/report.pdf", fileName: "report.pdf" });
    addTrash({ id: "image", title: "Beach", kind: "image", path: "/atlas/beach.png" });
    setup();
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open Report" }));
    expect(mocks.openDocument).toHaveBeenCalledExactlyOnceWith({ path: "/atlas/report.pdf", fileName: "report.pdf", docType: "pdf" });
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open Beach" }));
    expect(screen.getByRole("dialog", { name: "Beach" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Beach" }).getAttribute("src")).toBe("mains-localimg://preview");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("confirms permanent deletion and closes a deleted Page's tab", async () => {
    addTrash();
    const { store } = setup(undefined, "/atlas/deleted");
    store.dispatch(openAtlasPageTab({ ownerKey: '["backend","account"]', id: "deleted" }));
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Deleted notes permanently" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Deleted notes permanently" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "deleted" });
    expect(store.getState().atlas.byOwner['["backend","account"]'].tabs).toEqual([]);
    // Navigation commits as a transition, after the dialog has closed.
    await waitFor(() => expect(screen.getByTestId("route").textContent).toBe("/atlas"));
  });

  it("keeps the item and confirmation open if deletion fails", async () => {
    addTrash();
    mocks.remove.mockImplementation(() => ({ unwrap: async () => { throw new Error("This image is used by a page"); } }));
    setup();
    openTrash();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Deleted notes permanently" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Delete Atlas item" })).toBeTruthy();
    expect(mocks.items.some((item) => item.id === "deleted")).toBe(true);
    expect(screen.getByTestId("route").textContent).toBe("/atlas/current");
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas Recents accordion", () => {
  it("starts open and restores its saved preference in a new sidebar", () => {
    const { store, unmount } = setup();
    const heading = screen.getByRole("button", { name: "Recents" });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(heading);
    expect(heading.getAttribute("aria-expanded")).toBe("false");

    const savedSettings = JSON.parse(JSON.stringify(store.getState().appSettings));
    unmount();
    setup(savedSettings);
    const restoredHeading = screen.getByRole("button", { name: "Recents" });
    expect(restoredHeading.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(restoredHeading, { key: "Enter" });
    expect(restoredHeading.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(restoredHeading, { key: " " });
    expect(restoredHeading.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the Atlas preference separate from Chat Recents", () => {
    const settings = appSettingsReducer(undefined, { type: "init" });
    const { store } = setup({ ...settings, workspaceGroupExpanded: { recents: false } });
    const heading = screen.getByRole("button", { name: "Recents" });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(heading);
    fireEvent.click(heading);
    expect(store.getState().appSettings.workspaceGroupExpanded.recents).toBe(false);
    expect(heading.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Atlas recent Page options", () => {
  it("opens the shared menu without opening the Page and restores focus on Escape", async () => {
    setup();
    const listener = vi.fn();
    const unsubscribe = subscribeAtlasPageRequests(listener);
    try {
      const trigger = openOptions();
      for (const label of ["Copy page contents", "Import", "Export", "Page history", "Move to", "Move to Trash"]) {
        expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
      }
      expect(listener).not.toHaveBeenCalled();
      expect(screen.getByTestId("route").textContent).toBe("/atlas/current");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    } finally { unsubscribe(); }
  });

  it.each([
    ["Copy page contents", { type: "copy" }],
    ["Import", { type: "import" }],
    ["Page history", { type: "history" }],
    ["Move to Trash", { type: "trash" }],
  ] as const)("targets the chosen Page for %s", (label, action) => {
    setup();
    const listener = vi.fn<(request: AtlasPageRequest) => void>();
    const unsubscribe = subscribeAtlasPageRequests(listener);
    try {
      openOptions();
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(listener).toHaveBeenCalledExactlyOnceWith({ ownerKey: '["backend","account"]', id: "notes", action });
      expect(screen.queryByRole("menu")).toBeNull();
    } finally { unsubscribe(); }
  });

  it("exports JSON and moves to the selected project through the submenus", () => {
    setup();
    const listener = vi.fn();
    const unsubscribe = subscribeAtlasPageRequests(listener);
    try {
      openOptions();
      fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "JSON" }));
      expect(listener).toHaveBeenLastCalledWith({ ownerKey: '["backend","account"]', id: "notes", action: { type: "export", format: "json" } });
      openOptions();
      fireEvent.click(screen.getByRole("menuitem", { name: "Move to" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Launch" }));
      expect(listener).toHaveBeenLastCalledWith({ ownerKey: '["backend","account"]', id: "notes", action: { type: "move", collectionId: "project" } });
    } finally { unsubscribe(); }
  });

  it("asks the route to open a recent Page so the current editor can save first", () => {
    setup();
    const listener = vi.fn();
    const unsubscribe = subscribeAtlasPageRequests(listener);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Notes" }));
      expect(listener).toHaveBeenCalledExactlyOnceWith({ ownerKey: '["backend","account"]', id: "notes" });
    } finally { unsubscribe(); }
  });
});
