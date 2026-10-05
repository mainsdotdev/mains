// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendButton } from "./send-button";
import { RichInputForm } from "./rich-input-form";
import { Microphone } from "../icons";

describe("composer delivery controls", () => {
  it.each([false, true])("preserves the button, focus, colors and fixed icon slot through voice/send/stop/loading transitions (compact=%s)", (compact) => {
    const props = { loading: false, onSubmit: vi.fn(), onStop: vi.fn(), compact, icon: <Microphone /> };
    const { rerender } = render(<SendButton {...props} label="Start voice chat" />);
    const button = screen.getByRole("button", { name: "Start voice chat" });
    const appearance = button.className;
    const iconSlot = button.firstElementChild;
    const iconSizing = iconSlot?.className;
    const iconLayers = Array.from(iconSlot!.children);
    const microphone = button.querySelector('[data-active="true"] svg');
    button.focus();

    for (const next of [
      { showCustomIcon: false },
      { showStop: true },
      { showCustomIcon: true, label: "Start voice chat" },
    ]) {
      rerender(<SendButton {...props} {...next} />);
      const current = screen.getByRole("button");
      expect(current).toBe(button);
      expect(document.activeElement).toBe(button);
      expect(current.className).toBe(appearance);
      expect(current.firstElementChild).toBe(iconSlot);
      expect(current.firstElementChild?.className).toBe(iconSizing);
      expect(Array.from(current.firstElementChild!.children)).toEqual(iconLayers);
      expect(current.contains(microphone)).toBe(true);
      expect(current.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    }

    rerender(<SendButton {...props} loading showStop={false} />);
    const submitting = screen.getByRole("button", { name: "Submitting..." });
    expect(submitting).toBe(button);
    expect(submitting.className).toBe(appearance);
    expect(submitting.firstElementChild).toBe(iconSlot);
    expect(Array.from(submitting.firstElementChild!.children)).toEqual(iconLayers);
    expect(submitting.getAttribute("aria-busy")).toBe("true");
  });

  it("switches from Stop to Send without treating the active run as an RPC loading state", () => {
    const onStop = vi.fn(); const onSubmit = vi.fn();
    const { rerender } = render(<SendButton loading={false} showStop onStop={onStop} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop run" }));
    expect(onStop).toHaveBeenCalledOnce();
    rerender(<SendButton loading={false} showStop={false} onStop={onStop} onSubmit={onSubmit} label="Queue message" />);
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Stop run" })).toBeNull();
  });

  it("supports a microphone primary icon and disables only a pending voice closure", () => {
    const onSubmit = vi.fn(); const onStop = vi.fn();
    const props = { loading: false, onSubmit, onStop, icon: <span data-testid="microphone" />,
      label: "Start voice chat", stopLabel: "End voice chat" };
    const { rerender } = render(<SendButton {...props} />);
    expect(screen.getByTestId("microphone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start voice chat" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    rerender(<SendButton {...props} showStop disabled stopDisabled />);
    fireEvent.click(screen.getByRole("button", { name: "End voice chat" }));
    expect(onStop).not.toHaveBeenCalled();
    rerender(<SendButton {...props} showStop disabled stopDisabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "End voice chat" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("submits Enter, preserves Shift+Enter and IME, and leaves empty Enter inert", () => {
    const onSubmit = vi.fn();
    const props = { query: "next message", onQueryChange: vi.fn(), onSubmit };
    const { rerender } = render(<RichInputForm {...props} submitDisabled={false} />);
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
    rerender(<RichInputForm {...props} query="" submitDisabled />);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
