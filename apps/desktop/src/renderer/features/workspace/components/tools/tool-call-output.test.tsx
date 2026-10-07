// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createTranscriptViewCache, TranscriptViewProvider, useToolExpansion } from "../../lib/transcript-view-state";

const { getOutput } = vi.hoisted(() => ({ getOutput: vi.fn() }));
vi.mock("@/lib/transport", () => ({ appApi: { runs: { getToolOutput: getOutput } } }));
vi.mock("../../hooks", () => ({ usePluginLogoMap: () => new Map(), renderPluginIcon: () => null, normalizeSlug: (name: string) => name }));
vi.mock("./read-display", () => ({ ReadDisplay: ({ output }: { output: unknown }) => {
  const [expanded, setExpanded] = useToolExpansion();
  return <button onClick={() => setExpanded(!expanded)}>Loaded: {String(output)}</button>;
} }));
import { ToolCallItem } from "./tool-call-item";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const event = { id: "tool-12", type: "tool_call" as const, content: "Read: /tmp/a", timestamp: new Date(),
  metadata: { runId: "r", toolName: "Read", status: "done", input: { file_path: "/tmp/a" },
    output: { type: "mains/deferred-tool-output", preview: "Small preview", chars: 100_000 } } };

it("requests full output only on expansion and releases it after closing", async () => {
  vi.useFakeTimers();
  getOutput.mockResolvedValue({ success: true, data: { output: "FULL_CONTENT" } });
  render(<TranscriptViewProvider view={createTranscriptViewCache().get("r")}><ToolCallItem event={event} /></TranscriptViewProvider>);
  expect(getOutput).not.toHaveBeenCalled();
  await act(async () => { fireEvent.click(screen.getByText("/tmp/a")); });
  expect(getOutput).toHaveBeenCalledWith("r", 12);
  expect(screen.getByText("Loaded: FULL_CONTENT")).toBeTruthy();
  fireEvent.click(screen.getByText("Loaded: FULL_CONTENT"));
  act(() => vi.advanceTimersByTime(200));
  expect(screen.queryByText("Loaded: FULL_CONTENT")).toBeNull();
  expect(screen.getByText("/tmp/a")).toBeTruthy();
});

it("offers retry after a failed request", async () => {
  getOutput.mockResolvedValueOnce({ success: false, error: "Offline" }).mockResolvedValueOnce({ success: true, data: { output: "RECOVERED" } });
  render(<TranscriptViewProvider view={createTranscriptViewCache().get("r")}><ToolCallItem event={event} /></TranscriptViewProvider>);
  await act(async () => { fireEvent.click(screen.getByText("/tmp/a")); });
  await act(async () => { fireEvent.click(screen.getByText("Retry loading output: Offline")); });
  expect(getOutput).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Loaded: RECOVERED")).toBeTruthy();
});
