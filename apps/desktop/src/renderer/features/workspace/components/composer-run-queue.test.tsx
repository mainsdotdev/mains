// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerRunQueue } from "../hooks/use-composer-run-queue";
import type { QueuedRunMessage } from "@/lib/redux/slices/runQueueSlice";
import { ComposerQueueCard } from "./composer-run-queue";

function message(id: string, text: string): QueuedRunMessage {
  return { id, text, contextItems: [], attachmentNames: [], uploadOwnerKey: `queue:${id}`, status: "queued" };
}

function controls(): ComposerRunQueue {
  return {
    queue: {
      backendId: "local", runId: "run", runStatus: "running", mode: "queue",
      messages: [message("first", "Continue"), message("second", "Next message")],
    },
    editing: false,
    onSteer: vi.fn(), onRemove: vi.fn(), onEdit: vi.fn(), onCancelEdit: vi.fn(),
    onResume: vi.fn(), onModeChange: vi.fn(), onReorder: vi.fn(),
  };
}

afterEach(cleanup);

describe("queued message interactions", () => {
  it("bounds the rotated options SVG instead of letting its 800px intrinsic size cover the row", () => {
    render(<ComposerQueueCard controls={controls()} isRunning />);
    for (const trigger of screen.getAllByRole("button", { name: "Queued message options" })) {
      const icon = trigger.querySelector("svg")!;
      // JSDOM does not lay out rotated SVGs. Check the real icon's dimensions
      // at this call site, where an oversized viewport intercepted adjacent clicks.
      expect(icon.getAttribute("width")).toBe("16");
      expect(icon.getAttribute("height")).toBe("16");
    }
  });

  it("keeps text, Steer and Remove clicks separate from the menu and drag handle", async () => {
    const actions = controls();
    const user = userEvent.setup();
    render(<ComposerQueueCard controls={actions} isRunning />);
    await user.click(screen.getByText("Continue"));
    const steer = screen.getByRole("button", { name: "Steer: Continue" });
    const remove = screen.getByRole("button", { name: "Remove queued message: Next message" });
    await user.click(steer.querySelector("svg")!);
    await user.click(remove.querySelector("svg")!);
    expect(actions.onSteer).toHaveBeenCalledExactlyOnceWith("first");
    expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith("second");
    expect(actions.onEdit).not.toHaveBeenCalled();
    expect(actions.onReorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
    for (const trigger of screen.getAllByRole("button", { name: "Queued message options" })) {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("opens options from its own icon and edits the selected message", async () => {
    const actions = controls();
    const user = userEvent.setup();
    render(<ComposerQueueCard controls={actions} isRunning />);
    const row = screen.getByText("Next message").closest('[role="listitem"]')!;
    const trigger = within(row as HTMLElement).getByRole("button", { name: "Queued message options" });
    await user.click(trigger.querySelector("svg")!);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Edit message" }));
    expect(actions.onEdit).toHaveBeenCalledExactlyOnceWith("second");
    expect(actions.onSteer).not.toHaveBeenCalled();
    expect(actions.onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes an open menu when clicking an adjacent action and still runs that action", async () => {
    const actions = controls();
    const user = userEvent.setup();
    render(<ComposerQueueCard controls={actions} isRunning />);
    await user.click(screen.getAllByRole("button", { name: "Queued message options" })[0]);
    await screen.findByRole("menu");
    await user.click(screen.getByRole("button", { name: "Remove queued message: Continue" }));
    expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith("first");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("allows removal and resuming a stopped queue while Steer requires an active turn", async () => {
    const actions = controls();
    actions.queue!.runStatus = "canceled";
    actions.queue!.pauseReason = "Run stopped. Queued messages are paused.";
    actions.queue!.messages = [actions.queue!.messages[0]];
    const user = userEvent.setup();
    render(<ComposerQueueCard controls={actions} isRunning={false} />);
    const steer = screen.getByRole("button", { name: "Steer: Continue" });
    expect((steer as HTMLButtonElement).disabled).toBe(true);
    await user.click(steer);
    await user.click(screen.getByRole("button", { name: "Remove queued message: Continue" }));
    await user.click(screen.getByRole("button", { name: "Resume queue" }));
    expect(actions.onSteer).not.toHaveBeenCalled();
    expect(actions.onRemove).toHaveBeenCalledExactlyOnceWith("first");
    expect(actions.onResume).toHaveBeenCalledOnce();
  });
});
