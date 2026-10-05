// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextBrowserItem } from "../lib/composer-context";

const mocks = vi.hoisted(() => ({ annotations: [] as ContextBrowserItem[], remove: vi.fn(), update: vi.fn() }));
vi.mock("../hooks/use-composer-context", () => ({
  useComposerContext: () => ({ browserSelections: mocks.annotations, remove: mocks.remove, update: mocks.update }),
}));
vi.mock("@/hooks/use-suppress-browser-view", () => ({ useSuppressBrowserView: vi.fn() }));
vi.mock("./image-preview-modal", () => ({ ImagePreviewModal: ({ name }: { name: string }) => <div role="dialog" aria-label={name} /> }));
import { ComposerBrowserAnnotations } from "./composer-browser-annotations";
import { useSuppressBrowserView } from "@/hooks/use-suppress-browser-view";

function annotation(id: string, comment: string, count: number): ContextBrowserItem {
  const element = {
    selector: "h1", tagName: "h1", text: "Introduction", styles: {},
    rect: { x: 0, y: 0, width: 100, height: 30 }, pageRect: { x: 0, y: 0, width: 100, height: 30 },
    scroll: { x: 0, y: 0 }, viewport: { width: 1000, height: 800 }, devicePixelRatio: 1,
  };
  return {
    ...element, kind: "browser", id, url: "https://docs.mains.dev", title: "Docs", timestamp: "2026-10-02T11:00:00Z",
    comment, elements: Array.from({ length: count }, (_, index) => ({ ...element, selector: `#item-${index}` })),
    screenshotCaptureName: `annotation-${id}.png`, screenshotPath: `/caps/annotation-${id}.png`, screenshotMimeType: "image/png",
  };
}
beforeEach(() => {
  mocks.annotations = [annotation("first", "Bunlar nedir", 4), annotation("second", "Bu nedir", 1)];
  mocks.remove.mockReset();
  mocks.update.mockReset();
  vi.mocked(useSuppressBrowserView).mockClear();
});
afterEach(cleanup);

describe("composer browser annotations", () => {
  it("shows one summary for multiple groups and opens every comment with its element list", async () => {
    render(<ComposerBrowserAnnotations />);
    fireEvent.click(screen.getByRole("button", { name: "2 annotations · 5 selected items" }));
    await screen.findByRole("dialog", { name: "Browser annotations" });
    expect(screen.getByText("Bunlar nedir")).toBeTruthy();
    expect(screen.getByText("Bu nedir")).toBeTruthy();
    expect(screen.getAllByText("Introduction")).toHaveLength(5);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(useSuppressBrowserView).not.toHaveBeenCalled();
  });

  it("saves a comment without replacing its screenshot or selected elements", async () => {
    render(<ComposerBrowserAnnotations />);
    fireEvent.click(screen.getByRole("button", { name: "2 annotations · 5 selected items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit annotation 1" }));
    const input = screen.getByRole("textbox", { name: "Comment for annotation 1" });
    fireEvent.change(input, { target: { value: "  Make these clearer  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mocks.update).toHaveBeenCalledWith({ ...mocks.annotations[0], comment: "Make these clearer" });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("cancels an edit with Escape and deletes only the requested group", async () => {
    render(<ComposerBrowserAnnotations />);
    fireEvent.click(screen.getByRole("button", { name: "2 annotations · 5 selected items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit annotation 1" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete annotation 2" }));
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(mocks.annotations[1]);
  });

  it("clears all groups through the normal capture cleanup path", () => {
    render(<ComposerBrowserAnnotations />);
    fireEvent.click(screen.getByRole("button", { name: "Remove all annotations" }));
    expect(mocks.remove.mock.calls.map(([item]) => item)).toEqual(mocks.annotations);
  });

  it("opens the group's screenshot and closes details on an outside click", async () => {
    render(<ComposerBrowserAnnotations />);
    fireEvent.click(screen.getByRole("button", { name: "2 annotations · 5 selected items" }));
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Browser annotations" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "2 annotations · 5 selected items" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview annotation 1" }));
    expect(screen.getByRole("dialog", { name: "Docs" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Browser annotations" })).toBeNull();
  });
});
