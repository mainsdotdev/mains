// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/components/ui";
import { TerminalPanelTrigger } from "./terminal-panel-trigger";
const ui = vi.hoisted(() => ({ workspaceId: "workspace-1" as string | null }));
vi.mock("@/lib/redux/hooks", () => ({ useAppSelector: (selector: (state: unknown) => unknown) =>
  selector({ workspace: { activeWorkspaceId: ui.workspaceId } }) }));
vi.mock("@/providers/keyboard-shortcuts-provider", () => ({ useKeyboardShortcutBinding: () => undefined }));
const onToggle = vi.fn();
beforeEach(() => { onToggle.mockClear(); ui.workspaceId = "workspace-1"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("workspace terminal trigger", () => {
  it("opens and hides the terminal from the same header button", () => {
    const view = render(<TerminalPanelTrigger isOpen={false} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Open terminal" });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
    view.rerender(<TerminalPanelTrigger isOpen onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "Hide terminal" })).toBe(button);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
  it("requires a workspace to open a terminal but lets an existing terminal close", () => {
    ui.workspaceId = null;
    const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
    const view = render(<TerminalPanelTrigger isOpen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("Select a workspace first to use the terminal");
    view.rerender(<TerminalPanelTrigger isOpen onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
