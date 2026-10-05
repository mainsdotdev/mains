// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewDiffStyle } from "../lib/review-diff";
import { ReviewToolbar } from "./review-toolbar";

const files = ["src/alpha.ts", "src/beta.ts", "docs/alpha.md"].map((path) => ({ path, patchId: path }));
function Harness({ onJump = vi.fn() }: { onJump?: (path: string) => void }) {
  const anchor = useRef<HTMLElement>(null);
  const [style, setStyle] = useState<ReviewDiffStyle>("unified");
  return <header ref={anchor}><ReviewToolbar files={files} anchorRef={anchor} onJump={onJump}
    diffStyle={style} onStyleChange={setStyle} /></header>;
}
beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

describe("review toolbar", () => {
  it("filters paths and selects the keyboard-highlighted file from a downward opening menu", () => {
    const onJump = vi.fn();
    render(<Harness onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "Jump to file" }));
    const search = screen.getByRole("combobox", { name: "Search changed files" });
    expect(document.activeElement).toBe(search);
    expect(screen.getByRole("dialog").getAttribute("data-animation-direction")).toBe("down");
    fireEvent.change(search, { target: { value: "src" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "src/beta.ts" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith("src/beta.ts");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("handles empty results and Escape without jumping, and restores the trigger's focus", () => {
    const onJump = vi.fn();
    render(<Harness onJump={onJump} />);
    const trigger = screen.getByRole("button", { name: "Jump to file" });
    fireEvent.click(trigger);
    const search = screen.getByRole("combobox");
    fireEvent.change(search, { target: { value: "unknown" } });
    expect(screen.getByText("No matching files.")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("selects a clicked file and toggles unified/split in both directions", () => {
    const onJump = vi.fn();
    render(<Harness onJump={onJump} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to split diff" }));
    const split = screen.getByRole("button", { name: "Switch to unified diff" });
    expect(split.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(split);
    expect(screen.getByRole("button", { name: "Switch to split diff" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Jump to file" }));
    fireEvent.click(screen.getByRole("option", { name: "docs/alpha.md" }));
    expect(onJump).toHaveBeenCalledWith("docs/alpha.md");
  });
});
