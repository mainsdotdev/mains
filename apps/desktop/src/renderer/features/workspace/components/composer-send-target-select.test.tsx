// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerSendTargetSelect } from "./composer-send-target-select";

const target = {
  runId: "first", label: "First chat",
  options: [{ runId: null, label: "New chat" }, { runId: "first", label: "First chat" }, { runId: "second", label: "Second chat" }],
};
afterEach(cleanup);

describe("composer send target", () => {
  it("chooses another chat or a new chat from the overlay title and closes the menu", async () => {
    const onChange = vi.fn();
    render(<ComposerSendTargetSelect target={target} onChange={onChange} variant="title" />);
    const title = screen.getByRole("button", { name: "First chat" });
    fireEvent.click(title);
    const selected = await screen.findByRole("menuitemradio", { name: "First chat" });
    expect(selected.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Second chat" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("second");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(title);
    fireEvent.click(title);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "New chat" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("dismisses the portaled menu with Escape or an outside click without switching chat", async () => {
    const onChange = vi.fn();
    render(<ComposerSendTargetSelect target={target} onChange={onChange} />);
    const title = screen.getByRole("button", { name: "First chat" });
    fireEvent.click(title);
    await screen.findByRole("menu");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(title);
    await screen.findByRole("menu");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});
