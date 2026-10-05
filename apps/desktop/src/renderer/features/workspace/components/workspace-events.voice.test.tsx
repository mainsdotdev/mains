// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RunTurn } from "@/lib/redux/api";
import type { Run, RunEvent } from "../types";
import type { EventGroup } from "../lib/group-events";
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
vi.mock("./ascii-loader", () => ({ AsciiLoader: () => <p>Working…</p> }));
vi.mock("./provider-auth-notice", () => ({ ProviderAuthNotice: () => null }));
vi.mock("./turn-changes-card", () => ({ TurnChangesCard: () => null }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showTurnChanges: false }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: { showToolCalls: true } }),
  useGetProviderAccountInfoQuery: () => ({ data: { account: { id: "account" } } }),
  useGetProviderModelsQuery: () => ({ data: [] }),
}));

afterEach(cleanup);

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
