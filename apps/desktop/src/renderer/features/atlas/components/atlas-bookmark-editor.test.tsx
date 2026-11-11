// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import { AtlasBookmarkEditor } from "./atlas-bookmark-editor";

const mocks = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn() }));
const bookmark = { id: "bookmark", url: "https://example.com", title: "Saved", description: "Original", tags: [] } as unknown as AtlasItem;
vi.mock("@/lib/redux/api", () => ({ useListCollectionsQuery: () => ({ data: [{ id: "project", name: "Research" }] }) }));
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasTagsQuery: () => ({ data: [{ id: "react", name: "React", count: 1 }, { id: "ts", name: "TypeScript", count: 1 }] }),
  useSaveAtlasBookmarkMutation: () => [mocks.save, { isLoading: false }],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => "local" }));
vi.mock("@/components/ui", async (original) => ({ ...await original<typeof import("@/components/ui")>(), toast: { success: mocks.success } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.save.mockReturnValue({ unwrap: async () => ({ id: "bookmark" }) });
  document.documentElement.style.fontSize = "16px";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas bookmark editor", () => {
  it("selects a project through the shared Select without submitting the bookmark", async () => {
    render(<AtlasBookmarkEditor accountId="account" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(screen.getByRole("option", { name: "Research" }));
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ collectionId: "project" })));
  });
  it("adds a tag with Enter while editing without submitting, then saves the URL, note and project together", async () => {
    const close = vi.fn(); render(<AtlasBookmarkEditor accountId="account" item={bookmark} collectionId="project" onClose={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    const search = screen.getByRole("searchbox", { name: "Search tags" });
    fireEvent.change(search, { target: { value: "React" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Read this later" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", url: "https://example.com", tags: ["react"], note: "Read this later", collectionId: "project" }));
  });
  it("saves multiple existing tag identities together with a new tag", async () => {
    render(<AtlasBookmarkEditor accountId="account" item={bookmark} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    fireEvent.click(screen.getByRole("option", { name: "TypeScript" }));
    expect(screen.queryByLabelText("Selected options")).toBeNull();
    const search = screen.getByRole("searchbox", { name: "Search tags" });
    fireEvent.change(search, { target: { value: "Deep research" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyDown(search, { key: "Escape" });
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ tags: ["react", "ts", "Deep research"] })));
  });
  it("only asks for URL and project when adding a bookmark", () => {
    render(<AtlasBookmarkEditor accountId="account" onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Tags" })).toBeNull();
    expect(screen.queryByText(/From page|AI-assisted|AI off|Automatic fields/)).toBeNull();
  });
  it("shows the editable fields without page or AI assistance labels", () => {
    render(<AtlasBookmarkEditor accountId="account" item={bookmark} onClose={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "URL" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tags" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
    expect(screen.queryByText(/From page|AI-assisted|AI off|AI adds tags|Enable AI suggestions|Automatic fields/)).toBeNull();
  });
  it("retains the draft and shows a recoverable save error", async () => {
    mocks.save.mockReturnValue({ unwrap: async () => { throw new Error("This URL is already saved in Atlas"); } });
    const close = vi.fn(); render(<AtlasBookmarkEditor accountId="account" onClose={close} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("already saved");
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe("https://example.com");
    expect(close).not.toHaveBeenCalled();
  });
  it("lets an edited description be cleared", async () => {
    const item = { id: "bookmark", url: "https://example.com", title: "Saved", description: "Original", tags: [] } as unknown as AtlasItem;
    render(<AtlasBookmarkEditor accountId="account" item={item} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save bookmark" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: "bookmark", description: "" })));
  });
});
