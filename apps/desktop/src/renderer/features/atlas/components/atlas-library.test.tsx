// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasGeneratedFile, AtlasLibraryEntry, AtlasLibraryOptions, AtlasLibraryPage, AtlasListItem } from "@mains/contracts/atlas";
import type { FileHandlerApp } from "@/lib/redux/api/shellApi";
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
  queryResult: undefined as ((options: AtlasLibraryOptions) => AtlasLibraryPage) | undefined,
  previewImages: {} as Record<string, string>,
  fetching: false,
  pendingPage: undefined as number | undefined,
  fetchApps: vi.fn(), openWith: vi.fn(), openWithApp: true, appsLoading: false,
  appsByPath: {} as Record<string, FileHandlerApp[]>,
}));

vi.mock("@/lib/redux/api", () => ({
  useListCollectionsQuery: () => ({ data: mocks.empty }),
  useLazyGetAppsForFileQuery: () => {
    const [path, setPath] = useState<string>();
    return [(nextPath: string, cached?: boolean) => { mocks.fetchApps(nextPath, cached); setPath(nextPath); }, {
      currentData: path ? mocks.appsByPath[path] : undefined,
      originalArgs: path, isFetching: mocks.appsLoading,
    }];
  },
}));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ openWithApp: mocks.openWithApp }) }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useAtlasLibraryQuery: (options: AtlasLibraryOptions) => {
    mocks.list(options);
    return { currentData: options.page === mocks.pendingPage ? undefined : mocks.queryResult?.(options) ?? libraryPage([
      ...mocks.items.map(savedEntry), ...mocks.generated.map((file) => generatedEntry(file)),
    ]), isFetching: mocks.fetching || options.page === mocks.pendingPage, refetch: vi.fn() };
  },
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

function savedEntry(item: AtlasListItem): AtlasLibraryEntry {
  return { key: item.id, title: item.title, kind: item.kind, date: item.updatedAt,
    collectionId: item.collectionId, path: item.path, saved: item };
}
function generatedEntry(file: AtlasGeneratedFile, saved?: AtlasListItem): AtlasLibraryEntry {
  return { key: file.sourceKey, title: file.fileName, kind: file.kind, date: file.modifiedAt,
    collectionId: file.collectionId, path: file.path, generated: file, saved };
}
function libraryPage(items: AtlasLibraryEntry[], page = 1, hasNext = false): AtlasLibraryPage {
  return { items, page, hasNext, previewImages: mocks.previewImages };
}

function PageDraft() {
  const chat = useAppSelector((state) => state.atlas.byOwner['["backend-a","account"]']?.chats["new-page"]);
  return <output data-testid="page-draft">{chat?.draft}</output>;
}
function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="url">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>Browser back</button>
    <button onClick={() => navigate(1)}>Browser forward</button></>;
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
  mocks.queryResult = undefined;
  mocks.previewImages = {};
  mocks.fetching = false;
  mocks.pendingPage = undefined;
  mocks.transport = "backend-a";
  mocks.openWithApp = true;
  mocks.appsLoading = false;
  mocks.appsByPath = {};
  mocks.openWith.mockResolvedValue({ success: true });
  vi.stubGlobal("api", { shell: { openFileWithBundle: mocks.openWith } });
  mocks.create.mockImplementation(() => ({ unwrap: async () => ({ item: { id: "new-page" } }) }));
});

describe("Atlas library pagination", () => {
  function pages() {
    const entries = Array.from({ length: 51 }, (_, index) => savedEntry({
      id: `file-${index}`, accountId: "account", title: `Report ${index}`, kind: "file", metadata: null,
      collectionId: null, sourceRunId: null, sourceKey: null, path: null, fileName: null,
      mimeType: null, byteSize: null, isFavorite: false, trashedAt: null, version: 0,
      createdAt: "2026-10-07", updatedAt: "2026-10-07",
    }));
    mocks.queryResult = ({ page = 1, scope, query }) => scope === "favorites" || query
      ? libraryPage([entries[0]]) : page === 2 ? libraryPage([entries[50]], 2) : libraryPage(entries.slice(0, 50), 1, true);
  }

  it("shows 50 rows, navigates with Previous/Next, and restores pages through browser history", () => {
    pages();
    setup("/atlas?type=file&view=saved");
    expect(screen.getAllByRole("row")).toHaveLength(51);
    expect(screen.queryByRole("button", { name: "Report 50" })).toBeNull();
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=file&view=saved&page=2");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Report 50" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report 0" })).toBeNull();
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));
    expect(screen.getByText(/Page 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=file&view=saved");
  });

  it("resets pagination for a new search or source filter", async () => {
    pages();
    setup("/atlas?type=file&view=saved&page=2");
    fireEvent.change(screen.getByRole("textbox", { name: "Search Atlas" }), { target: { value: "Report" } });
    await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, query: "Report" })));
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=file&view=saved&q=Report");
    fireEvent.click(screen.getByRole("radio", { name: "Favorites" }));
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, scope: "favorites" }));
  });

  it("clears the previous page while the next page is loading", () => {
    pages();
    mocks.pendingPage = 2;
    setup("/atlas?type=file&view=saved");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Loading your items…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Report 0" })).toBeNull();
  });
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

describe("Atlas Open with actions", () => {
  const generated: AtlasGeneratedFile = { sourceKey: "image", runId: "run", runTitle: "Images",
    collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
    mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" };
  const saved: AtlasListItem = { id: "document", accountId: "account", kind: "file", title: "Report",
    metadata: null, collectionId: null, sourceRunId: null, sourceKey: null, path: "/atlas/report.pdf",
    fileName: "report.pdf", mimeType: "application/pdf", byteSize: 1, isFavorite: false, trashedAt: null,
    version: 1, createdAt: "2026-10-07", updatedAt: "2026-10-07" };
  const app: FileHandlerApp = { bundleId: "com.example.viewer", name: "Viewer", path: "/Applications/Viewer.app",
    icon: "data:image/png;base64,eA==" };

  it.each([
    ["generated image", "/atlas"], ["generated image", "/atlas?layout=grid"],
    ["saved document", "/atlas"], ["saved document", "/atlas?layout=grid"],
  ])("opens a %s with its registered native app from %s", (kind, route) => {
    const isImage = kind === "generated image";
    if (isImage) mocks.generated = [generated];
    else mocks.items = [saved];
    const path = isImage ? generated.path : saved.path!;
    const title = isImage ? generated.fileName : saved.title;
    mocks.appsByPath[path] = [app];
    setup(route);
    expect(mocks.fetchApps).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
    expect(mocks.fetchApps).toHaveBeenCalledWith(path, true);
    const action = screen.getByRole("menuitem", { name: "Open with Viewer" });
    expect(action.querySelector("img")?.getAttribute("src")).toBe(app.icon);
    fireEvent.click(action);
    expect(mocks.openWith).toHaveBeenCalledWith(path, app.bundleId);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("url").textContent).toBe(route);
  });

  it("loads the application list for the newly opened file rather than keeping the previous file's apps", () => {
    mocks.generated = [generated];
    mocks.items = [saved];
    mocks.appsByPath[generated.path] = [app];
    mocks.appsByPath[saved.path!] = [{ ...app, name: "PDF reader", bundleId: "com.example.pdf", icon: null }];
    setup("/atlas");
    fireEvent.click(screen.getByRole("button", { name: "Actions for generated.png" }));
    expect(screen.getByRole("menuitem", { name: "Open with Viewer" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Report" }));
    expect(screen.queryByRole("menuitem", { name: "Open with Viewer" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open with PDF reader" }));
    expect(mocks.openWith).toHaveBeenCalledWith(saved.path, "com.example.pdf");
  });

  it("shows a loading state while applications are being detected", () => {
    mocks.generated = [generated];
    mocks.appsLoading = true;
    setup("/atlas");
    fireEvent.click(screen.getByRole("button", { name: "Actions for generated.png" }));
    expect(screen.getByText("Loading applications…")).toBeTruthy();
  });

  it("keeps native app discovery out of unsupported platforms", () => {
    mocks.generated = [generated];
    mocks.openWithApp = false;
    mocks.appsByPath[generated.path] = [app];
    setup("/atlas");
    fireEvent.click(screen.getByRole("button", { name: "Actions for generated.png" }));
    expect(mocks.fetchApps).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem", { name: /Open with/ })).toBeNull();
  });

  it("reports a native open failure after closing the menu", async () => {
    mocks.generated = [generated];
    mocks.appsByPath[generated.path] = [app];
    mocks.openWith.mockResolvedValue({ success: false, error: "App is no longer available" });
    setup("/atlas");
    fireEvent.click(screen.getByRole("button", { name: "Actions for generated.png" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open with Viewer" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("App is no longer available"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Atlas image sources", () => {
  it("renders the backend's deduplicated Uploads results and requests the selected project", () => {
    const upload: AtlasGeneratedFile = { sourceKey: "newest", origin: "attachment", contentHash: "same-bytes", runId: "new-chat", runTitle: "Images",
      collectionId: "project", kind: "image", path: "/new.png", fileName: "new.png", mimeType: "image/png", byteSize: 10, modifiedAt: "2026-10-10" };
    mocks.generated = [upload, { ...upload, sourceKey: "changed", contentHash: "different-bytes", path: "/changed.png", fileName: "changed.png" }];
    setup("/atlas?type=image&view=uploads&project=project");
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "uploads", type: "image", collectionId: "project", page: 1 }));
    expect(screen.getAllByRole("button", { name: "Open new.png" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Open old.png" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open other.png" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open changed.png" })).toBeTruthy();
  });
  it("prefers a saved copy in All while each source view retains its matching image", () => {
    const image: AtlasGeneratedFile = { sourceKey: "generated", contentHash: "same-bytes", runId: "chat", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png", mimeType: "image/png", byteSize: 10, modifiedAt: "2026-10-10" };
    mocks.generated = [image, { ...image, sourceKey: "upload", origin: "attachment", path: "/upload.png", fileName: "upload.png" }];
    mocks.items = [{ id: "saved", accountId: "account", kind: "image", title: "Saved photo", contentHash: "same-bytes", metadata: null,
      collectionId: null, sourceKey: null, sourceRunId: null, path: "/saved.png", fileName: "saved.png", mimeType: "image/png", byteSize: 10,
      version: 1, isFavorite: true, trashedAt: null, createdAt: "2026-10-07", updatedAt: "2026-10-07" }];
    mocks.queryResult = ({ scope }) => libraryPage(scope === "all" ? mocks.items.map(savedEntry)
      : [generatedEntry(scope === "uploads" ? mocks.generated[1] : image)]);
    setup("/atlas?type=image");
    expect(screen.getByRole("button", { name: "Open Saved photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open generated.png" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open upload.png" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Your creations" }));
    expect(screen.getByRole("button", { name: "Open generated.png" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Uploads" }));
    expect(screen.getByRole("button", { name: "Open upload.png" })).toBeTruthy();
  });
  it.each(["/atlas", "/atlas?layout=grid", "/atlas?type=image"])("opens images in the shared zoomable preview from %s", (route) => {
    mocks.generated = [{ sourceKey: "generated", runId: "run", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
      mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" }];
    setup(route);
    fireEvent.click(screen.getByRole("button", { name: route === "/atlas" ? "generated.png" : "Open generated.png" }));
    const preview = within(screen.getByRole("dialog", { name: "generated.png" }));
    expect(preview.getByRole("img", { name: "generated.png" }).getAttribute("src")).toBe("mains-localimg://preview");
    expect(preview.getByRole("button", { name: "Download image" })).toBeTruthy();
    fireEvent.click(preview.getByRole("button", { name: "Zoom in" }));
    expect(preview.getByRole("button", { name: "Reset zoom" }).textContent).toBe("125%");
    fireEvent.click(preview.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("url").textContent).toBe(route);
  });

  it("shows local thumbnails for saved, generated and uploaded images in All and keeps failed images openable", () => {
    mocks.items = [{ id: "saved", title: "saved.png", accountId: "account", kind: "image",
      metadata: null, collectionId: null, sourceRunId: null, sourceKey: null, path: "/atlas/saved.png",
      fileName: "saved.png", mimeType: "image/png", byteSize: 1, isFavorite: false, trashedAt: null,
      version: 1, createdAt: "2026-10-07", updatedAt: "2026-10-07" }];
    const generated: AtlasGeneratedFile = { sourceKey: "generated", runId: "run", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
      mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" };
    mocks.generated = [generated, { ...generated, sourceKey: "upload", origin: "attachment",
      path: "/upload.png", fileName: "upload.png" }];
    setup("/atlas");
    for (const name of ["saved.png", "generated.png", "upload.png"]) {
      const row = screen.getByRole("button", { name });
      const thumbnail = row.querySelector("img");
      expect(thumbnail?.getAttribute("src")).toBe("mains-localimg://preview");
      expect(thumbnail?.getAttribute("loading")).toBe("lazy");
      expect(thumbnail?.getAttribute("decoding")).toBe("async");
      expect(thumbnail?.getAttribute("alt")).toBe("");
    }
    const savedRow = screen.getByRole("button", { name: "saved.png" });
    fireEvent.error(savedRow.querySelector("img")!);
    expect(savedRow.querySelector("img")).toBeNull();
    expect(savedRow.querySelector("svg")).toBeTruthy();
    fireEvent.click(savedRow);
    expect(screen.getByRole("dialog", { name: "saved.png" })).toBeTruthy();
    expect(screen.getByTestId("url").textContent).toBe("/atlas");
  });

  it("separates uploaded images from Your creations while showing both in All", () => {
    const image: AtlasGeneratedFile = { sourceKey: "generated", runId: "run", runTitle: "Images",
      collectionId: null, kind: "image", path: "/generated.png", fileName: "generated.png",
      mimeType: "image/png", byteSize: 1, modifiedAt: "2026-10-07" };
    mocks.generated = [image, { ...image, sourceKey: "upload", origin: "attachment", path: "/screen.png", fileName: "screen.png" }];
    mocks.queryResult = ({ scope }) => libraryPage((scope === "generated" ? [image]
      : scope === "uploads" ? [mocks.generated[1]] : mocks.generated).map((file) => generatedEntry(file)));
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
    mocks.queryResult = () => libraryPage((type === "all" ? [upload, mocks.generated[3]] : [upload])
      .map((file) => generatedEntry(file, file === upload ? savedCopy : undefined)));
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
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "account", type: "page", page: 1, includePagePreview: true }));
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
    expect(mocks.fetchApps).not.toHaveBeenCalled();
    expect(screen.getByTestId("url").textContent).toBe("/atlas?type=page&layout=grid");
  });

  it("requests excerpts only for a grid that can display Pages", () => {
    setup("/atlas?type=page&layout=grid");
    expect(screen.queryByRole("radio", { name: "Uploads" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(mocks.list.mock.lastCall?.[0]).not.toHaveProperty("includePagePreview");
  });

  it("requests the active library even for an old Trash URL", () => {
    setup("/atlas?type=page&view=trash");
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: "page", scope: "all" }));
    expect(screen.getByRole("heading", { name: "Pages" })).toBeTruthy();
    expect(screen.queryByText("Deleted notes")).toBeNull();
    expect(screen.queryByText("Trash is empty")).toBeNull();
  });

  it("loads at most one embedded Atlas image lazily and keeps other images as captions", () => {
    mocks.items = [page("notes", "Notes", "![Remote](https://example.com/image.png)\n![Diagram](atlas-file://image)\n![Other](atlas-file://image)")];
    mocks.previewImages = { "atlas-file://image": "/atlas/files/image/diagram.png" };
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
