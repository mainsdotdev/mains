// @vitest-environment jsdom

import { createElement, createRef } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, ModalHeader } from "./modal";
import Alert from "./alert";

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
    [{}] as unknown as DOMRectList,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Modal behavior", () => {
  it("closes from Escape and the backdrop when those behaviors are enabled", () => {
    const onClose = vi.fn();
    render(
      createElement(
        Modal,
        { isOpen: true, onClose, "aria-label": "Preferences" },
        createElement("button", null, "Save"),
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Preferences" });
    const backdrop = dialog.previousElementSibling as HTMLElement;

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("honors the Escape and backdrop close opt-outs", () => {
    const onClose = vi.fn();
    render(
      createElement(
        Modal,
        {
          isOpen: true,
          onClose,
          closeOnEscape: false,
          closeOnBackdrop: false,
          "aria-label": "Blocking progress",
        },
        createElement("span", null, "Working"),
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Blocking progress" });
    const backdrop = dialog.previousElementSibling as HTMLElement;

    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses the requested control and restores the opener on unmount", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const initialFocusRef = createRef<HTMLButtonElement>();

    const { unmount } = render(
      createElement(
        Modal,
        {
          isOpen: true,
          onClose: () => undefined,
          initialFocusRef,
          "aria-label": "Rename workspace",
        },
        createElement("button", { ref: initialFocusRef }, "Rename"),
      ),
    );

    expect(document.activeElement).toBe(initialFocusRef.current);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("wraps focus across the first and last controls", () => {
    render(
      createElement(
        Modal,
        {
          isOpen: true,
          onClose: () => undefined,
          "aria-label": "Confirm action",
        },
        createElement("button", null, "Cancel"),
        createElement("button", null, "Confirm"),
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Confirm action" });
    const first = screen.getByRole("button", { name: "Cancel" });
    const last = screen.getByRole("button", { name: "Confirm" });

    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("wires the standard ModalHeader close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      createElement(
        Modal,
        { isOpen: true, onClose },
        createElement(ModalHeader, { onClose }, "Repository details"),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// The two keycaps describe the dialog, not whatever holds focus: ↵ runs the
// primary action and ESC cancels, wherever the user is inside the alert.
describe("Alert keyboard contract", () => {
  const renderAlert = (
    overrides: Partial<Parameters<typeof Alert>[0]> = {},
  ) => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    render(
      createElement(Alert, {
        isOpen: true,
        title: "Delete Workspace?",
        description: "This action cannot be undone.",
        primaryButtonText: "Delete",
        secondaryButtonText: "Cancel",
        onPrimary,
        onSecondary,
        ...overrides,
      }),
    );
    return {
      onPrimary,
      onSecondary,
      dialog: screen.getByRole("alertdialog"),
    };
  };

  it("runs the primary action on Enter even though a danger alert focuses Cancel", async () => {
    const user = userEvent.setup();
    const { onPrimary, onSecondary } = renderAlert({
      primaryButtonVariant: "danger",
    });

    // The safe button keeps initial focus — Enter still has to mean Delete.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Cancel/ }),
    );
    await user.keyboard("{Enter}");

    expect(onPrimary).toHaveBeenCalledOnce();
    expect(onSecondary).not.toHaveBeenCalled();
  });

  it("fires the primary action once when the primary button holds focus", async () => {
    const user = userEvent.setup();
    const { onPrimary } = renderAlert();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Delete/ }),
    );
    // Without preventDefault the focused button would activate on top of the
    // dialog-level shortcut and run the action twice.
    await user.keyboard("{Enter}");

    expect(onPrimary).toHaveBeenCalledOnce();
  });

  it("cancels on Escape", () => {
    const { onPrimary, onSecondary, dialog } = renderAlert({
      primaryButtonVariant: "danger",
    });

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onSecondary).toHaveBeenCalledOnce();
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it("ignores both keys while the primary action is running", () => {
    const { onPrimary, onSecondary, dialog } = renderAlert({
      primaryButtonVariant: "danger",
      isPrimaryLoading: true,
    });

    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onPrimary).not.toHaveBeenCalled();
    expect(onSecondary).not.toHaveBeenCalled();
  });
});
