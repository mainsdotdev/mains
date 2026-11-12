// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem, AtlasLibraryEntry } from "@mains/contracts/atlas";
import { AtlasBookmarkCard } from "./atlas-bookmark-card";
import { AtlasItemRow } from "./atlas-item-row";

vi.mock("../hooks/use-atlas-file-path", () => ({ useAtlasFilePath: () => undefined }));
vi.mock("@/hooks/use-local-image-url", () => ({ useLocalImageUrl: () => undefined }));
afterEach(cleanup);

const bookmark: AtlasItem = {
  id: "bookmark", accountId: "account", kind: "bookmark", title: "Example",
  url: "https://example.com", metadata: null, collectionId: null, sourceRunId: null, sourceKey: null,
  path: null, fileName: null, mimeType: null, byteSize: null, isFavorite: false, trashedAt: null,
  version: 1, createdAt: "2026-11-12", updatedAt: "2026-11-12", bookmarkState: { status: "pending" },
};

function Bookmark({ item, layout }: { item: AtlasItem; layout: "grid" | "list" }) {
  const actions = { menu: null, onOpen: vi.fn(), onTag: vi.fn() };
  const entry = { kind: "bookmark", title: item.title, saved: item, date: item.createdAt } as AtlasLibraryEntry;
  return layout === "grid" ? <AtlasBookmarkCard item={item} {...actions} /> : <AtlasItemRow entry={entry} {...actions} />;
}

describe.each(["grid", "list"] as const)("Bookmark previews in %s", (layout) => {
  it("shows loading through metadata fetching and image loading, even after the job finishes", () => {
    const view = render(<Bookmark item={bookmark} layout={layout} />);
    expect(screen.getByText("Fetching details…")).toBeTruthy();
    expect(screen.getByText("Loading preview…")).toBeTruthy();
    expect(view.container.querySelector("img")).toBeNull();

    const withImage: AtlasItem = { ...bookmark, bookmarkState: { status: "running" },
      metadata: { bookmark: { imageUrl: "https://example.com/preview.png" } } };
    view.rerender(<Bookmark item={withImage} layout={layout} />);
    const image = view.container.querySelector("img")!;
    expect(image.classList.contains("opacity-0")).toBe(true);
    view.rerender(<Bookmark item={{ ...withImage, bookmarkState: { status: "ready" } }} layout={layout} />);
    expect(screen.queryByText("Fetching details…")).toBeNull();
    expect(screen.getByText("Loading preview…")).toBeTruthy();

    fireEvent.load(image);
    expect(screen.queryByText("Loading preview…")).toBeNull();
    expect(image.classList.contains("opacity-100")).toBe(true);
  });

  it("stops loading when enrichment finishes without a preview or fails", () => {
    const view = render(<Bookmark item={bookmark} layout={layout} />);
    view.rerender(<Bookmark item={{ ...bookmark, bookmarkState: { status: "ready" } }} layout={layout} />);
    expect(screen.queryByText("Loading preview…")).toBeNull();
    expect(view.container.querySelector('[aria-busy="false"] svg')).toBeTruthy();

    view.rerender(<Bookmark item={{ ...bookmark, bookmarkState: { status: "failed", error: "Page unavailable" } }} layout={layout} />);
    expect(screen.queryByText("Loading preview…")).toBeNull();
    expect(screen.getByTitle("Page unavailable").textContent).toBe("Details incomplete");
  });

  it("falls back on image errors and tracks a replacement image separately", () => {
    const withImage: AtlasItem = { ...bookmark, bookmarkState: { status: "running" },
      metadata: { bookmark: { imageUrl: "https://example.com/preview.png" } } };
    const view = render(<Bookmark item={withImage} layout={layout} />);
    fireEvent.error(view.container.querySelector("img")!);
    expect(screen.queryByText("Loading preview…")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();

    view.rerender(<Bookmark item={{ ...withImage,
      metadata: { bookmark: { imageUrl: "https://example.com/replacement.png" } } }} layout={layout} />);
    expect(screen.getByText("Loading preview…")).toBeTruthy();
    fireEvent.load(view.container.querySelector("img")!);
    expect(screen.queryByText("Loading preview…")).toBeNull();

    view.rerender(<Bookmark item={{ ...withImage,
      metadata: { bookmark: { imageUrl: "https://example.com/newer.png" } } }} layout={layout} />);
    expect(screen.getByText("Loading preview…")).toBeTruthy();
  });
});
