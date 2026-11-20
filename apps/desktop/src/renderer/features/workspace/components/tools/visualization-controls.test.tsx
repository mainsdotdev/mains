// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisualizationControls } from "@mains/contracts/visualization";
import { VisualizationControlsView } from "./visualization-controls";

const mocks = vi.hoisted(() => ({ followUp: vi.fn() }));
vi.mock("@/features/workspace/lib/visualization-bridge", () => ({ requestVisualizationFollowUp: mocks.followUp }));

const controls: VisualizationControls = {
  language: "en", previewing: false,
  carousels: [{ id: "carousel", label: "Designs", previousLabel: "Previous", nextLabel: "Next", selectedId: "expand",
    variants: [{ id: "expand", label: "Expand" }, { id: "trace", label: "Trace" }, { id: "connect", label: "Connect" }] }],
  groups: [{ id: "group", label: "Expansion", variant: "Expand", visible: true, controls: [
    { id: "duration", label: "Duration", type: "range", initialValue: 520, value: 700, min: 350, max: 900, step: 10, unit: "ms", reference: "--duration" },
    { id: "appearance", label: "Appearance", type: "select", initialValue: "system", value: "system", options: [{ label: "System", value: "system" }, { label: "Dark", value: "dark" }] },
    { id: "color", label: "Tint", type: "color", initialValue: "#1234", value: "#1234" },
    { id: "enabled", label: "Enabled", type: "toggle", initialValue: true, value: true },
  ] }, { id: "hidden", label: "Outline", variant: "Trace", visible: false,
    controls: [{ id: "hidden-range", label: "Duration", type: "range", initialValue: 520, value: 800, min: 350, max: 900, step: 10 }] }],
};

beforeEach(() => {
  document.documentElement.style.fontSize = "16px";
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  mocks.followUp.mockClear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(value = controls) {
  const send = vi.fn();
  const frameRef = createRef<HTMLIFrameElement>();
  const view = render(<VisualizationControlsView controls={value} absPath="/project/design.html" sendCommand={send} frameRef={frameRef} />);
  return { ...view, send, frameRef };
}

describe("visualization controls using the shared components", () => {
  it("uses the common Select and Button for named variants and boundary navigation", () => {
    const { send, container } = setup();
    const picker = screen.getByRole("button", { name: "Choose a variant" });
    expect(picker.className).toContain("glass-input");
    expect(picker.textContent).toContain("1 / 3 Expand");
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Next" }).className).toContain("button-control");
    fireEvent.click(picker);
    fireEvent.click(screen.getByRole("option", { name: "Connect" }));
    expect(send).toHaveBeenCalledWith({ type: "select-variant", carouselId: "carousel", variantId: "connect" });
    expect(container.querySelector("select")).toBeNull();
  });

  it("uses common Slider, Select, Toggle and Input controls and keeps the settings panel open for portaled options", async () => {
    const { send } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Design settings" }));
    const slider = screen.getByRole("slider", { name: "Duration" });
    expect(slider.getAttribute("aria-valuetext")).toBe("700 ms");
    expect(slider.className).toContain("opacity-0");
    fireEvent.change(slider, { target: { value: "800" } });
    expect(send).toHaveBeenCalledWith({ type: "set-control", groupId: "group", controlId: "duration", value: 800 });
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    const dark = screen.getByRole("option", { name: "Dark" });
    fireEvent.mouseDown(dark);
    fireEvent.click(dark);
    expect(send).toHaveBeenCalledWith({ type: "set-control", groupId: "group", controlId: "appearance", value: "dark" });
    expect(screen.getByRole("dialog", { name: "Design settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    expect(send).toHaveBeenCalledWith({ type: "set-control", groupId: "group", controlId: "enabled", value: false });
    const tint = screen.getByRole("textbox", { name: "Tint" });
    expect(tint.className).toContain("glass-input");
    fireEvent.change(tint, { target: { value: "#" } });
    expect((tint as HTMLInputElement).value).toBe("#");
    fireEvent.change(tint, { target: { value: "#abcdef80" } });
    expect(send).toHaveBeenCalledWith({ type: "set-control", groupId: "group", controlId: "color", value: "#abcdef80" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBe(document.activeElement));
  });

  it("releases original preview on pointer cancellation, closing and unmounting", () => {
    const { send, unmount } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Design settings" }));
    const original = screen.getByRole("button", { name: "Preview original" });
    fireEvent.pointerDown(original);
    expect(send).toHaveBeenLastCalledWith({ type: "preview-original", active: true });
    fireEvent.pointerCancel(window);
    expect(send).toHaveBeenLastCalledWith({ type: "preview-original", active: false });
    fireEvent.pointerDown(original);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(send).toHaveBeenLastCalledWith({ type: "preview-original", active: false });
    fireEvent.click(screen.getByRole("button", { name: "Design settings" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Preview original" }));
    unmount();
    expect(send).toHaveBeenLastCalledWith({ type: "preview-original", active: false });
  });

  it("resets through the sandbox bridge and adds edits from visible and hidden variants to the existing composer", () => {
    const { send } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Design settings" }));
    expect(screen.getByRole("status").textContent).toBe("Edits: 2");
    expect(screen.queryByText("Outline")).toBeNull();
    expect(mocks.followUp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(send).toHaveBeenCalledWith({ type: "reset" });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    const request = mocks.followUp.mock.calls[0][0];
    expect(request.prompt).toContain("File: /project/design.html");
    expect(request.prompt).toContain("[Expand] Expansion: Duration (--duration): 520 → 700");
    expect(request.prompt).toContain("[Trace] Outline: Duration: 520 → 800");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses the Select first on Escape, then closes the panel and returns focus to its trigger", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Design settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Design settings" })));
  });
});
