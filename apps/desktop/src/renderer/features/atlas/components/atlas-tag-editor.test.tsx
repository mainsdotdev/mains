// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AtlasItem } from "@mains/contracts/atlas";
import { AtlasTagEditor } from "./atlas-tag-editor";

const mocks = vi.hoisted(() => ({ save: vi.fn(), transport: "local" }));
const item = { id: "document", accountId: "account", kind: "file", title: "Research.pdf",
  tags: [{ id: "react", name: "React", source: "user" }] } as AtlasItem;
vi.mock("@/lib/redux/api/atlasApi", () => ({
  useListAtlasTagsQuery: () => ({ data: [{ id: "react", name: "React", count: 1 }, { id: "ts", name: "TypeScript", count: 1 }] }),
  useSetAtlasTagsMutation: () => [mocks.save, { isLoading: false }],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => mocks.transport }));
vi.mock("../hooks/use-save-to-atlas", () => ({ atlasError: (error: unknown) => error instanceof Error ? error.message : String(error) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transport = "local";
  mocks.save.mockReturnValue({ unwrap: async () => ({}) });
  document.documentElement.style.fontSize = "16px";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Atlas tag editor", () => {
  it("saves existing tag identities and a new tag without submitting on Enter in the picker", async () => {
    const close = vi.fn();
    render(<AtlasTagEditor item={item} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("option", { name: "TypeScript" }));
    expect(screen.queryByLabelText("Selected options")).toBeNull();
    expect(screen.getByRole("button", { name: "Tags" }).textContent).toContain("React, TypeScript");
    const search = screen.getByRole("searchbox", { name: "Search tags" });
    fireEvent.change(search, { target: { value: "New topic" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(mocks.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith({ accountId: "account", id: "document", tags: ["react", "ts", "New topic"] });
  });

  it("can remove every tag", async () => {
    const close = vi.fn();
    render(<AtlasTagEditor item={item} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    fireEvent.click(screen.getByRole("option", { name: "React" }));
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search tags" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenCalledWith({ accountId: "account", id: "document", tags: [] });
  });

  it("keeps the draft after a save error and allows retry", async () => {
    mocks.save.mockReturnValueOnce({ unwrap: async () => { throw new Error("Could not save tags"); } });
    const close = vi.fn();
    render(<AtlasTagEditor item={item} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Could not save tags");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(mocks.save).toHaveBeenLastCalledWith({ accountId: "account", id: "document", tags: ["react"] });
  });

  it("ignores completion from a backend that has been replaced", async () => {
    let finish!: () => void;
    mocks.save.mockReturnValue({ unwrap: () => new Promise<void>((resolve) => { finish = resolve; }) });
    const close = vi.fn();
    render(<AtlasTagEditor item={item} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
    mocks.transport = "other-backend";
    await act(async () => finish());
    expect(close).not.toHaveBeenCalled();
  });
});
