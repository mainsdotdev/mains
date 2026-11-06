// @vitest-environment jsdom
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileText: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { fileExplorer: { readFileText: mocks.readFileText } } }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ mode: "developer" }) }));
vi.mock("@/features/workspace/hooks/use-composer-context", () => ({
  useComposerContext: () => ({ appshots: [], browserSelections: [], reviewComments: [], remove: vi.fn() }),
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
import preview from "@/lib/redux/slices/previewSlice";
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
