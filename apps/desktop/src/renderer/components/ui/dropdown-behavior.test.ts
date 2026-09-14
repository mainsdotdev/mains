// @vitest-environment jsdom

import {
  createElement,
  useLayoutEffect,
  useState,
  type FunctionComponent,
} from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuItem } from "./dropdown-menu";

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
