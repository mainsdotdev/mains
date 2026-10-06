// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Run, RunEvent } from "../types";
import type { EventGroup } from "../lib/group-events";
import { WorkspaceEvents } from "./workspace-events";

vi.mock("./tools/tool-call-group", async () => ({
  ...await import("../lib/group-events"),
  InfoGroup: ({ group }: { group: EventGroup }) => group.events.map((event) => <p key={event.id}>{event.content}</p>),
  ToolCallGroup: ({ group }: { group: EventGroup }) => <p>{group.events[0].content}</p>,
}));
vi.mock("./tools/tool-call-item", () => ({ ToolCallItem: () => null }));
vi.mock("./tools/plan-display", () => ({ PlanDisplay: () => null }));
vi.mock("./editor-content", () => ({ EditorContent: () => null }));
vi.mock("./issue-tab-content", () => ({ IssueTabContent: () => null }));
vi.mock("./signal-tab-content", () => ({ SignalTabContent: () => null }));
vi.mock("./note-tab-content", () => ({ NoteTabContent: () => null }));
vi.mock("./turn-rail", () => ({ TurnRail: () => null }));
vi.mock("./realtime-voice-bar", () => ({ RealtimeVoiceBar: () => null }));
vi.mock("./ascii-loader", () => ({ AsciiLoader: () => <p>Working…</p> }));
vi.mock("./provider-auth-notice", () => ({ ProviderAuthNotice: () => null }));
vi.mock("./turn-changes-card", () => ({ TurnChangesCard: () => null }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showTurnChanges: false }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { showToolCalls: false } }),
  useGetProviderAccountInfoQuery: () => ({ data: { account: { id: "account" } } }),
  useGetProviderModelsQuery: () => ({ data: [] }),
}));
afterEach(cleanup);

const run: Run = { id: "run", workspaceId: "ws", status: "running", providerId: "codex", mode: "chat", goal: "Write code" };
const start: RunEvent = { id: "artifact-1", type: "log", content: "Compacting context…", timestamp: new Date(1000),
  metadata: { source: "context_compaction", itemId: "compact-1", phase: "start" } };
const complete: RunEvent = { ...start, id: "artifact-2", content: "Context compacted", timestamp: new Date(2000), metadata: { ...start.metadata, phase: "complete" } };
const props = { runs: [run], activeTab: run.id, currentEvents: [start], currentWorkspace: null,
  eventsEndRef: createRef<HTMLDivElement>() as RefObject<HTMLDivElement>, issueTabs: [], variant: "codex" as const };

it("shows progress even with tools hidden, then replaces it with one completed separator", () => {
  const view = render(<WorkspaceEvents {...props} />);
  expect(view.getByRole("status", { name: "Compacting context…" })).toBeTruthy();
  expect(view.queryByText("Working…")).toBeNull();
  expect(view.queryByRole("separator", { name: "Context compacted" })).toBeNull();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[start, complete]} />);
  expect(view.getAllByRole("separator", { name: "Context compacted" })).toHaveLength(1);
  expect(view.queryByText("Compacting context…")).toBeNull();
  expect(view.getByText("Working…")).toBeTruthy();
  view.rerender(<WorkspaceEvents {...props} runs={[{ ...run, status: "succeeded" }]} currentEvents={[start, complete]} />);
  expect(view.getAllByRole("separator", { name: "Context compacted" })).toHaveLength(1);
});

it("does not claim an interrupted compaction completed or show old progress in the next turn", () => {
  const view = render(<WorkspaceEvents {...props} />);
  view.rerender(<WorkspaceEvents {...props} runs={[{ ...run, status: "canceled" }]} />);
  expect(view.queryByText("Compacting context…")).toBeNull();
  expect(view.getByText("Context compaction interrupted")).toBeTruthy();
  expect(view.queryByRole("separator", { name: "Context compacted" })).toBeNull();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[start, {
    id: "prompt", type: "artifact", content: "Next request", timestamp: new Date(3000), metadata: { kind: "user-prompt" },
  }]} />);
  expect(view.queryByText("Compacting context…")).toBeNull();
  expect(view.getByText("Working…")).toBeTruthy();
});
