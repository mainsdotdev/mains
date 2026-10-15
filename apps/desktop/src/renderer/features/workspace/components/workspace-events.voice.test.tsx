// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunTurn } from "@/lib/redux/api";
import type { Run, RunEvent } from "../types";
import type { EventGroup } from "../lib/group-events";
import type { TranscriptHistory } from "../hooks/use-run-history";
import { WorkspaceEvents } from "./workspace-events";

vi.mock("./tools/tool-call-group", async () => {
  const pure = await import("../lib/group-events");
  return {
    ...pure,
    InfoGroup: ({ group }: { group: EventGroup }) => group.events.map((event) => <p key={event.id}>{event.content}</p>),
    ToolCallGroup: ({ group }: { group: EventGroup }) => <p>{group.events[0].content}</p>,
  };
});
vi.mock("./tools/tool-call-item", () => ({ ToolCallItem: () => null }));
vi.mock("./tools/plan-display", () => ({ PlanDisplay: () => null }));
vi.mock("./editor-content", () => ({ EditorContent: () => null }));
vi.mock("./issue-tab-content", () => ({ IssueTabContent: () => null }));
vi.mock("./signal-tab-content", () => ({ SignalTabContent: () => null }));
vi.mock("./note-tab-content", () => ({ NoteTabContent: () => null }));
vi.mock("./turn-rail", () => ({ TurnRail: () => null }));
vi.mock("./realtime-voice-bar", () => ({ RealtimeVoiceBar: () => null }));
vi.mock("./ascii-loader", () => ({ AsciiLoader: ({ activeTool }: { activeTool?: RunEvent }) => <p>{activeTool ? "Tool activity" : "Working…"}</p> }));
vi.mock("./provider-auth-notice", () => ({ ProviderAuthNotice: () => null }));
vi.mock("./turn-changes-card", () => ({ TurnChangesCard: () => null }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showTurnChanges: false }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { showToolCalls: true } }),
  useGetProviderAccountInfoQuery: () => ({ data: { account: { id: "account" } } }),
  useGetProviderModelsQuery: () => ({ data: [] }),
}));

afterEach(cleanup);

it.each(["editor", "new-run"])("shows the submitted prompt before a run exists on %s", (activeTab) => {
  const view = render(<WorkspaceEvents runs={[]} activeTab={activeTab} isSubmitting
    currentEvents={[{ id: "pending-prompt:local", content: "Show my prompt now", type: "artifact", timestamp: new Date(), metadata: { kind: "user-prompt" } }]}
    currentWorkspace={null} issueTabs={[]} eventsEndRef={createRef<HTMLDivElement>() as RefObject<HTMLDivElement>} />);
  expect(view.getByText("Show my prompt now")).toBeTruthy();
  expect(view.getByText("Working…")).toBeTruthy();
});

const scope = { inputSource: "voice", realtimeSessionId: "call", providerTurnId: "native" };
const turn: RunTurn = {
  id: 1, runId: "run", turnIndex: 0, metadata: scope, status: "active", startedAt: 10_000, endedAt: null,
  promptContent: null, responseContent: null, elapsedMs: null, createdAt: 10_000,
  inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
  costMicros: null, model: null, modelUsage: null,
};
const run: Run = { id: "run", workspaceId: "ws", status: "running", providerId: "codex", mode: "chat", goal: "Voice chat" };
function event(id: string, time: number, metadata: Record<string, unknown> = {}): RunEvent {
  return { id, content: id, type: "artifact", timestamp: new Date(time), metadata: { kind: "report", ...metadata } };
}

it("offers Jump to latest while a live transcript is paused without hiding the reply", () => {
  const history: TranscriptHistory = {
    following: false, historical: false, hasOlder: false, hasNewer: false, loading: false, error: null,
    latestRevision: 1, loadOlder: vi.fn(async () => {}), loadNewer: vi.fn(async () => {}),
    loadLatest: vi.fn(async () => {}), retry: vi.fn(async () => {}), setFollowing: vi.fn(),
  };
  const view = render(<WorkspaceEvents runs={[run]} activeTab={run.id} history={history}
    currentEvents={[event("Live reply", 43_000, { streaming: true })]} currentWorkspace={null}
    eventsEndRef={createRef<HTMLDivElement>() as RefObject<HTMLDivElement>} issueTabs={[]} variant="codex" />);
  expect(view.getByText("Live reply")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Jump to latest" }));
  expect(history.loadLatest).toHaveBeenCalledOnce();
});

it("hides thinking during a visible assistant stream while retaining waiting and tool activity", () => {
  const waiting = [event("Old reply", 1_000), event("New request", 40_000, { kind: "user-prompt" }),
    event("Reasoning", 41_000, { kind: "thinking", streaming: true }),
    event("Child reply", 42_000, { isFromSubagent: true, streaming: true })];
  const props = { runs: [run], activeTab: run.id, currentEvents: waiting, currentWorkspace: null,
    eventsEndRef: createRef<HTMLDivElement>() as RefObject<HTMLDivElement>, issueTabs: [], variant: "codex" as const };
  const view = render(<WorkspaceEvents {...props} />);
  expect(view.getByText("Working…")).toBeTruthy();
  const stream = event("The answer is arriving", 43_000, { streaming: true });
  view.rerender(<WorkspaceEvents {...props} currentEvents={[...waiting, stream]} />);
  expect(view.getByText("The answer is arriving")).toBeTruthy();
  expect(view.queryByText("Working…")).toBeNull();
  const tool: RunEvent = { ...event("Read: package.json", 44_000, { status: "running", toolName: "Read" }), type: "tool_call" };
  view.rerender(<WorkspaceEvents {...props} currentEvents={[...waiting, stream, tool]} />);
  expect(view.getByText("Tool activity")).toBeTruthy();
  view.rerender(<WorkspaceEvents {...props} runs={[{ ...run, status: "succeeded" }]}
    currentEvents={[...waiting, { ...stream, metadata: { ...stream.metadata, streaming: false } }]} />);
  expect(view.queryByText("Working…")).toBeNull();
  expect(view.queryByText("Tool activity")).toBeNull();
});

it("renders the voice conversation and tools without a work block, then shows the next typed answer", () => {
  const events = [event("Spoken request", 9_000, { voice: true, kind: "user-prompt" }),
    event("Written voice duplicate", 11_000, scope), event("Spoken answer", 12_000, { voice: true }),
    { ...event("Read: package.json", 13_000, { ...scope, status: "done" }), type: "tool_call" as const }];
  const props = { runs: [run], activeTab: run.id, currentEvents: events, currentWorkspace: null,
    eventsEndRef: createRef<HTMLDivElement>() as RefObject<HTMLDivElement>, issueTabs: [], turns: [turn], variant: "codex" as const };
  const view = render(<WorkspaceEvents {...props} />);
  expect(view.getByText("Spoken answer")).toBeTruthy();
  expect(view.getByText("Read: package.json")).toBeTruthy();
  expect(view.queryByText("Agent work")).toBeNull();
  expect(view.queryByText("Written voice duplicate")).toBeNull();

  const ended = { ...turn, status: "completed", endedAt: 30_000 } as RunTurn;
  const typed = { ...turn, id: 2, turnIndex: 1, startedAt: 40_000, metadata: { providerTurnId: "typed" } };
  view.rerender(<WorkspaceEvents {...props} turns={[ended, typed]} currentEvents={[
    ...events, event("Typed request", 40_000, { kind: "user-prompt" }),
    event("Written reply after voice", 42_000, { source: "agent_message", providerTurnId: "typed" }),
  ]} />);
  expect(view.getByText("Spoken answer")).toBeTruthy();
  expect(view.getByText("Written reply after voice")).toBeTruthy();
  expect(view.queryByText("Written voice duplicate")).toBeNull();
  expect(view.queryByText("Agent work")).toBeNull();
});
