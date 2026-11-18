// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantAssignment } from "@mains/contracts/assistants";
import { AssistantAssignments } from "./assistant-assignments";
const mocks = vi.hoisted(() => ({ assign: vi.fn(), cancel: vi.fn(), reconcile: vi.fn(), followup: vi.fn() }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssignAssistantTaskMutation: () => [mocks.assign, { isLoading: false }],
  useCancelAssistantTaskMutation: () => [mocks.cancel, {}],
  useReconcileAssistantTaskMutation: () => [mocks.reconcile, {}],
  useFollowupAssistantTaskMutation: () => [mocks.followup, {}],
}));
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ id: "task" }) });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

const assistant = { id: "assistant", accountId: "account", name: "Release", teamId: null } as Assistant;

function assignment(overrides: Partial<AssistantAssignment>): AssistantAssignment {
  return {
    id: "task", accountId: "account", teamId: null, fromAssistantId: null, toAssistantId: "assistant",
    fromRunId: null, parentId: null, taskKey: "test", title: "Review release", prompt: "Review the build log.",
    status: "completed", execution: { mode: "work" }, workerRunId: "worker", result: null, evidence: [],
    error: null, createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
  };
}

describe("standalone assignments", () => {
  it("submits a new assignment in Work without a repo picker", async () => {
    const user = userEvent.setup();
    render(<AssistantAssignments assistant={assistant} assignments={[]} assistants={[]} openAssistant={vi.fn()} />);
    expect(screen.queryByRole("form", { name: "New assignment" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "New assignment" }));
    await user.type(screen.getByLabelText("Assign to Release"), "Review release");
    await user.type(screen.getByLabelText("Scope and completion criteria"), "Verify signing and tests");
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Assign task" }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account", toAssistantId: "assistant", title: "Review release", prompt: "Verify signing and tests", execution: { mode: "work" } })));
    expect(screen.queryByRole("form", { name: "New assignment" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New assignment" }));
  });

  it("keeps reports compact until expanded and opens the worker chat from the card", async () => {
    const user = userEvent.setup();
    const openAssistant = vi.fn();
    const task = assignment({ result: "**Build reviewed.**", evidence: ["logs/build.log"] });
    render(<AssistantAssignments assistant={assistant} assignments={[task]} assistants={[assistant]} openAssistant={openAssistant} />);
    const card = within(screen.getByRole("article", { name: task.title }));
    const toggle = card.getByRole("button", { name: /Review release.*Completed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.getByText("Build reviewed.")).toBeTruthy();
    expect(card.queryByRole("region", { name: "Report" })).toBeNull();
    expect(card.queryByRole("button", { name: "Open chat" })).toBeNull();

    await user.click(toggle);
    const details = within(card.getByRole("group", { name: "Assignment details" }));
    expect(details.getByRole("region", { name: "Task brief" }).textContent).toContain(task.prompt);
    expect(details.getByRole("list", { name: "Task evidence" }).textContent).toContain("logs/build.log");
    await user.click(details.getByRole("button", { name: "Open chat" }));
    expect(openAssistant).toHaveBeenCalledWith("assistant", "worker");

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(card.queryByRole("group", { name: "Assignment details" })).toBeNull();
  });

  it("shows the Mate name on generated mention requests and preserves typed titles", () => {
    const assignments = [
      assignment({ id: "mention", taskKey: "mention:prompt:request", title: "Assistant request" }),
      assignment({ id: "manual", taskKey: "manual", title: "Assistant request" }),
    ];
    render(<AssistantAssignments assistant={assistant} assignments={assignments} assistants={[assistant]} openAssistant={vi.fn()} />);
    expect(screen.getByRole("article", { name: "Mate request" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Assistant request" })).toBeTruthy();
  });

  it("retains a blocked follow-up while collapsed and retries it with the same message id", async () => {
    const user = userEvent.setup();
    const task = assignment({ status: "blocked", error: "Signing team is missing." });
    mocks.followup.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("Delivery could not be confirmed")) });
    render(<AssistantAssignments assistant={assistant} assignments={[task]} assistants={[assistant]} openAssistant={vi.fn()} />);
    const card = within(screen.getByRole("article", { name: task.title }));
    const toggle = card.getByRole("button", { name: /Review release.*Blocked/ });
    await user.click(toggle);
    expect(card.getByRole("region", { name: "Status details" }).textContent).toContain(task.error);
    await user.type(card.getByRole("textbox", { name: "Task follow-up" }), "Use the release team.");
    await user.click(toggle);
    expect(card.queryByRole("textbox", { name: "Task follow-up" })).toBeNull();
    await user.click(toggle);
    expect(card.getByRole<HTMLInputElement>("textbox", { name: "Task follow-up" }).value).toBe("Use the release team.");

    await user.click(card.getByRole("button", { name: "Continue" }));
    expect((await card.findByRole("alert")).textContent).toBe("Delivery could not be confirmed");
    await user.click(card.getByRole("button", { name: "Check delivery" }));
    expect(mocks.followup).toHaveBeenCalledTimes(2);
    expect(mocks.followup.mock.calls[1][0]).toEqual(mocks.followup.mock.calls[0][0]);
  });

  it("keeps delivery checks and cancellation available for an uncertain assignment", async () => {
    const user = userEvent.setup();
    const task = assignment({ status: "uncertain" });
    render(<AssistantAssignments assistant={assistant} assignments={[task]} assistants={[assistant]} openAssistant={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Review release.*Delivery uncertain/ }));
    await user.click(screen.getByRole("button", { name: "Check delivery" }));
    await user.click(screen.getByRole("button", { name: "Cancel task" }));
    expect(mocks.reconcile).toHaveBeenCalledWith({ accountId: "account", id: task.id });
    expect(mocks.cancel).toHaveBeenCalledWith({ accountId: "account", id: task.id });
  });
});
