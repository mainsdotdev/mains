// @vitest-environment jsdom

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabStrip } from "./tab-strip";

let viewportWidth = 180;
let notifyResize = () => {};
function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) };
}

beforeEach(() => {
  viewportWidth = 180;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-tab-viewport") ? viewportWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-tab-viewport")) return rect(0, viewportWidth);
    const index = Number(this.getAttribute("data-index"));
    const viewport = this.closest<HTMLElement>("[data-tab-viewport]");
    return rect(index * 112 - (viewport?.scrollLeft ?? 0), 112);
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function strip(active: number, count = 3, onCreate = () => {}) {
  return createElement(TabStrip, { activeKey: String(active), role: "tablist", "aria-label": "Example tabs",
    createAction: createElement("button", { onClick: onCreate }, "New tab") },
    Array.from({ length: count }, (_, index) => createElement("button", { key: index, role: "tab", "data-index": index,
      "data-tab-active": index === active ? "true" : undefined }, `Tab ${index}`)));
}

describe("TabStrip", () => {
  it("reveals external selection horizontally without scrolling the page", () => {
    const view = render(strip(0));
    const viewport = screen.getByRole("tablist", { name: "Example tabs" });
    expect(viewport.scrollLeft).toBe(0);
    view.rerender(strip(2));
    expect(viewport.scrollLeft).toBe(156);
    view.rerender(strip(0));
    expect(viewport.scrollLeft).toBe(0);
  });

  it("keeps the selected tab visible when its lane narrows", () => {
    render(strip(2));
    const viewport = screen.getByRole("tablist");
    viewportWidth = 120;
    act(() => notifyResize());
    expect(viewport.scrollLeft).toBe(216);
  });

  it("keeps the leading edge stable when the lane is narrower than one tab", () => {
    viewportWidth = 80;
    render(strip(2));
    const viewport = screen.getByRole("tablist");
    expect(viewport.scrollLeft).toBe(224);
    act(() => notifyResize());
    act(() => notifyResize());
    expect(viewport.scrollLeft).toBe(224);
  });

  it("preserves manual scrolling until selection, tab count or lane size changes", () => {
    const view = render(strip(2));
    const viewport = screen.getByRole("tablist");
    viewport.scrollLeft = 10;
    view.rerender(strip(2));
    expect(viewport.scrollLeft).toBe(10);
    view.rerender(strip(3, 4));
    expect(viewport.scrollLeft).toBe(268);
  });

  it("keeps the create action outside the scrolling tab list", () => {
    const create = vi.fn();
    render(strip(2, 8, create));
    const action = screen.getByRole("button", { name: "New tab" });
    expect(screen.getByRole("tablist").contains(action)).toBe(false);
    fireEvent.click(action);
    expect(create).toHaveBeenCalledOnce();
  });
});
