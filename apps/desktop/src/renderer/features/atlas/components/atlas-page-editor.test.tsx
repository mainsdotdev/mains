// @vitest-environment jsdom
import { createRef, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasPage } from "@mains/contracts/atlas";
import type { AtlasPendingPageAction } from "../lib/page-actions";
import { AUTOSAVE_INTERVAL_MS } from "../lib/page-save-queue";
import AtlasPageEditor, { type AtlasPageEditorHandle } from "./atlas-page-editor";

const mocks = vi.hoisted(() => ({
  page: null as AtlasPage | null, save: vi.fn(), update: vi.fn(), download: vi.fn(), copy: vi.fn(),
  error: vi.fn(), transport: "backend", acknowledged: vi.fn(),
  beforeSend: null as (() => Promise<boolean>) | null,
  onEditorChange: null as (() => void) | null,
  editor: {
    document: [{ id: "original", type: "paragraph", content: "Existing content" }] as unknown[],
    blocksToMarkdownLossy: vi.fn(), replaceBlocks: vi.fn(), insertBlocks: vi.fn(), tryParseMarkdownToBlocks: vi.fn(),
  },
}));
vi.mock("@blocknote/react", () => ({ useCreateBlockNote: () => mocks.editor }));
vi.mock("@blocknote/shadcn", () => ({ BlockNoteView: ({ onChange }: { onChange: () => void }) => {
  mocks.onEditorChange = onChange;
  return <div>Editor body</div>;
} }));
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
vi.mock("./atlas-page-chat", () => ({ AtlasPageChat: ({ beforeSend }: { beforeSend: () => Promise<boolean> }) => {
  mocks.beforeSend = beforeSend;
  return null;
} }));
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
  return { ref, rerender: () => view.rerender(ui()), unmount: view.unmount };
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("Atlas Page menu actions", () => {
  it("waits for the latest editor draft to save before allowing a page-chat message", async () => {
    setup();
    let finish!: (page: AtlasPage) => void;
    mocks.save.mockImplementationOnce(() => new Promise<AtlasPage>((resolve) => { finish = resolve; }));
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Current title" } });
    let operation!: Promise<boolean>;
    let ready = false;
    act(() => { operation = mocks.beforeSend!().then((result) => { ready = true; return result; }); });
    expect(ready).toBe(false);
    await act(async () => {
      finish({ ...mocks.page!, item: { ...mocks.page!.item, title: "Current title", version: 2 } });
      expect(await operation).toBe(true);
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: "Current title", expectedVersion: 1 }));
  });

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
    let navigationReady = false;
    const flushing = ref.current!.flush().then((saved) => { navigationReady = saved; return saved; });
    await act(async () => { await Promise.resolve(); });
    expect(navigationReady).toBe(false);
    await act(async () => {
      finish({ ...mocks.page!, item: { ...mocks.page!.item, title: "New title", version: 2 } });
      await operation;
      expect(await flushing).toBe(true);
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: "New title", expectedVersion: 1 }));
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ accountId: "account", id: "page", trashed: true });
    // Atlas owns navigation after the mutation closes the Page's tab.
    expect(screen.getByTestId("route").textContent).toBe("/atlas/page");
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

  it("does not autosave late editor events when a trashed Page closes", async () => {
    const { ref, unmount } = setup();
    let finishTrash!: () => void;
    const trash = new Promise<void>((resolve) => { finishTrash = resolve; });
    let trashed = false;
    const invalidSave = vi.fn();
    mocks.save.mockImplementation(async (input) => {
      if (trashed) {
        const error = new Error("Page is in Trash or unavailable");
        invalidSave(error);
        throw error;
      }
      return { ...mocks.page!, item: { ...mocks.page!.item, title: input.title, version: 2 } };
    });
    mocks.update.mockImplementationOnce(async () => {
      await trash;
      trashed = true;
      // A successful Trash mutation closes the tab before the Page read refreshes.
      unmount();
      return { ...mocks.page!.item, trashedAt: "2026-10-11" };
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Saved before Trash" } });
    let operation!: Promise<void>;
    await act(async () => { operation = ref.current!.performAction({ type: "trash" }); });
    expect(mocks.update).toHaveBeenCalledOnce();
    // BlockNote can still notify the old editor while the Trash request is pending.
    act(() => mocks.onEditorChange!());
    await act(async () => {
      finishTrash();
      await operation;
    });
    expect(invalidSave).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
  });

  it("keeps a recovered draft local when opening a Page in Trash", async () => {
    mocks.page!.item.trashedAt = "2026-10-11";
    localStorage.setItem("mains:atlas:draft:account:page", JSON.stringify({
      version: 1, draft: { title: "Recovered draft", blocks: mocks.editor.document },
    }));
    const { unmount } = setup();
    await act(async () => {});
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveProperty("disabled", true);
    unmount();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("mains:atlas:draft:account:page")).toContain("Recovered draft");
  });

  it("stops a pending autosave when a Page refresh reports Trash", async () => {
    vi.useFakeTimers();
    const { rerender, unmount } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Local draft" } });
    const lateChange = mocks.onEditorChange!;
    mocks.page = { ...mocks.page!, item: { ...mocks.page!.item, trashedAt: "2026-10-11" } };
    rerender();
    act(() => lateChange());
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS); });
    unmount();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.getItem("mains:atlas:draft:account:page")).toContain("Local draft");
  });

  it("resumes editing and autosave when moving to Trash fails", async () => {
    vi.useFakeTimers();
    const { ref } = setup();
    let failTrash!: (error: Error) => void;
    mocks.update.mockImplementationOnce(() => new Promise((_resolve, reject) => { failTrash = reject; }));
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "First draft" } });
    let operation!: Promise<void>;
    await act(async () => { operation = ref.current!.performAction({ type: "trash" }); });
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveProperty("disabled", true);
    expect(await mocks.beforeSend!()).toBe(false);
    act(() => mocks.onEditorChange!());
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS); });
    expect(mocks.save).toHaveBeenCalledOnce();
    await act(async () => {
      failTrash(new Error("Could not move to Trash"));
      await expect(operation).rejects.toThrow("Could not move to Trash");
    });
    expect(screen.getByRole("textbox", { name: "Page title" })).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Still editing" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Still editing", expectedVersion: 2 }));
  });

  it("saves a continuous edit once per autosave interval instead of after every pause", async () => {
    vi.useFakeTimers();
    setup();
    const title = screen.getByRole("textbox", { name: "Page title" });
    fireEvent.change(title, { target: { value: "First" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1_000); });
    fireEvent.change(title, { target: { value: "Second" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Second" }));
  });

  it("saves a dirty draft as soon as the window starts closing", async () => {
    vi.useFakeTimers();
    setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Page title" }), { target: { value: "Closing" } });
    expect(mocks.save).not.toHaveBeenCalled();
    const event = new Event("beforeunload", { cancelable: true });
    await act(async () => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Closing" }));
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
