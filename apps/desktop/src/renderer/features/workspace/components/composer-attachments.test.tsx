// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileText: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { fileExplorer: { readFileText: mocks.readFileText } } }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
vi.mock("@/features/workspace/hooks/use-composer-context", () => ({
  useComposerContext: () => ({ appshots: [], browserSelections: [], reviewComments: [], documentAnnotations: [], remove: vi.fn() }),
}));
vi.mock("@/hooks/use-open-link", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("@/hooks/use-browser-panel", () => ({ useBrowserPanel: () => ({ openHtmlFile: vi.fn() }) }));
vi.mock("@/features/workspace/hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("./review-comments-attachment", () => ({ ComposerReviewComments: () => null }));
vi.mock("./composer-browser-annotations", () => ({ ComposerBrowserAnnotations: () => null }));
vi.mock("./document-viewer/document-render-host", () => ({ DocumentRenderHost: () => null }));
vi.mock("./document-viewer/pdf-document", () => ({ PdfDocument: () => null }));

import appSettings from "@/lib/redux/slices/appSettingsSlice";
import workspace from "@/lib/redux/slices/workspaceSlice";
import preview, { closePreviewTab, openPreviewTab } from "@/lib/redux/slices/previewSlice";
import { DocumentViewerProvider } from "@/hooks/use-document-viewer";
import { ComposerAttachments } from "./composer-attachments";
import { DocumentViewerPanel } from "./document-viewer-panel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("Özgeçmiş içeriği")));
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:draft-document"),
    revokeObjectURL: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("composer document previews", () => {
  it("loads only the current backend's document tabs through its file API", async () => {
    mocks.readFileText.mockImplementation(async ({ filePath }: { filePath: string }) => ({ success: true, data: {
      isBinary: false, content: filePath === "/local/readme.md" ? "Local content" : "Foreign content",
    } }));
    const state = configureStore({ reducer: { appSettings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
    for (const backend of ["remote", "local"]) state.dispatch(openPreviewTab({ ownerKey: JSON.stringify([backend, "atlas-preview"]), tab: {
      kind: "document", id: backend, doc: { path: `/${backend}/readme.md`, fileName: "readme.md", docType: "md" },
    } }));
    render(<Provider store={state}><MemoryRouter initialEntries={["/atlas"]}><DocumentViewerProvider>
      <DocumentViewerPanel />
    </DocumentViewerProvider></MemoryRouter></Provider>);
    await screen.findByText("Local content");
    expect(mocks.readFileText).toHaveBeenCalledExactlyOnceWith({ filePath: "/local/readme.md" });
  });
  it("retains an open draft document after its attachment is removed and releases it on tab close", async () => {
    const file = new File(["Document"], "draft.txt", { type: "text/plain" });
    const state = configureStore({ reducer: { appSettings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
    const fixture = (present: boolean) => <Provider store={state}><MemoryRouter initialEntries={["/atlas"]}><DocumentViewerProvider>
      <ComposerAttachments files={present ? [{ file, type: "document" }] : []} onRemove={vi.fn()} />
      <DocumentViewerPanel />
    </DocumentViewerProvider></MemoryRouter></Provider>;
    const view = render(fixture(true));
    fireEvent.click(screen.getByRole("button", { name: "Open draft.txt" }));
    await screen.findByText("Özgeçmiş içeriği");
    view.rerender(fixture(false));
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const [ownerKey, group] = Object.entries(state.getState().preview.byOwner)[0];
    act(() => state.dispatch(closePreviewTab({ ownerKey, id: group.tabs[0].id })));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:draft-document"));
  });
  it.each(["txt", "md"])("opens an unsent %s attachment in the preview panel", async (extension) => {
    const file = new File(["Özgeçmiş içeriği"], `Özgeçmiş.${extension}`, { type: "text/plain" });
    const state = configureStore({ reducer: { appSettings, workspace, preview, backends: () => ({ activeBackendId: null }) } });
    render(<Provider store={state}><MemoryRouter initialEntries={["/atlas"]}><DocumentViewerProvider>
      <ComposerAttachments files={[{ file, type: "document" }]} onRemove={vi.fn()} />
      <DocumentViewerPanel />
    </DocumentViewerProvider></MemoryRouter></Provider>);

    const open = screen.getByRole("button", { name: `Open ${file.name}` });
    fireEvent.click(open);
    expect(await screen.findByText("Özgeçmiş içeriği")).toBeTruthy();
    const panel = screen.getByRole("toolbar", { name: "Document tools" }).closest("[data-document-viewer-panel]");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(mocks.readFileText).not.toHaveBeenCalled();

    fireEvent.click(open);
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(file);
    const group = Object.values(state.getState().preview.byOwner)[0];
    expect(group.open).toBe(true);
    expect(group.tabs).toHaveLength(1);
    expect(group.tabs[0]).toMatchObject({ kind: "document", doc: { path: "blob:draft-document", fileName: file.name, docType: extension } });
  });
});
