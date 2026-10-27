// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import atlasReducer, { setAtlasCoverPosition } from "@/lib/redux/slices/atlasSlice";
import { AtlasPageHeader } from "./atlas-page-header";

const mocks = vi.hoisted(() => ({ update: vi.fn(), upload: vi.fn(), preset: vi.fn(), error: vi.fn(), items: [] as AtlasItem[] }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasQuery: () => ({ data: mocks.items }),
  useUpdateAtlasItemMutation: () => [(input: unknown) => ({ unwrap: () => mocks.update(input) }), {}],
  useUploadAtlasFileMutation: () => [(input: unknown) => ({ unwrap: () => mocks.upload(input) }), {}],
  useSetAtlasCoverPresetMutation: () => [(input: unknown) => ({ unwrap: () => mocks.preset(input) }), {}],
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
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({});
  mocks.items = [item({ id: "cover", kind: "image", title: "Saved photo", path: "/atlas/photo.png" }),
    item({ id: "other", kind: "image", title: "Other photo", path: "/atlas/other.png" })];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
    const slider = screen.getByRole("slider", { name: "Cover vertical position" });
    expect(slider.getAttribute("aria-orientation")).toBe("vertical");
    expect(document.activeElement).toBe(slider);
    for (const name of ["Change cover", "Reposition", "Remove"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    fireEvent.change(slider, { target: { value: "80" } });
    expect(cover.style.objectPosition).toBe("50% 80%");
    fireEvent.keyDown(slider, { key: "Escape" });
    expect(cover.style.objectPosition).toBe("50% 25%");
    fireEvent.click(screen.getByRole("button", { name: "Reposition" }));
    fireEvent.change(screen.getByRole("slider", { name: "Cover vertical position" }), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(store.getState().atlas.coverPositions[ownerKey].page).toEqual({ coverFileId: "cover", coverPositionY: 70 });
    expect(cover.style.objectPosition).toBe("50% 70%");
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByRole("button", { name: "Reposition" })).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("centers a changed cover instead of applying the previous image's framing", () => {
    const { store, rerender } = setup(item({ metadata: { coverFileId: "cover" } }));
    act(() => { store.dispatch(setAtlasCoverPosition({ ownerKey, id: "page", coverFileId: "cover", coverPositionY: 90 })); });
    rerender(item({ metadata: { coverFileId: "other" } }));
    expect(screen.getByRole("img", { name: "Page cover" }).style.objectPosition).toBe("50% 50%");
  });
  it("offers the bundled gallery first and saves a chosen cover once, without uploading", async () => {
    mocks.items = [...mocks.items, item({ id: "preset-ocean", kind: "image", title: "ocean.png", path: "/atlas/ocean.png", sourceKey: "cover-preset:ocean" })];
    mocks.preset.mockResolvedValue({ metadata: { coverFileId: "preset-ocean" } });
    const { store } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    // Saved images come first, then the bundled gallery, in one picker without tabs.
    const images = screen.getByRole("heading", { name: "Your images" });
    const gallery = screen.getByRole("heading", { name: "Color & Gradient" });
    expect(images.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Ocean as cover" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose page cover" })).toBeNull());
    expect(mocks.preset).toHaveBeenCalledWith({ accountId: "default", id: "page", preset: "ocean" });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(store.getState().atlas.coverPositions[ownerKey].page).toEqual({ coverFileId: "preset-ocean", coverPositionY: 50 });
    // Bundled covers saved in Atlas are not listed among the user's own images.
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    expect(screen.getByRole("button", { name: "Use Saved photo as cover" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use ocean.png as cover" })).toBeNull();
  });
  it("closes the cover picker from its close button without changing the Page", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    expect(screen.getByRole("dialog", { name: "Choose page cover" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Choose page cover" })).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.preset).not.toHaveBeenCalled();
  });
  it("shows twelve saved images first and reveals the rest with Show more", () => {
    mocks.items = Array.from({ length: 14 }, (_, index) => item({ id: `image-${index}`, kind: "image", title: `Photo ${index}`, path: `/atlas/${index}.png` }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    expect(screen.getAllByRole("button", { name: /^Use Photo \d+ as cover$/ })).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: /^Use Photo \d+ as cover$/ })).toHaveLength(14);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
  it("omits the saved images section when there are none", () => {
    mocks.items = [];
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    expect(screen.queryByRole("heading", { name: "Your images" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Color & Gradient" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Dawn as cover" })).toBeTruthy();
    // Photos get their own section below the gradients.
    const photos = screen.getByRole("heading", { name: "British Library" });
    expect(screen.getByRole("heading", { name: "Color & Gradient" }).compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Rio aqueduct as cover" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Birmingham Museums Trust" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Open sea as cover" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The Metropolitan Museum of Art" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Great wave as cover" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "NASA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use Saturn as cover" })).toBeTruthy();
  });
  it("reports a failed gallery selection and keeps the picker open", async () => {
    mocks.preset.mockRejectedValueOnce(new Error("Cover image for \"dawn\" is not installed"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Dawn as cover" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Cover image for \"dawn\" is not installed"));
    expect(screen.getByRole("dialog", { name: "Choose page cover" })).toBeTruthy();
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
