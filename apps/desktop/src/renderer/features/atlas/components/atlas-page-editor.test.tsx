// @vitest-environment jsdom
import { createRef, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasPage } from "@mains/contracts/atlas";
import type { AtlasPendingPageAction } from "../lib/page-actions";
import AtlasPageEditor, { type AtlasPageEditorHandle } from "./atlas-page-editor";

const mocks = vi.hoisted(() => ({
  page: null as AtlasPage | null, save: vi.fn(), update: vi.fn(), download: vi.fn(), copy: vi.fn(),
  error: vi.fn(), transport: "backend", acknowledged: vi.fn(),
  editor: {
    document: [{ id: "original", type: "paragraph", content: "Existing content" }] as unknown[],
    blocksToMarkdownLossy: vi.fn(), replaceBlocks: vi.fn(), insertBlocks: vi.fn(), tryParseMarkdownToBlocks: vi.fn(),
  },
}));
vi.mock("@blocknote/react", () => ({ useCreateBlockNote: () => mocks.editor }));
vi.mock("@blocknote/shadcn", () => ({ BlockNoteView: () => <div>Editor body</div> }));
vi.mock("@/lib/redux/api", () => ({ useListCollectionsQuery: () => ({ data: [{ id: "project", name: "Launch" }] }) }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useAtlasPageQuery: () => ({ data: mocks.page, refetch: async () => ({ data: mocks.page }) }),
  useAtlasRevisionsQuery: () => ({ data: [] }),
  useSaveAtlasPageMutation: () => [(input: unknown) => ({ unwrap: () => mocks.save(input) })],
  useUpdateAtlasItemMutation: () => [(input: unknown) => ({ unwrap: () => mocks.update(input) })],
  useUploadAtlasFileMutation: () => [vi.fn()],
  useCreateAtlasPageMutation: () => [vi.fn()],
  useRestoreAtlasPageMutation: () => [vi.fn(), {}],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => mocks.transport, appApi: {} }));
vi.mock("@/hooks/use-copy-to-clipboard", () => ({ useCopyToClipboard: () => ({ copy: mocks.copy }) }));
vi.mock("../lib/download", () => ({ downloadAtlasText: mocks.download }));
vi.mock("./atlas-page-header", () => ({ AtlasPageHeader: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./atlas-page-chat", () => ({ AtlasPageChat: () => null }));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error },
}));

function Location() { const location = useLocation(); return <output data-testid="route">{location.pathname}{location.search}</output>; }
function setup(requestedAction?: AtlasPendingPageAction) {
  const ref = createRef<AtlasPageEditorHandle>();
  const props = { accountId: "account", id: "page", handleRef: ref, onTitleChange: vi.fn(), onActionHandled: mocks.acknowledged };
  const ui = (request = requestedAction) => <MemoryRouter initialEntries={["/atlas/page"]}>
    <AtlasPageEditor {...props} requestedAction={request} /><Location />
  </MemoryRouter>;
  const view = render(ui());
  return { ref, rerender: () => view.rerender(ui()) };
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.transport = "backend";
  mocks.editor.document = [{ id: "original", type: "paragraph", content: "Existing content" }];
  mocks.editor.blocksToMarkdownLossy.mockReturnValue("Existing content");
  mocks.page = {
    item: { id: "page", accountId: "account", kind: "page", title: "Notes", metadata: null,
      collectionId: null, sourceRunId: null, sourceKey: null, path: null, fileName: null, mimeType: null,
      byteSize: null, isFavorite: false, trashedAt: null, version: 1, createdAt: "2026-10-06", updatedAt: "2026-10-06" },
    revision: { id: "revision", itemId: "page", version: 1, schemaVersion: 1, title: "Notes", blocks: mocks.editor.document,
      markdown: "Existing content", actor: "user", sourceRunId: null, createdAt: "2026-10-06" },
  };
  mocks.save.mockImplementation(async (input) => ({ ...mocks.page, item: { ...mocks.page!.item, title: input.title, version: 2 } }));
  mocks.update.mockResolvedValue({});
  mocks.copy.mockResolvedValue(true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas Page menu actions", () => {
  it("copies and exports the editor's current draft, including an unsaved title", async () => {
    const { ref } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Draft title" } });
    await act(async () => {
      await ref.current!.performAction({ type: "copy" });
      await ref.current!.performAction({ type: "export", format: "markdown" });
      await ref.current!.performAction({ type: "export", format: "json" });
    });
    expect(mocks.copy).toHaveBeenCalledWith("# Draft title\n\nExisting content");
    expect(mocks.download).toHaveBeenCalledWith("Draft title.md", "Existing content");
    expect(mocks.download).toHaveBeenCalledWith("Draft title.json", JSON.stringify(mocks.editor.document, null, 2), "application/json");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("opens the attachment picker and imports blocks without duplicating their existing IDs", async () => {
    const { ref } = setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.spyOn(input, "click");
    await act(async () => ref.current!.performAction({ type: "import" }));
    expect(picker).toHaveBeenCalledOnce();
    const file = new File(["unused"], "notes.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: async () => JSON.stringify([{ id: "original", type: "paragraph", content: "Imported", children: [{ id: "nested", type: "paragraph", content: "Child" }] }]) });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(mocks.editor.insertBlocks).toHaveBeenCalledWith([
      { type: "paragraph", content: "Imported", children: [{ type: "paragraph", content: "Child" }] },
    ], mocks.editor.document[0], "after"));
  });

  it("opens history from a pending sidebar request and acknowledges it only once", async () => {
    const request: AtlasPendingPageAction = { ownerKey: '["backend","account"]', id: "page", token: "history-request", action: { type: "history" } };
    const { rerender } = setup(request);
    expect(await screen.findByRole("dialog", { name: "Page history" })).toBeTruthy();
    expect(mocks.acknowledged).toHaveBeenCalledExactlyOnceWith("history-request");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    rerender();
    expect(screen.queryByRole("dialog", { name: "Page history" })).toBeNull();
    expect(mocks.acknowledged).toHaveBeenCalledOnce();
  });

  it("saves the latest draft before moving the Page to Trash", async () => {
    const { ref } = setup();
    let finish!: (page: AtlasPage) => void;
    mocks.save.mockImplementationOnce(() => new Promise<AtlasPage>((resolve) => { finish = resolve; }));
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "New title" } });
    let operation!: Promise<void>;
    act(() => { operation = ref.current!.performAction({ type: "trash" }); });
    expect(mocks.update).not.toHaveBeenCalled();
    await act(async () => {
      finish({ ...mocks.page!, item: { ...mocks.page!.item, title: "New title", version: 2 } });
      await operation;
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: "New title", expectedVersion: 1 }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "page", trashed: true });
    expect(screen.getByTestId("route").textContent).toBe("/atlas?type=page");
  });

  it("keeps the draft when saving fails and skips the Trash mutation", async () => {
    const { ref } = setup();
    mocks.save.mockRejectedValueOnce(new Error("Save failed"));
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Unsaved title" } });
    await act(async () => ref.current!.performAction({ type: "trash" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.getByTestId("route").textContent).toBe("/atlas/page");
    expect(localStorage.getItem("mains:atlas:draft:account:page")).toContain("Unsaved title");
  });

  it("moves the intended Page and rejects actions after its backend changes", async () => {
    const { ref } = setup();
    await act(async () => ref.current!.performAction({ type: "move", collectionId: "project" }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "page", collectionId: "project" });
    mocks.transport = "other-backend";
    await expect(ref.current!.performAction({ type: "move", collectionId: null })).rejects.toThrow("Backend changed");
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
