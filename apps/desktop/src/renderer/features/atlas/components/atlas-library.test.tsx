// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasGeneratedFile, AtlasListItem } from "@mains/contracts/atlas";
import atlasReducer, { updateAtlasPageChat } from "@/lib/redux/slices/atlasSlice";
import { useAppSelector } from "@/lib/redux/hooks";
import { AtlasLibrary } from "./atlas-library";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), error: vi.fn(), transport: "backend-a", providerId: "codex",
  spaces: [
    { id: "codex-work", accountId: "account", name: "Codex Work", mode: "work", providerId: "codex" },
    { id: "claude-work", accountId: "account", name: "Claude Work", mode: "work", providerId: "claude_code" },
  ],
  empty: [],
  items: [] as AtlasListItem[],
  generated: [] as AtlasGeneratedFile[],
  list: vi.fn(),
}));

vi.mock("@/lib/redux/api", () => ({ useListCollectionsQuery: () => ({ data: mocks.empty }) }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasQuery: (options: unknown) => {
    mocks.list(options);
    return { data: mocks.items, isLoading: false };
  },
  useAtlasGeneratedQuery: (_options: unknown, { skip }: { skip: boolean }) => ({
    currentData: skip ? undefined : { items: mocks.generated }, isLoading: false,
  }),
  useCreateAtlasPageMutation: () => [mocks.create, { isLoading: false }],
  useUpdateAtlasItemMutation: () => [vi.fn(), {}],
  useRemoveAtlasItemMutation: () => [vi.fn(), {}],
}));
vi.mock("@/hooks/use-active-space", () => ({ useActiveSpace: () => ({
  spaces: mocks.spaces,
  activeSpace: { id: "active-chat", accountId: "account", mode: "chat", providerId: mocks.providerId },
}) }));
vi.mock("@/hooks/use-space-provider-variant", async () => {
  const { getProviderVariantById } = await import("@/lib/provider-variants");
  return { useSpaceProviderVariant: () => getProviderVariantById(mocks.providerId) };
});
vi.mock("@/lib/transport", () => ({ appApi: {}, getTransport: () => mocks.transport }));
vi.mock("@/hooks/use-document-viewer", () => ({ useDocumentViewer: () => ({ open: vi.fn() }) }));
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: (path?: string) => path ? "mains-localimg://preview" : undefined }));
vi.mock("@/features/workspace/hooks/use-jump-to-run", () => ({ useJumpToRun: () => vi.fn() }));
vi.mock("../hooks/use-save-to-atlas", () => ({
  useSaveToAtlas: () => ({ save: vi.fn(), saving: false }),
  atlasError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error },
}));

function PageDraft() {
  const chat = useAppSelector((state) => state.atlas.byOwner['["backend-a","account"]']?.chats["new-page"]);
  return <output data-testid="page-draft">{chat?.draft}</output>;
}
function Location() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname}{location.search}</output>;
}
function setup(initialEntry = "/atlas?project=project") {
  const store = configureStore({ reducer: {
    atlas: atlasReducer,
    backends: () => ({ activeBackendId: "backend-a" }),
  } });
  store.dispatch(updateAtlasPageChat({ ownerKey: '["backend-a","account"]', id: "existing-page", patch: { draft: "Keep my draft" } }));
  render(<Provider store={store}><MemoryRouter initialEntries={[initialEntry]}>
    <Location /><Routes>
      <Route path="/atlas" element={<AtlasLibrary accountId="account" />} />
      <Route path="/atlas/images/new" element={<div>Image creator</div>} />
      <Route path="/atlas/:itemId" element={<PageDraft />} />
    </Routes>
  </MemoryRouter></Provider>);
  return store;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  mocks.providerId = "codex";
  mocks.items = [];
  mocks.generated = [];
  mocks.transport = "backend-a";
  mocks.create.mockImplementation(() => ({ unwrap: async () => ({ item: { id: "new-page" } }) }));
});

describe("Atlas image creation navigation", () => {
  it("opens the image creator from Images and carries its project without creating a Page", () => {
    setup("/atlas?type=image&project=project");
    fireEvent.click(screen.getByRole("button", { name: "New image" }));
    expect(screen.getByTestId("url").textContent).toBe("/atlas/images/new?project=project");
    expect(screen.getByText("Image creator")).toBeTruthy();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("Atlas image sources", () => {
  it.each(["/atlas?layout=grid", "/atlas?type=image"])("opens images in the shared zoomable preview from %s", (route) => {
    mocks.generated = [{ sourceKey: "generated", runId: "run", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
      mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" }];
    setup(route);
    fireEvent.click(screen.getByRole("button", { name: "Open generated.png" }));
    const preview = within(screen.getByRole("dialog", { name: "generated.png" }));
    expect(preview.getByRole("img", { name: "generated.png" }).getAttribute("src")).toBe("mains-localimg://preview");
    expect(preview.getByRole("button", { name: "Download image" })).toBeTruthy();
    fireEvent.click(preview.getByRole("button", { name: "Zoom in" }));
    expect(preview.getByRole("button", { name: "Reset zoom" }).textContent).toBe("125%");
    fireEvent.click(preview.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("url").textContent).toBe(route);
  });

  it("separates uploaded images from Your creations while showing both in All", () => {
    const image: AtlasGeneratedFile = { sourceKey: "generated", runId: "run", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
      mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" };
    mocks.generated = [image, { ...image, sourceKey: "upload", origin: "attachment", path: "/screen.png", fileName: "screen.png" }];
    setup("/atlas?type=image");
    expect(screen.getByRole("button", { name: "Open generated.png" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open screen.png" })).toBeTruthy();
    expect(screen.getByText("Uploaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Your creations" }));
    expect(screen.getByRole("button", { name: "Open generated.png" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open screen.png" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Uploads" }));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=image&view=uploads");
    expect(screen.getByRole("button", { name: "Open screen.png" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open generated.png" })).toBeNull();
  });

  it.each(["all", "file"])("loads only attachments for a direct Uploads URL in %s, preserving project and saved-copy actions", (type) => {
    const upload: AtlasGeneratedFile = { sourceKey: "upload", origin: "attachment", runId: "run", runTitle: "Research",
      collectionId: "project", kind: "file", path: "/report.pdf", fileName: "report.pdf",
      mimeType: "application/pdf", byteSize: 1, modifiedAt: "2026-10-07" };
    mocks.generated = [upload,
      { ...upload, sourceKey: "generated", origin: "generated", fileName: "summary.pdf" },
      { ...upload, sourceKey: "other-project", collectionId: "other", fileName: "other-project.pdf" },
      { ...upload, sourceKey: "image", kind: "image", path: "/screen.png", fileName: "screen.png", mimeType: "image/png" },
    ];
    const savedCopy: AtlasListItem = { id: "saved-upload", title: "report.pdf", accountId: "account", kind: "file",
      metadata: null, collectionId: "project", sourceRunId: "run", sourceKey: "upload", path: "/atlas/report.pdf",
      fileName: "report.pdf", mimeType: "application/pdf", byteSize: 1, isFavorite: false, trashedAt: null,
      version: 1, createdAt: "2026-10-07", updatedAt: "2026-10-07" };
    mocks.items = [savedCopy, { ...savedCopy, id: "saved-other", sourceKey: null, title: "saved-only.pdf" }];
    setup(`/atlas?type=${type}&view=uploads&project=project`);
    expect(screen.getByRole("radio", { name: "Uploads" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("button", { name: "report.pdf" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "summary.pdf" })).toBeNull();
    expect(screen.queryByRole("button", { name: "saved-only.pdf" })).toBeNull();
    expect(screen.queryByRole("button", { name: "other-project.pdf" })).toBeNull();
    expect(Boolean(screen.queryByRole("button", { name: "screen.png" }))).toBe(type === "all");
    fireEvent.click(screen.getByRole("button", { name: "Actions for report.pdf" }));
    expect(screen.getByRole("menuitem", { name: "Add to favorites" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Save to Atlas" })).toBeNull();
  });

  it("explains an empty Uploads view without offering Page creation", () => {
    setup("/atlas?view=uploads");
    expect(screen.getByText("No uploads yet")).toBeTruthy();
    expect(screen.getByText("Files attached to your conversations will appear here.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create a page" })).toBeNull();
  });
});

describe("Atlas Page grid previews", () => {
  const page = (id: string, title: string, preview: string): AtlasListItem => ({
    id, title, preview, accountId: "account", kind: "page", metadata: null,
    collectionId: null, sourceRunId: null, sourceKey: null, path: null, fileName: null,
    mimeType: null, byteSize: null, isFavorite: false, trashedAt: null, version: 1,
    createdAt: "2026-10-06", updatedAt: "2026-10-06",
  });

  it("shows bounded static content, leaves blank Pages empty and still opens the selected Page", () => {
    mocks.items = [page("notes", "Notes", "## Today\n- [ ] Run propulsion test\n- [x] Verify course"), page("empty", "Blank", "")];
    setup("/atlas?type=page&layout=grid");
    expect(mocks.list).toHaveBeenLastCalledWith({ accountId: "account", includePagePreview: true });
    const preview = screen.getByRole("button", { name: "Open Notes" });
    expect(preview.textContent).toContain("Today");
    expect(preview.textContent).toContain("Run propulsion test");
    expect(preview.textContent).toContain("✓");
    expect(screen.getByRole("button", { name: "Open Blank" }).textContent).toBe("");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(preview);
    expect(screen.getByTestId("url").textContent).toBe("/atlas/notes");
  });

  it("keeps preview HTML inert and the options button separate from opening a Page", () => {
    mocks.items = [page("notes", "Notes", '<img src="external" onerror="alert(1)">')];
    setup("/atlas?type=page&layout=grid");
    const preview = screen.getByRole("button", { name: "Open Notes" });
    expect(preview.querySelector("img")).toBeNull();
    expect(preview.textContent).toContain("<img");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Notes" }));
    expect(screen.getByRole("menu").style.transformOrigin).toBe("top right");
    expect(screen.getByRole("menuitem", { name: "Open" })).toBeTruthy();
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=page&layout=grid");
  });

  it("requests excerpts only for a grid that can display Pages", () => {
    setup("/atlas?type=page&layout=grid");
    expect(screen.queryByRole("radio", { name: "Uploads" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(mocks.list).toHaveBeenLastCalledWith({ accountId: "account" });
  });

  it("keeps Trash out of the library even for an old Trash URL", () => {
    mocks.items = [{ ...page("deleted", "Deleted notes", "Hidden"), trashedAt: "2026-10-06" }];
    setup("/atlas?type=page&view=trash");
    expect(screen.getByRole("heading", { name: "Pages" })).toBeTruthy();
    expect(screen.queryByText("Deleted notes")).toBeNull();
    expect(screen.queryByText("Trash is empty")).toBeNull();
  });

  it("loads at most one embedded Atlas image lazily and keeps other images as captions", () => {
    mocks.items = [
      page("notes", "Notes", "![Remote](https://example.com/image.png)\n![Diagram](atlas-file://image)\n![Other](atlas-file://image)"),
      { ...page("image", "Diagram", ""), kind: "image", path: "/atlas/files/image/diagram.png" },
    ];
    setup("/atlas?type=page&layout=grid");
    const preview = screen.getByRole("button", { name: "Open Notes" });
    const images = preview.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("src")).toBe("mains-localimg://preview");
    expect(images[0].getAttribute("loading")).toBe("lazy");
    expect(preview.textContent).toContain("Other");
    expect(preview.textContent).toContain("Remote");
    fireEvent.error(images[0]);
    expect(preview.querySelector("img")).toBeNull();
    expect(preview.textContent).toContain("Diagram");
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas page starters", () => {
  it.each([
    ["codex", "Codex"],
    ["claude_code", "Claude"],
  ])("opens a blank Page with an editable prompt for %s", async (providerId, label) => {
    mocks.providerId = providerId;
    const store = setup();
    const section = screen.getByRole("region", { name: "Start a page" });
    const first = within(section).getAllByRole("button")[0];
    expect(first.textContent).toMatch(new RegExp(`Create page with\\s+${label}`));
    fireEvent.click(first);
    await screen.findByTestId("page-draft");
    expect(screen.getByTestId("url").textContent).toBe("/atlas/new-page");
    expect(screen.getByTestId("page-draft").textContent).toBe("Create a page about ");
    expect(mocks.create).toHaveBeenCalledWith({ accountId: "account", title: "Untitled page", markdown: undefined, collectionId: "project" });
    expect(store.getState().atlas.byOwner['["backend-a","account"]'].chats["new-page"])
      .toMatchObject({ draft: "Create a page about ", mode: "details", spaceId: "active-chat", runId: null });
    expect(store.getState().atlas.byOwner['["backend-a","account"]'].chats["existing-page"].draft).toBe("Keep my draft");
  });

  it.each(["starter", "menu"])("creates a populated Page directly from the first template in the %s", async (entryPoint) => {
    const store = setup();
    if (entryPoint === "menu") {
      fireEvent.click(screen.getByRole("button", { name: "New Atlas item" }));
    }
    fireEvent.click(screen.getByRole(entryPoint === "menu" ? "menuitem" : "button", { name: "Project brief" }));
    await screen.findByTestId("page-draft");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Project brief", markdown: expect.stringContaining("Success criteria"), collectionId: "project" }));
    expect(store.getState().atlas.byOwner['["backend-a","account"]'].chats["new-page"]).toBeUndefined();
  });

  it("does not open a Page or seed its draft after a failed creation", async () => {
    mocks.create.mockImplementation(() => ({ unwrap: async () => { throw new Error("Could not create page"); } }));
    const store = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create page with Codex" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not create page"));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?project=project");
    expect(store.getState().atlas.byOwner['["backend-a","account"]'].chats["new-page"]).toBeUndefined();
  });

  it("ignores double clicks and a late response from a previous backend", async () => {
    let resolve!: (page: { item: { id: string } }) => void;
    const pending = new Promise<{ item: { id: string } }>((finish) => { resolve = finish; });
    mocks.create.mockImplementation(() => ({ unwrap: () => pending }));
    const store = setup();
    const card = screen.getByRole("button", { name: "Create page with Codex" });
    fireEvent.click(card);
    fireEvent.click(card);
    expect(mocks.create).toHaveBeenCalledOnce();
    mocks.transport = "backend-b";
    await act(async () => resolve({ item: { id: "new-page" } }));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?project=project");
    expect(store.getState().atlas.byOwner['["backend-a","account"]'].chats["new-page"]).toBeUndefined();
  });
});
