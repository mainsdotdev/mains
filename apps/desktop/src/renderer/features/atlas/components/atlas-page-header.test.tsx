// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import atlasReducer, { setAtlasCoverPosition } from "@/lib/redux/slices/atlasSlice";
import { AtlasPageHeader } from "./atlas-page-header";

const mocks = vi.hoisted(() => ({ update: vi.fn(), upload: vi.fn(), error: vi.fn(), items: [] as AtlasItem[] }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasQuery: () => ({ data: mocks.items }),
  useUpdateAtlasItemMutation: () => [(input: unknown) => ({ unwrap: () => mocks.update(input) }), {}],
  useUploadAtlasFileMutation: () => [(input: unknown) => ({ unwrap: () => mocks.upload(input) }), {}],
}));
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: (path: string) => path }));
vi.mock("@/components/ui", async (original) => ({
  ...await original<typeof import("@/components/ui")>(), toast: { error: mocks.error },
}));
vi.mock("@/components/layout/sidebar/icon-picker-panel", () => ({
  IconPickerPanel: ({ onSelectEmoji, onClear }: { onSelectEmoji: (emoji: string) => void; onClear: () => void }) =>
    <><button onClick={() => onSelectEmoji("📚")}>Choose books icon</button><button onClick={onClear}>Remove icon</button></>,
}));

const ownerKey = '["local","default"]';
function item(patch: Partial<AtlasItem> = {}): AtlasItem {
  return { id: "page", accountId: "default", kind: "page", title: "Notes", metadata: null,
    collectionId: null, sourceRunId: null, sourceKey: null, path: null, fileName: null, mimeType: null,
    byteSize: null, isFavorite: false, trashedAt: null, version: 1, createdAt: "2026-10-06", updatedAt: "2026-10-06", ...patch };
}
function setup(page = item()) {
  const store = configureStore({ reducer: { atlas: atlasReducer, backends: () => ({ activeBackendId: null }) } });
  const view = render(<Provider store={store}><AtlasPageHeader item={page} /></Provider>);
  return { store, rerender: (next: AtlasItem) => view.rerender(<Provider store={store}><AtlasPageHeader item={next} /></Provider>) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.items = [item({ id: "cover", kind: "image", title: "Saved photo", path: "/atlas/photo.png" }),
    item({ id: "other", kind: "image", title: "Other photo", path: "/atlas/other.png" })];
});
afterEach(cleanup);

describe("Atlas Page presentation", () => {
  it("reuses a stored cover without uploading/copying it, and edits the icon independently", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Saved photo as cover" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose page cover" })).toBeNull());
    expect(mocks.update).toHaveBeenLastCalledWith({ accountId: "default", id: "page", metadata: { coverFileId: "cover" } });
    expect(mocks.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add page icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose books icon" }));
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith({ accountId: "default", id: "page", metadata: { icon: "emoji:📚" } }));
  });
  it("saves framing only in device state and cancels previews without writing to the backend", async () => {
    const { store } = setup(item({ metadata: { coverFileId: "cover" } }));
    act(() => { store.dispatch(setAtlasCoverPosition({ ownerKey, id: "page", coverFileId: "cover", coverPositionY: 25 })); });
    const cover = screen.getByRole("img", { name: "Page cover" });
    expect(cover.style.objectPosition).toBe("50% 25%");
    fireEvent.click(screen.getByRole("button", { name: "Reposition" }));
    fireEvent.change(screen.getByRole("slider", { name: "Cover vertical position" }), { target: { value: "80" } });
    expect(cover.style.objectPosition).toBe("50% 80%");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cover.style.objectPosition).toBe("50% 25%");
    fireEvent.click(screen.getByRole("button", { name: "Reposition" }));
    fireEvent.change(screen.getByRole("slider", { name: "Cover vertical position" }), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save position" }));
    expect(store.getState().atlas.coverPositions[ownerKey].page).toEqual({ coverFileId: "cover", coverPositionY: 70 });
    expect(cover.style.objectPosition).toBe("50% 70%");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("centers a changed cover instead of applying the previous image's framing", () => {
    const { store, rerender } = setup(item({ metadata: { coverFileId: "cover" } }));
    act(() => { store.dispatch(setAtlasCoverPosition({ ownerKey, id: "page", coverFileId: "cover", coverPositionY: 90 })); });
    rerender(item({ metadata: { coverFileId: "other" } }));
    expect(screen.getByRole("img", { name: "Page cover" }).style.objectPosition).toBe("50% 50%");
  });
  it("reports a failed cover selection without changing persisted framing", async () => {
    mocks.update.mockRejectedValueOnce(new Error("Could not save cover"));
    const { store } = setup(item({ metadata: { coverFileId: "cover" } }));
    act(() => { store.dispatch(setAtlasCoverPosition({ ownerKey, id: "page", coverFileId: "cover", coverPositionY: 30 })); });
    fireEvent.click(screen.getByRole("button", { name: "Change cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Other photo as cover" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Could not save cover"));
    expect(store.getState().atlas.coverPositions[ownerKey].page).toEqual({ coverFileId: "cover", coverPositionY: 30 });
    expect(screen.getByRole("dialog", { name: "Choose page cover" })).toBeTruthy();
  });
});
