// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";
import { toast, toastStore, Toaster } from "@/components/ui";
import { McpAppCompatibilityNotice } from "./mcp-app-compatibility-notice";

const figma: McpAppEntrypoint = { id: "figma/account-1", name: "Figma", server: "codex_apps",
  tool: "figma.open_canvas", resourceUri: "ui://figma", entrypoints: ["global"], preferredModelDisplayMode: "fullscreen" };
const tldraw: McpAppEntrypoint = { ...figma, id: "tldraw/account-1", name: "tldraw", tool: "tldraw.open_canvas" };
const magicpath: McpAppEntrypoint = { ...figma, id: "magicpath/account-1", name: "MagicPath", tool: "magicpath.open_canvas" };

function tree(app?: McpAppEntrypoint) {
  return <StrictMode><McpAppCompatibilityNotice app={app} /><Toaster /></StrictMode>;
}
const revealNotice = () => act(() => vi.advanceTimersByTime(800));
const finishExit = () => act(() => vi.advanceTimersByTime(200));
beforeEach(() => { toastStore.dismissAll(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); toastStore.dismissAll(); vi.useRealTimers(); });

describe("MCP App compatibility toast", () => {
  it.each([figma, tldraw])("keeps a neutral $name toast until dismissed, without an inline banner", (app) => {
    render(tree(app));
    expect(screen.queryByRole("note", { name: "App compatibility" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(799));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status").textContent).toContain("This app's interface is currently not supported in Mains.");
    expect(screen.getByRole("status").getAttribute("data-toast-type")).toBe("default");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(toastStore.toasts).toHaveLength(1);
    expect(toastStore.toasts[0].duration).toBe(Infinity);
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("keeps a dismissed toast dismissed across metadata refresh, route handoff and reopening", () => {
    const view = render(tree(figma));
    revealNotice();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status").hasAttribute("data-exiting")).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(screen.queryByRole("status")).toBeNull();
    view.rerender(tree({ ...figma, icons: [{ src: "https://example.com/figma.svg" }] }));
    expect(toastStore.toasts).toHaveLength(0);
    view.rerender(tree());
    view.rerender(tree(figma));
    revealNotice();
    expect(toastStore.toasts).toHaveLength(0);
  });

  it("supports Escape dismissal without showing the notice again on rerender", () => {
    const view = render(tree(figma));
    revealNotice();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("status").hasAttribute("data-exiting")).toBe(true);
    finishExit();
    expect(toastStore.toasts).toHaveLength(0);
    view.rerender(tree({ ...figma }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps one toast across app metadata changes and replaces it when another unsupported app opens", () => {
    const view = render(tree(figma));
    revealNotice();
    const id = toastStore.toasts[0].id;
    view.rerender(tree({ ...figma }));
    expect(toastStore.toasts.map((item) => item.id)).toEqual([id]);
    view.rerender(tree(tldraw));
    expect(screen.getByRole("status").hasAttribute("data-exiting")).toBe(true);
    finishExit();
    expect(screen.queryByRole("status")).toBeNull();
    revealNotice();
    expect(toastStore.toasts).toHaveLength(1);
    expect(toastStore.toasts[0].id).not.toBe(id);
    view.rerender(tree());
    expect(screen.getByRole("status").hasAttribute("data-exiting")).toBe(true);
    finishExit();
    expect(toastStore.toasts).toHaveLength(0);
  });

  it("cleans up only its own toast when leaving an app and does not classify ordinary errors as incompatibility", () => {
    const view = render(tree(figma));
    revealNotice();
    act(() => toast.error("Connection failed", { duration: Infinity }));
    view.rerender(tree(magicpath));
    finishExit();
    expect(toastStore.toasts.map((item) => item.message)).toEqual(["Connection failed"]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Connection failed");
  });

  it("cancels a pending notice when leaving or switching to a supported app", () => {
    const view = render(tree(figma));
    act(() => vi.advanceTimersByTime(400));
    view.rerender(tree(magicpath));
    revealNotice();
    expect(toastStore.toasts).toHaveLength(0);
    view.rerender(tree(tldraw));
    view.unmount();
    revealNotice();
    expect(toastStore.toasts).toHaveLength(0);
  });

  it("keeps the delay running across a metadata refresh without restarting it", () => {
    const view = render(tree(figma));
    act(() => vi.advanceTimersByTime(400));
    view.rerender(tree({ ...figma, icons: [{ src: "https://example.com/figma.svg" }] }));
    act(() => vi.advanceTimersByTime(400));
    expect(toastStore.toasts).toHaveLength(1);
  });
});
