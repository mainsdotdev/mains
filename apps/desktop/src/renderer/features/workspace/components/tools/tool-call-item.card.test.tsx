// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { McpAppToolOpenerProvider } from "@/hooks/use-mcp-app-tool-opener";
import type { RunEvent } from "../../types";
import { ToolCallItem } from "./tool-call-item";

const mocks = vi.hoisted(() => ({ getToolOutput: vi.fn() }));
vi.mock("../../hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (value: string) => value }));
vi.mock("@/lib/transport", () => ({ appApi: { runs: { getToolOutput: mocks.getToolOutput } } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const event: RunEvent = { id: "tool-42", type: "tool_call", content: "mcp__calendar__show_schedule", timestamp: new Date(), metadata: {
  runId: "run-1", toolName: "mcp__calendar__show_schedule", status: "done", input: { month: "November" },
  output: { type: "mains/deferred-tool-output", chars: 100_000, preview: "PRIVATE RAW TOOL OUTPUT" },
  mcpApp: { server: "calendar", tool: "show_schedule", resourceUri: "ui://calendar", appName: "Calendar", originCallId: "call-1" },
} };
const output = { structuredContent: { events: [] } };

it("opens a deferred app card without asking the user to expand technical output", async () => {
  const openTool = vi.fn();
  mocks.getToolOutput.mockResolvedValue({ success: true, data: { output } });
  render(<McpAppToolOpenerProvider openTool={openTool}><ToolCallItem event={event} presentation="card" /></McpAppToolOpenerProvider>);
  expect(screen.queryByText(/PRIVATE RAW TOOL OUTPUT/)).toBeNull();
  const button = await screen.findByRole("button", { name: "Open Calendar in app panel" });
  expect(mocks.getToolOutput).toHaveBeenCalledWith("run-1", 42);
  expect(screen.queryByText(/show_schedule/)).toBeNull();
  fireEvent.click(button);
  expect(openTool).toHaveBeenCalledWith(expect.objectContaining({ runId: "run-1", output, input: { month: "November" } }));
});

it("keeps a failed app load retryable without exposing the tool payload", async () => {
  mocks.getToolOutput.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ success: true, data: { output } });
  render(<McpAppToolOpenerProvider openTool={vi.fn()}><ToolCallItem event={event} presentation="card" /></McpAppToolOpenerProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry opening app: Connection lost" }));
  expect(await screen.findByRole("button", { name: "Open Calendar in app panel" })).toBeTruthy();
  expect(screen.queryByText(/PRIVATE RAW TOOL OUTPUT/)).toBeNull();
});
