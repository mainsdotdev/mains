// @vitest-environment jsdom

import {
  createElement,
  useLayoutEffect,
  useState,
  type FunctionComponent,
} from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
} from "./dropdown-menu";

// The menu restores focus one frame after it closes, so these tests need to
// control when that frame runs — a synchronous rAF stub would fire the restore
// during the closing commit, before the effects it is supposed to yield to.
let frameCallbacks: FrameRequestCallback[] = [];

function flushFrames() {
  const pending = frameCallbacks;
  frameCallbacks = [];
  for (const callback of pending) callback(0);
}

beforeEach(() => {
  frameCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * The sidebar's shape: a trigger, a menu, and an item that closes the menu and
 * opens an inline editor in the same click — the editor grabbing focus from a
 * layout effect, as `WorkspaceItem` does for "Rename branch".
 */
const EDITOR_ID = "inline-editor";

const RowWithMenu: FunctionComponent = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // By id rather than a ref: same timing, and `createElement` in a .ts test
  // cannot take a ref without tripping the react-hooks/refs rule.
  useLayoutEffect(() => {
    if (isEditing) document.getElementById(EDITOR_ID)?.focus();
  }, [isEditing]);

  return createElement(
    "div",
    null,
    createElement("button", { onClick: () => setIsOpen(true) }, "Options"),
    createElement(
      DropdownMenu,
      {
        isOpen,
        position: { x: 0, y: 0 },
        onClose: () => setIsOpen(false),
        "aria-label": "Row actions",
      },
      createElement(
        DropdownMenuItem,
        {
          onClick: () => {
            setIsOpen(false);
            setIsEditing(true);
          },
        },
        "Rename",
      ),
      createElement(
        DropdownMenuItem,
        { onClick: () => setIsOpen(false) },
        "Archive",
      ),
    ),
    isEditing &&
      createElement("input", { id: EDITOR_ID, "aria-label": "Branch name" }),
  );
};

describe("DropdownMenu focus handoff", () => {
  it("returns focus to the trigger when an item's action leaves focus behind", async () => {
    const user = userEvent.setup();
    render(createElement(RowWithMenu));
    const trigger = screen.getByRole("button", { name: "Options" });

    await user.click(trigger);
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Rename" }),
    );

    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    flushFrames();

    expect(document.activeElement).toBe(trigger);
  });

  it("leaves focus with the editor an item opened instead of reclaiming it", async () => {
    const user = userEvent.setup();
    render(createElement(RowWithMenu));

    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    const input = screen.getByRole("textbox", { name: "Branch name" });
    expect(document.activeElement).toBe(input);

    // The restore frame lands after the editor took focus. Reclaiming the
    // trigger here would blur the editor — and a blur-to-commit editor closes
    // on the spot, which reads as the menu item doing nothing at all.
    flushFrames();

    expect(document.activeElement).toBe(input);
  });

  it("does not pull focus back to the trigger when dismissed from outside", async () => {
    const user = userEvent.setup();
    render(createElement(RowWithMenu));
    const trigger = screen.getByRole("button", { name: "Options" });

    await user.click(trigger);
    await user.click(document.body);
    flushFrames();

    expect(document.activeElement).not.toBe(trigger);
  });
});

describe("DropdownMenu viewport placement", () => {
  it.each([80, 850])("keeps right-anchored animation at x=%s while allowing an upward flip", (x) => {
    vi.stubGlobal("innerWidth", 1_200);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(220);
    const menuAt = (y: number, anchorTop: number) => createElement(
      DropdownMenu,
      { isOpen: true, position: { x, y, anchorTop }, origin: "right", onClose: () => undefined, "aria-label": "Card actions" },
      createElement(DropdownMenuItem, { onClick: () => undefined }, "Open"),
    );
    const view = render(menuAt(100, 70));
    const menu = screen.getByRole("menu", { name: "Card actions" });
    expect(menu.style.transformOrigin).toBe("top right");
    expect(menu.style.top).toBe("100px");

    view.rerender(menuAt(760, 730));
    expect(menu.style.transformOrigin).toBe("bottom right");
    expect(menu.style.top).toBe("510px");
  });

  it("flips a tall menu above an anchor near the bottom edge", () => {
    vi.stubGlobal("innerWidth", 1_200);
    vi.stubGlobal("innerHeight", 800);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "menu" ? 180 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "menu" ? 220 : 0;
      },
    );

    render(
      createElement(
        DropdownMenu,
        {
          isOpen: true,
          position: { x: 200, y: 760, anchorTop: 730 },
          onClose: () => undefined,
          "aria-label": "Bottom actions",
        },
        createElement(DropdownMenuItem, { onClick: () => undefined }, "Rename"),
        createElement(DropdownMenuItem, { onClick: () => undefined }, "Move"),
        createElement(
          DropdownMenuItem,
          { onClick: () => undefined },
          "Archive",
        ),
        createElement(DropdownMenuItem, { onClick: () => undefined }, "Delete"),
      ),
    );

    const menu = screen.getByRole("menu", { name: "Bottom actions" });
    expect(menu.style.top).toBe("510px");
    expect(menu.style.transformOrigin).toBe("bottom left");
  });

  it.each([
    { anchorLeft: 200, submenuLeft: "304px", transformOrigin: "top left" },
    { anchorLeft: 950, submenuLeft: "766px", transformOrigin: "top right" },
  ])("keeps a tall submenu visible and animates from its anchor at x=$anchorLeft", async ({ anchorLeft, submenuLeft, transformOrigin }) => {
    vi.stubGlobal("innerWidth", 1_200);
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("aria-labelledby") ? 180 : 160;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("aria-labelledby") ? 260 : 160;
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.getAttribute("role") === "menuitem") {
          return {
            x: anchorLeft,
            y: 520,
            top: 520,
            right: anchorLeft + 100,
            bottom: 550,
            left: anchorLeft,
            width: 100,
            height: 30,
            toJSON: () => ({}),
          };
        }
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        };
      },
    );

    render(
      createElement(
        DropdownMenu,
        {
          isOpen: true,
          position: { x: 200, y: 300 },
          onClose: () => undefined,
          "aria-label": "Chat actions",
        },
        createElement(
          DropdownMenuSub,
          { label: "Move" },
          createElement(
            DropdownMenuItem,
            { onClick: () => undefined },
            "No project",
          ),
          createElement(
            DropdownMenuItem,
            { onClick: () => undefined },
            "Making Stuff",
          ),
          createElement(
            DropdownMenuItem,
            { onClick: () => undefined },
            "Trips & Things",
          ),
        ),
      ),
    );

    const user = userEvent.setup();
    const trigger = screen.getByRole("menuitem", { name: "Move" });
    await user.hover(trigger);

    const submenu = screen.getByRole("menu", { name: "Move" });
    await waitFor(() => expect(submenu.style.top).toBe("332px"));
    expect(submenu.style.left).toBe(submenuLeft);
    expect(submenu.style.transformOrigin).toBe(transformOrigin);

    // Clicking an already-open hover submenu must not reset it to the initial
    // 160px height estimate.
    await user.click(trigger);
    await waitFor(() => expect(submenu.style.top).toBe("332px"));
    expect(submenu.style.left).toBe(submenuLeft);
    expect(submenu.style.transformOrigin).toBe(transformOrigin);
  });
});

describe("scrollable async menus", () => {
  let contentHeight = 180;
  const scrollBy = vi.fn();
  beforeEach(() => {
    contentHeight = 180;
    scrollBy.mockReset();
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(288);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-dropdown-content") ? contentHeight : Number.parseFloat(this.style.height) || contentHeight;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute("data-dropdown-scroll")) return this.offsetHeight;
      const height = Number.parseFloat(this.closest<HTMLElement>('[role="menu"]')!.style.height) || contentHeight;
      return height;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(600);
  });
  const menu = (label = "Loading applications…", isOpen = true) => createElement(DropdownMenu, {
    isOpen, scrollable: true, className: "w-72", origin: "right",
    position: { x: 500, y: 760, anchorTop: 730 }, onClose: () => undefined, "aria-label": "Applications",
  }, createElement(DropdownMenuItem, { onClick: () => undefined }, label));

  it("resizes after loading while keeping the same side of its trigger", () => {
    const view = render(menu());
    const surface = screen.getByRole("menu");
    expect(surface.style.height).toBe("180px");
    expect(surface.style.top).toBe("550px");
    expect(surface.style.transformOrigin).toBe("bottom right");
    flushFrames();
    expect(surface.getAttribute("data-resize-ready")).toBe("true");
    contentHeight = 600;
    view.rerender(menu("Open with Viewer"));
    expect(surface.style.height).toBe("384px");
    expect(surface.style.top).toBe("346px");
    expect(surface.style.transformOrigin).toBe("bottom right");
  });

  it("shows arrows only toward remaining content and keeps keyboard focus on a menu row", () => {
    contentHeight = 600;
    render(menu("Open with Viewer"));
    const viewport = document.querySelector<HTMLElement>('[data-dropdown-scroll="true"]')!;
    viewport.scrollBy = scrollBy;
    const item = screen.getByRole("menuitem");
    expect(screen.queryByRole("button", { name: "Scroll menu up" })).toBeNull();
    const down = screen.getByRole("button", { name: "Scroll menu down" });
    fireEvent.mouseDown(down);
    fireEvent.click(down);
    expect(scrollBy).toHaveBeenCalledWith({ top: 384 * 0.7, behavior: "smooth" });
    expect(document.activeElement).toBe(item);
    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    expect(screen.getByRole("button", { name: "Scroll menu up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scroll menu down" })).toBeTruthy();
    viewport.scrollTop = 216;
    fireEvent.scroll(viewport);
    expect(screen.queryByRole("button", { name: "Scroll menu down" })).toBeNull();
    expect(screen.getByRole("button", { name: "Scroll menu up" })).toBeTruthy();
  });

  it("does not offer arrows for short menus and respects a small viewport", () => {
    const view = render(menu());
    expect(screen.queryByRole("button", { name: /Scroll menu/ })).toBeNull();
    vi.stubGlobal("innerHeight", 300);
    contentHeight = 600;
    view.rerender(menu("Open with Viewer"));
    expect(screen.getByRole("menu").style.height).toBe("284px");
    expect(screen.getByRole("menu").style.top).toBe("8px");
  });

  it("uses instant arrow scrolling with reduced motion and resets size on reopening", () => {
    contentHeight = 600;
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const view = render(menu("Open with Viewer"));
    const viewport = document.querySelector<HTMLElement>('[data-dropdown-scroll="true"]')!;
    viewport.scrollBy = scrollBy;
    fireEvent.click(screen.getByRole("button", { name: "Scroll menu down" }));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
    view.rerender(menu("Open with Viewer", false));
    contentHeight = 180;
    view.rerender(menu());
    expect(screen.getByRole("menu").style.height).toBe("180px");
    expect(screen.queryByRole("button", { name: /Scroll menu/ })).toBeNull();
  });
});
