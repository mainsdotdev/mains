// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardShortcutsProvider } from "@/providers/keyboard-shortcuts-provider";
import { SpaceModePicker } from "./space-mode-picker";

// The picker shows macOS shortcut labels (⌘1–3); other platforms show Ctrl.
vi.mock("../../../../shared/runtime-platform", () => ({ getRuntimeOS: () => "darwin" }));

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function radios() {
  return ["Code", "Work", "Chat"].map((name) => screen.getByRole("radio", { name }));
}

describe("SpaceModePicker", () => {
  it("shows three modes and writes the label only on the selected one", () => {
    render(
      createElement(SpaceModePicker, {
        value: "work",
        onChange: vi.fn(),
      }),
    );

    const [code, work, chat] = radios();
    expect(code.getAttribute("aria-checked")).toBe("false");
    expect(work.getAttribute("aria-checked")).toBe("true");
    expect(chat.getAttribute("aria-checked")).toBe("false");
    expect(code.querySelector("[data-mode-label]")?.getAttribute("data-open")).toBe("false");
    expect(work.querySelector("[data-mode-label]")?.getAttribute("data-open")).toBe("true");
    expect(chat.querySelector("[data-mode-label]")?.getAttribute("data-open")).toBe("false");
    expect(work.querySelector("[data-mode-label]")?.textContent?.trim()).toBe("Work");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("becomes a label for a provider that drives one experience", () => {
    // Copilot and Cursor are Developer-only for now. A list of one is not a
    // choice, so the pill stays to say which experience is running and stops
    // being a control.
    render(
      createElement(SpaceModePicker, {
        value: "developer",
        providerId: "copilot_cli",
        onChange: vi.fn(),
      }),
    );

    expect(screen.getByText("Code")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("ignores the shortcut for a mode the provider does not drive", () => {
    const onChange = vi.fn();
    render(
      createElement(
        KeyboardShortcutsProvider,
        null,
        createElement(SpaceModePicker, {
          value: "developer",
          providerId: "cursor",
          onChange,
        }),
      ),
    );

    fireEvent.keyDown(window, { key: "2", metaKey: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes mode from the icon that was not selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(
        KeyboardShortcutsProvider,
        null,
        createElement(SpaceModePicker, {
          value: "work",
          onChange,
        }),
      ),
    );

    await user.click(screen.getByRole("radio", { name: "Chat" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("chat");
  });

  it("keeps the active mode selectable without firing a redundant change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(SpaceModePicker, {
        value: "work",
        onChange,
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Work" }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches modes with Command+1/2/3", () => {
    const onChange = vi.fn();
    render(
      createElement(
        KeyboardShortcutsProvider,
        null,
        createElement(SpaceModePicker, {
          value: "work",
          onChange,
        }),
      ),
    );

    fireEvent.keyDown(window, { key: "3", code: "Digit3", metaKey: true });

    expect(onChange).toHaveBeenCalledExactlyOnceWith("chat");
  });
});
