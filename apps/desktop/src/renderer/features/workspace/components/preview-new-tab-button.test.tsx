// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const ui = vi.hoisted(() => ({ open: false, embeddedBrowser: true, newTab: vi.fn(), hide: vi.fn() }));
vi.mock("@/hooks/use-browser-panel", () => ({ useBrowserPanel: () => ({ newTab: ui.newTab }) }));
vi.mock("@/hooks/use-preview-panel", () => ({ usePreviewPanel: () => ({ isOpen: ui.open, hide: ui.hide }) }));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ embeddedBrowser: ui.embeddedBrowser }) }));
import { PreviewNewTabButton } from "./preview-new-tab-button";

beforeEach(() => { vi.clearAllMocks(); ui.open = false; ui.embeddedBrowser = true; ui.newTab.mockResolvedValue(undefined); });
afterEach(cleanup);

describe("preview header actions", () => {
  it("keeps the same fixed button when open + becomes close × and hides previews", async () => {
    const view = render(<PreviewNewTabButton togglePanel />);
    const button = screen.getByRole("button", { name: "New browser tab" });
    await act(async () => fireEvent.click(button));
    expect(ui.newTab).toHaveBeenCalledOnce();
    ui.open = true;
    view.rerender(<PreviewNewTabButton togglePanel />);
    expect(screen.getByRole("button", { name: "Close preview" })).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(ui.hide).toHaveBeenCalledOnce();
    expect(ui.newTab).toHaveBeenCalledOnce();
    ui.open = false;
    view.rerender(<PreviewNewTabButton togglePanel />);
    expect(screen.getByRole("button", { name: "New browser tab" })).toBe(button);
  });
  it("keeps the inline + creating new pages while previews are open", async () => {
    ui.open = true;
    render(<PreviewNewTabButton />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "New browser tab" })));
    expect(ui.newTab).toHaveBeenCalledOnce();
    expect(ui.hide).not.toHaveBeenCalled();
  });
  it("allows hiding app and document previews when native browsing is unavailable", () => {
    ui.open = true; ui.embeddedBrowser = false;
    render(<PreviewNewTabButton togglePanel />);
    const button = screen.getByRole("button", { name: "Close preview" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(ui.hide).toHaveBeenCalledOnce();
  });
});
