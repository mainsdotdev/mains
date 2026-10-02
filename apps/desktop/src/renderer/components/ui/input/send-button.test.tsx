// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendButton } from "./send-button";
import { RichInputForm } from "./rich-input-form";

describe("composer delivery controls", () => {
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
