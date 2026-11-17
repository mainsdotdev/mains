// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mapToolCallToEvent } from "../../lib/run-event-mappers";
import { resolveTool } from "../../lib/resolve-tool";
import { ASSISTANT_TOOL_LABELS } from "../../lib/assistant-tool-content";
import { ToolCallItem } from "./tool-call-item";

vi.mock("../../hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (name: string) => name }));
afterEach(cleanup);

it.each(Object.keys(ASSISTANT_TOOL_LABELS))("keeps %s separate from native Task for both providers", name => {
  for (const wire of [name, `mcp__mains__${name}`]) {
    expect(resolveTool(wire)).toMatchObject({ category: "Assistants", groupKey: name.toLowerCase(), displayName: name });
  }
  expect(resolveTool("Task").groupKey).toBe("task");
});

it.each(["inputText", "text"])("shows assignment result and evidence from %s envelopes without JSON", type => {
  const data = { id: "task-1", title: "TestFlight check", status: "blocked",
    prompt: "Check beta prerequisites", result: "Ruby is missing", evidence: ["beta:check exited 1"] };
  const event = mapToolCallToEvent({ id: 1, runId: "r", toolName: "ReadAssistantTask", status: "done",
    input: JSON.stringify({ assignmentId: "task-1" }), output: JSON.stringify([{ type, text: JSON.stringify(data) }]) })!;
  const { container } = render(<ToolCallItem event={event} isCompact={false} />);
  fireEvent.click(screen.getByText("Read assistant assignment"));
  expect(screen.getAllByText("TestFlight check")[0]).toBeTruthy();
  expect(screen.getByText("Ruby is missing")).toBeTruthy();
  expect(screen.getByText("beta:check exited 1")).toBeTruthy();
  expect(screen.getByText("blocked")).toBeTruthy();
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toContain('"assignmentId"');
});

it("renders assistant roster roles", () => {
  const event = mapToolCallToEvent({ id: 2, runId: "r", toolName: "ListAssistants", status: "done",
    input: "{}", output: JSON.stringify({ content: [{ type: "text", text: JSON.stringify([{ name: "Testflight", role: "Check builds", providerId: "codex" }]) }] }) })!;
  render(<ToolCallItem event={event} isCompact={false} />);
  fireEvent.click(screen.getByText("Listed assistants"));
  expect(screen.getByText("Testflight")).toBeTruthy();
  expect(screen.getByText("Check builds")).toBeTruthy();
  expect(screen.getByText("codex")).toBeTruthy();
});

it("keeps pending assistant tools visible without arguments or output", () => {
  render(<ToolCallItem event={{ id: "pending", type: "tool_call", content: "ListAssistantTasks", timestamp: new Date(),
    metadata: { toolName: "ListAssistantTasks", status: "running" } }} />);
  expect(screen.getByText(/assistant assignments/)).toBeTruthy();
});

it("shows an empty list without raw JSON", () => {
  const event = mapToolCallToEvent({ id: 3, runId: "r", toolName: "ListAssistantTasks", status: "done", input: "{}", output: "[]" })!;
  render(<ToolCallItem event={event} isCompact={false} />);
  fireEvent.click(screen.getByText("Listed assistant assignments"));
  expect(screen.getByText("None")).toBeTruthy();
});

it("shows a routine's schedule, timezone and state through the existing tool display", () => {
  const result = { defaultTimezone: "Europe/Istanbul", defaultExecution: { mode: "work" },
    routines: [{ id: "routine-1", title: "Check TestFlight", prompt: "Check beta readiness",
      frequency: "daily", dayOfWeek: null, hour: 9, minute: 30, timezone: "Europe/Istanbul", isActive: false }] };
  const event = mapToolCallToEvent({ id: 4, runId: "r", toolName: "ListAssistantRoutines", status: "done",
    input: "{}", output: JSON.stringify([{ type: "inputText", text: JSON.stringify(result) }]) })!;
  const { container } = render(<ToolCallItem event={event} isCompact={false} />);
  fireEvent.click(screen.getByText("Listed assistant routines"));
  expect(screen.getByText("Check TestFlight")).toBeTruthy();
  expect(screen.getByText("Daily at 9:30 AM")).toBeTruthy();
  expect(screen.getAllByText("Europe/Istanbul")).toHaveLength(2);
  expect(screen.getByText("Enabled")).toBeTruthy();
  expect(screen.getByText("No")).toBeTruthy();
  expect(container.querySelector("pre")).toBeNull();
});
