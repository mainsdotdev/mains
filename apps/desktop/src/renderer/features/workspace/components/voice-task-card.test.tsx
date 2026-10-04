// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceTaskLink } from "@mains/contracts/realtime";
const h = vi.hoisted(() => ({ jump: vi.fn(), refetch: vi.fn(), data: null as any, status: undefined as any, updated: undefined as any, off: vi.fn() }));
vi.mock("../hooks/use-jump-to-run", () => ({ useJumpToRun: () => h.jump }));
vi.mock("@/lib/redux/api", () => ({ useGetRunByIdQuery: () => ({ data: h.data, refetch: h.refetch, isLoading: false }) }));
vi.mock("@/lib/transport", () => ({ appEvents: { runs: {
  onStatusChanged: (cb: unknown) => { h.status = cb; return h.off; },
  onUpdated: (cb: unknown) => { h.updated = cb; return h.off; },
} } }));
vi.mock("@/components/ui", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Text: ({ children, size: _size, tone: _tone, weight: _weight, ...props }: any) => <span {...props}>{children}</span>,
}));
import { VoiceTaskCard } from "./voice-task-card";
const task: VoiceTaskLink = { id: "worker", taskKey: "hero", title: "Hero refactor", mode: "developer", providerId: "codex", workspaceId: "workspace", spaceId: "space", collectionId: null };
afterEach(() => { cleanup(); vi.clearAllMocks(); h.data = null; });

describe("voice task navigation card", () => {
  it("opens the real working chat and follows only that chat's status events", () => {
    h.data = { ...task, status: "running", isArchived: false };
    const view = render(<VoiceTaskCard task={task} />);
    expect(screen.getByRole("status").textContent).toBe("Working");
    fireEvent.click(screen.getByRole("button", { name: "Open chat: Hero refactor" }));
    expect(h.jump).toHaveBeenCalledExactlyOnceWith(h.data);
    h.status({ runId: "other" }); h.updated({ runId: "other" });
    expect(h.refetch).not.toHaveBeenCalled();
    h.status({ runId: "worker" }); expect(h.refetch).toHaveBeenCalledOnce();
    h.data = { ...h.data, status: "succeeded" }; view.rerender(<VoiceTaskCard task={task} />);
    expect(screen.getByRole("status").textContent).toBe("Reply ready");
    view.unmount(); expect(h.off).toHaveBeenCalledTimes(2);
  });
  it("keeps a deleted worker's card visible without offering a broken jump", () => {
    render(<VoiceTaskCard task={task} />);
    expect(screen.getByRole("status").textContent).toBe("Unavailable");
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
