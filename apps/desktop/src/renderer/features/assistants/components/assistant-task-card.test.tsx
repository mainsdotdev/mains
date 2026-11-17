// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantAssignment } from "@mains/contracts/assistants";
import { AssistantTaskCard } from "./assistant-task-card";
const mocks = vi.hoisted(() => ({ task: undefined as AssistantAssignment | undefined }));
vi.mock("@/lib/redux/api", () => ({ useGetAccountQuery: () => ({ data: { id: "account" } }), useGetWorkspaceQuery: (id: string) => ({ currentData: id ? { name: "Mains" } : undefined }) }));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useAssistantOverviewQuery: () => ({ currentData: { assistants: [{ id: "assistant", name: "Testflight Ready", providerId: "codex" }] } }),
  useAssistantAssignmentQuery: () => ({ currentData: mocks.task }),
}));
vi.mock("../hooks/use-assistant-updates", () => ({ useAssistantUpdates() {} }));
afterEach(cleanup);

describe("assistant task activity card", () => {
  it.each(["source", "worker"])("shows task events within one glass card in the %s chat", runId => {
    mocks.task = { id: "task", fromRunId: "source", workerRunId: "worker", toAssistantId: "assistant", status: "completed", execution: { mode: "developer", workspaceId: "repo" }, prompt: "Review TestFlight", result: "Check complete: NOT READY", evidence: ["swift-test.log"], error: null,
      activity: [
        { id: "request", kind: "request", content: "Review TestFlight", deliveryStatus: "delivered", error: null, createdAt: new Date() },
        { id: "status", kind: "status", content: "Report missing", deliveryStatus: "delivered", error: null, createdAt: new Date() },
        { id: "followup", kind: "followup", content: "Continue the existing check", deliveryStatus: "delivered", error: null, createdAt: new Date() },
        { id: "result", kind: "result", content: "Final task report", deliveryStatus: "uncertain", error: "Connection lost", createdAt: new Date() },
        { id: "delivered-report", kind: "result", content: "Check complete: NOT READY", deliveryStatus: "delivered", error: null, createdAt: new Date() },
      ] } as AssistantAssignment;
    render(<MemoryRouter><AssistantTaskCard assignmentId="task" runId={runId} /></MemoryRouter>);
    const card = screen.getByRole("article", { name: "Testflight Ready task" });
    expect(card.className).toContain("glass-card");
    const summary = within(card).getByRole("button", { name: /Testflight Ready.*completed/i });
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    expect(within(card).getByText("Check complete: NOT READY")).toBeTruthy();
    expect(within(card).queryByRole("list", { name: "Task activity" })).toBeNull();
    fireEvent.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(within(card).getAllByText("Check complete: NOT READY")).toHaveLength(1);
    expect(within(card).getAllByText("Review TestFlight")).toHaveLength(1);
    expect(within(card).getByText("Report missing")).toBeTruthy();
    expect(within(card).getByText("Continue the existing check")).toBeTruthy();
    expect(within(card).getByText("Final task report")).toBeTruthy();
    expect(within(card).getByText("Connection lost")).toBeTruthy();
    expect(within(card).getByText("Needs attention")).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Open chat" }) !== null).toBe(runId === "source");
  });

  it("collapses a canceled task and retains its request when the activity list is missing", () => {
    mocks.task = {
      id: "task", accountId: "account", teamId: "team", fromAssistantId: null, toAssistantId: "assistant",
      fromRunId: "source", workerRunId: "worker", parentId: null, taskKey: "review", title: "Review",
      status: "canceled", execution: { mode: "work" }, prompt: "Review TestFlight",
      result: null, evidence: [], error: null, createdAt: new Date(), updatedAt: new Date(),
    };
    render(<MemoryRouter><AssistantTaskCard assignmentId="task" runId="source" /></MemoryRouter>);

    const card = screen.getByRole("article", { name: "Testflight Ready task" });
    const summary = within(card).getByRole("button", { name: /Testflight Ready.*Work.*canceled/i });
    expect(within(card).queryByText("Review TestFlight")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Open chat" })).toBeNull();
    fireEvent.click(summary);
    expect(within(card).getByText("Review TestFlight")).toBeTruthy();
    fireEvent.click(summary);
    expect(within(card).queryByText("Review TestFlight")).toBeNull();
  });

  it("does not expose task content in an unrelated chat", () => {
    mocks.task = { fromRunId: "source", workerRunId: "worker", prompt: "Private task" } as AssistantAssignment;
    render(<MemoryRouter><AssistantTaskCard assignmentId="task" runId="unrelated" /></MemoryRouter>);
    expect(screen.queryByText("Private task")).toBeNull();
    expect(screen.getByText("This task belongs to another conversation.")).toBeTruthy();
  });
});
