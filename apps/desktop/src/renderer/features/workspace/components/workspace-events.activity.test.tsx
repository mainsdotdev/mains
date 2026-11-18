// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Run, RunEvent } from "../types";
import { WorkspaceEvents } from "./workspace-events";

const settings = vi.hoisted(() => ({ showToolCalls: true, showTurnChanges: false }));
vi.mock("./tools/info-group", () => ({ InfoGroup: ({ group }: { group: { events: RunEvent[] } }) => group.events.map((event) => <p key={event.id}>{event.content}</p>) }));
vi.mock("./editor-content", () => ({ EditorContent: () => null }));
vi.mock("./issue-tab-content", () => ({ IssueTabContent: () => null }));
vi.mock("./signal-tab-content", () => ({ SignalTabContent: () => null }));
vi.mock("./note-tab-content", () => ({ NoteTabContent: () => null }));
vi.mock("./turn-rail", () => ({ TurnRail: () => null }));
vi.mock("./realtime-voice-bar", () => ({ RealtimeVoiceBar: () => null }));
vi.mock("./provider-auth-notice", () => ({ ProviderAuthNotice: () => null }));
vi.mock("./turn-changes-card", () => ({ TurnChangesCard: () => <div>Workspace edited files</div> }));
vi.mock("../hooks/use-plugin-logos", () => ({ usePluginLogoMap: () => new Map(), normalizeSlug: (name: string) => name, renderPluginIcon: () => null }));
vi.mock("../hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showTurnChanges: settings.showTurnChanges }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: settings }),
  useGetProviderAccountInfoQuery: () => ({ data: { account: { id: "account" } } }),
  useGetProviderModelsQuery: () => ({ data: [] }),
}));

beforeEach(() => { settings.showToolCalls = true; settings.showTurnChanges = false; });
afterEach(cleanup);
const run: Run = { id: "run", workspaceId: "ws", status: "running", providerId: "codex", mode: "developer", goal: "Refactor" };
const prompt: RunEvent = { id: "prompt", type: "artifact", content: "Refactor", timestamp: new Date(1000), metadata: { kind: "user-prompt" } };
const read: RunEvent = { id: "read", type: "tool_call", content: "Read:", timestamp: new Date(2000), metadata: { toolName: "Read", status: "done", input: { file_path: "hero.tsx" } } };
const command: RunEvent = { id: "command", type: "tool_call", content: "Bash:", timestamp: new Date(3000), metadata: { toolName: "Bash", status: "running", input: { command: "npm test" } } };
const props = { runs: [run], activeTab: run.id, currentEvents: [prompt, read, command], currentWorkspace: null,
  eventsEndRef: createRef<HTMLDivElement>() as RefObject<HTMLDivElement>, issueTabs: [], variant: "codex" as const };

it("shows the active command once in an open group and restores footer activity when closed", () => {
  const view = render(<WorkspaceEvents {...props} />);
  expect(view.getByText("npm test")).toBeTruthy();
  expect(view.queryByText("Running npm test")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /read a file, ran a command/i }));
  expect(view.queryByText("npm test")).toBeNull();
  expect(view.getByText("Running npm test")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /read a file, ran a command/i }));
  expect(view.queryByText("Running npm test")).toBeNull();
  expect(view.getByText("npm test")).toBeTruthy();
});

it("handles a single visible tool and the tools-hidden setting", () => {
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, command]} />);
  expect(view.getByText("npm test")).toBeTruthy();
  expect(view.queryByText("Running npm test")).toBeNull();
  settings.showToolCalls = false;
  view.rerender(<WorkspaceEvents {...props} currentEvents={[prompt, command]} />);
  expect(view.getByText("Running npm test")).toBeTruthy();
  expect(view.queryByText("npm test")).toBeNull();
});

it("shows assistant messages as a conversation without technical groups or activity labels", () => {
  const first: RunEvent = { id: "first", type: "artifact", content: "I will compare the options", timestamp: new Date(1500), metadata: { kind: "report", messagePhase: "commentary" } };
  const last: RunEvent = { ...first, id: "last", content: "Here is your travel plan", timestamp: new Date(4000), metadata: { kind: "report", messagePhase: "final_answer" } };
  const finished = { ...run, status: "succeeded" as const };
  const currentEvents = [prompt, first, read, command, last];
  const view = render(<WorkspaceEvents {...props} runs={[finished]} currentEvents={currentEvents} />);
  expect(view.queryAllByRole("button").length).toBeGreaterThan(0);
  view.rerender(<WorkspaceEvents {...props} appearance="assistant" runs={[finished]} currentEvents={currentEvents} />);
  expect(view.getByText("I will compare the options")).toBeTruthy();
  expect(view.getByText("Here is your travel plan")).toBeTruthy();
  expect(view.queryByText("npm test")).toBeNull();
  expect(view.queryByText(/tool calls?/i)).toBeNull();
  expect(view.queryByText(/read a file/i)).toBeNull();
  expect(view.queryByRole("button", { name: /messages?|tool calls?/i })).toBeNull();
  expect(view.getByRole("button", { name: "Copy response" })).toBeTruthy();
});

it("shows the active assistant's avatar and live activity until a reply streams or input is required", () => {
  const assistant = { id: "gezici", name: "Gezici", avatar: { shape: "kite", color: "lime" } } as const;
  const assistantProps = { ...props, appearance: "assistant" as const, assistant };
  const view = render(<WorkspaceEvents {...assistantProps} />);
  const status = view.getByRole("status", { name: "Gezici is responding" });
  const avatar = status.querySelector<HTMLElement>('[data-avatar-shape="kite"][data-animated="true"]');
  expect(avatar?.querySelectorAll("[data-eye]")).toHaveLength(2);
  const transcript = view.getByText(prompt.content).closest<HTMLElement>('[style*="--mate-question-color"]');
  expect(transcript?.style.getPropertyValue("--mate-question-color")).toBe(avatar?.style.getPropertyValue("--avatar-base"));
  const cells = [...status.querySelectorAll<HTMLElement>(":scope > span > .tool-square")];
  expect(cells).toHaveLength(3);
  const delays = cells.map(cell => Number(cell.style.getPropertyValue("--tsq-d1")));
  expect(delays[0]).toBeLessThan(delays[1]);
  expect(delays[1]).toBeLessThan(delays[2]);
  expect(view.queryByText(/npm test/)).toBeNull();
  const thought: RunEvent = { id: "thought", type: "artifact", content: "**Comparing travel options**", timestamp: new Date(3500), metadata: { kind: "thinking", streaming: true } };
  view.rerender(<WorkspaceEvents {...assistantProps} currentEvents={[prompt, command, thought]} />);
  expect(view.getByText("Comparing travel options").closest('[role="status"]')).toBe(status);
  expect(status.querySelector('[data-avatar-shape="kite"]')).toBe(avatar);
  expect(status.querySelector(":scope > span > .tool-square")).toBeNull();
  view.rerender(<WorkspaceEvents {...assistantProps} currentEvents={[prompt, command, thought]} hasPendingUserInput />);
  expect(view.queryByRole("status", { name: "Gezici is responding" })).toBeNull();
  const reply: RunEvent = { id: "reply", type: "artifact", content: "Here is the plan", timestamp: new Date(4000), metadata: { kind: "report", streaming: true } };
  view.rerender(<WorkspaceEvents {...assistantProps} currentEvents={[prompt, command, thought, reply]} />);
  expect(view.getByText("Here is the plan")).toBeTruthy();
  expect(view.queryByRole("status", { name: "Gezici is responding" })).toBeNull();
  expect(view.queryByText("Comparing travel options")).toBeNull();
});

it("keeps an in-flight row running when thought and progress snapshots arrive", () => {
  const thought: RunEvent = { id: "thought", type: "artifact", content: "Checking exports", timestamp: new Date(4000), metadata: { kind: "thinking", streaming: true } };
  const progress: RunEvent = { ...thought, id: "progress", content: "Compiling", metadata: { kind: "tool_progress", streaming: true } };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, read, command, thought, progress]} />);
  expect(view.getByRole("button", { name: /Running\s*npm test/ })).toBeTruthy();
  expect(view.queryByText("Running npm test")).toBeNull();
  expect(view.getByText("Checking exports")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: /read a file, ran a command/i }));
  expect(view.getByText("Checking exports")).toBeTruthy();
  expect(view.queryByText("Running npm test")).toBeNull();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[prompt, read, command]} />);
  expect(view.getByText("Running npm test")).toBeTruthy();
});

it.each(["artifact", "log"] as const)("retires an earlier %s thought when the reply arrives, while showing newer thoughts", (type) => {
  const earlier: RunEvent = { id: "earlier", type, content: type === "log" ? "[reasoning] Checking exports" : "Checking exports",
    timestamp: new Date(3000), metadata: { kind: "thinking", streaming: true } };
  const reply: RunEvent = { id: "reply", type: "artifact", content: "Here is the result", timestamp: new Date(4000), metadata: { kind: "report", streaming: true } };
  const thought: RunEvent = { ...reply, id: "thought", content: "Checking the final result", metadata: { kind: "thinking", streaming: true } };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, earlier]} />);
  expect(view.getByText("Checking exports")).toBeTruthy();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[prompt, earlier, reply]} />);
  expect(view.getByText("Here is the result")).toBeTruthy();
  expect(view.queryByText("Checking exports")).toBeNull();
  expect(view.queryByText("Thinking")).toBeNull();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[prompt, earlier, reply, thought]} />);
  expect(view.getByText("Checking the final result")).toBeTruthy();
  expect(view.getByText("Here is the result")).toBeTruthy();
});

it("keeps current activity when a hidden voice-work report arrives", () => {
  const thought: RunEvent = { id: "thought", type: "artifact", content: "Checking exports",
    timestamp: new Date(2000), metadata: { kind: "thinking", streaming: true } };
  const hidden: RunEvent = { id: "hidden", type: "artifact", content: "Written voice duplicate",
    timestamp: new Date(3000), metadata: { kind: "report", streaming: true, inputSource: "voice",
      realtimeSessionId: "call", providerTurnId: "native" } };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, thought, hidden]} />);
  expect(view.queryByText("Written voice duplicate")).toBeNull();
  expect(view.getByText("Checking exports")).toBeTruthy();
});

it("shows thinking summaries without rendering command progress as thought text", () => {
  const thought: RunEvent = { id: "thought", type: "artifact", content: "**Checking exports**", timestamp: new Date(4000), metadata: { kind: "thinking", streaming: true } };
  const progress: RunEvent = { ...thought, id: "progress", content: "Compiled successfully", metadata: { kind: "tool_progress", streaming: true } };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, thought, progress]} />);
  expect(view.getByText("Checking exports")).toBeTruthy();
  expect(view.queryByText("Compiled successfully")).toBeNull();
  expect(view.queryByText("Thinking")).toBeNull();
});

it.each(["[thinking] ", "[reasoning] "])("supports legacy %s logs without reusing the previous prompt's thoughts", (prefix) => {
  const thought: RunEvent = { id: "legacy", type: "log", content: `${prefix}Checking exports`, timestamp: new Date(4000) };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, thought]} />);
  expect(view.getByText("Checking exports")).toBeTruthy();
  view.rerender(<WorkspaceEvents {...props} currentEvents={[thought, prompt]} />);
  expect(view.queryByText("Checking exports")).toBeNull();
  expect(view.getByText("Thinking")).toBeTruthy();
});


it("omits workspace edit controls on assistant surfaces even for developer turns", () => {
  settings.showTurnChanges = true;
  const finished = { ...run, status: "succeeded" as const };
  const turn = { id: 1, runId: run.id, turnIndex: 0, promptContent: "Refactor", responseContent: "Done",
    startedAt: 1000, endedAt: 4000, elapsedMs: 3000, status: "completed" as const,
    model: null, createdAt: 1000, inputTokens: null, outputTokens: null, cacheReadTokens: null,
    cacheWriteTokens: null, costMicros: null, modelUsage: null, metadata: null,
    changes: { id: "change", files: [], additions: 22, deletions: 20, truncated: false, undoneAt: null } };
  const reply: RunEvent = { id: "reply", type: "artifact", content: "Done", timestamp: new Date(4000), metadata: { kind: "report", turnId: 1 } };
  const view = render(<WorkspaceEvents {...props} runs={[finished]} currentEvents={[prompt, reply]} turns={[turn]} />);
  expect(view.getByText("Workspace edited files")).toBeTruthy();
  view.rerender(<WorkspaceEvents {...props} runs={[finished]} currentEvents={[prompt, reply]} turns={[turn]} hideTurnChanges />);
  expect(view.queryByText("Workspace edited files")).toBeNull();
  expect(view.getByText("Done")).toBeTruthy();
});
