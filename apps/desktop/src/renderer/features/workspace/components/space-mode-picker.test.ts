// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceModePicker } from "./space-mode-picker";

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

describe("SpaceModePicker", () => {
  it("shows all three modes, shortcuts, and the active check", async () => {
    const user = userEvent.setup();
    render(
      createElement(SpaceModePicker, {
        value: "work",
        onChange: vi.fn(),
      }),
    );

    const trigger = screen.getByRole("button", { name: "Current mode: Work" });
    expect(screen.queryByRole("menu", { name: "Choose mode" })).toBeNull();

    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Choose mode" });
    const choices = within(menu).getAllByRole("menuitemradio");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Code⌘ 1",
      "Work⌘ 2",
      "Chat⌘ 3",
    ]);
    expect(choices.map((choice) => choice.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(document.activeElement).toBe(choices[1]);
  });

  it("becomes a label for a provider that drives one experience", async () => {
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
    expect(screen.queryByRole("button", { name: /Current mode/ })).toBeNull();
  });

  it("ignores the shortcut for a mode the provider does not drive", () => {
    const onChange = vi.fn();
    render(
      createElement(SpaceModePicker, {
        value: "developer",
        providerId: "cursor",
        onChange,
      }),
    );

    fireEvent.keyDown(window, { key: "2", metaKey: true });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("changes mode and closes the chooser", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      createElement(SpaceModePicker, {
        value: "work",
        onChange,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Current mode: Work" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Chat" }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith("chat");
    expect(screen.queryByRole("menu", { name: "Choose mode" })).toBeNull();
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

    await user.click(screen.getByRole("button", { name: "Current mode: Work" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Work" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Choose mode" })).toBeNull();
  });

  it("switches modes with Command+1/2/3", () => {
    const onChange = vi.fn();
    render(
      createElement(SpaceModePicker, {
        value: "work",
        onChange,
      }),
    );

    fireEvent.keyDown(window, { key: "3", code: "Digit3", metaKey: true });

    expect(onChange).toHaveBeenCalledExactlyOnceWith("chat");
  });

  it("dismisses the dropdown with Escape", async () => {
    const user = userEvent.setup();
    render(
      createElement(SpaceModePicker, {
        value: "chat",
        onChange: vi.fn(),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Current mode: Chat" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu", { name: "Choose mode" })).toBeNull();
  });
});
