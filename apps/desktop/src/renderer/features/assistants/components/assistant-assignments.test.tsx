// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant } from "@mains/contracts/assistants";
import { AssistantAssignments } from "./assistant-assignments";
const mocks = vi.hoisted(() => ({ assign: vi.fn() }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssignAssistantTaskMutation: () => [mocks.assign, { isLoading: false }],
  useCancelAssistantTaskMutation: () => [vi.fn(), {}],
  useReconcileAssistantTaskMutation: () => [vi.fn(), {}],
  useFollowupAssistantTaskMutation: () => [vi.fn(), {}],
}));
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => { mocks.assign.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ id: "task" }) }); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });
describe("standalone assignments", () => {
  it("submits a new assignment in Work without a repo picker", async () => {
    const user = userEvent.setup();
    render(<AssistantAssignments assistant={{ id: "assistant", accountId: "account", name: "Release" } as Assistant} assignments={[]} assistants={[]} openAssistant={vi.fn()} />);
    await user.type(screen.getByLabelText("Assign to Release"), "Review release");
    await user.type(screen.getByLabelText("Scope and completion criteria"), "Verify signing and tests");
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Assign task" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", toAssistantId: "assistant", title: "Review release", prompt: "Verify signing and tests", execution: { mode: "work" } })));
  });
});
