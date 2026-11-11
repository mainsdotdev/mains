// @vitest-environment jsdom
import { createRef, type RefObject } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Run, RunEvent } from "../types";
import { WorkspaceEvents } from "./workspace-events";

const settings = vi.hoisted(() => ({ showToolCalls: true }));
vi.mock("./tools/info-group", () => ({ InfoGroup: ({ group }: { group: { events: RunEvent[] } }) => group.events.map((event) => <p key={event.id}>{event.content}</p>) }));
vi.mock("./editor-content", () => ({ EditorContent: () => null }));
vi.mock("./issue-tab-content", () => ({ IssueTabContent: () => null }));
vi.mock("./signal-tab-content", () => ({ SignalTabContent: () => null }));
vi.mock("./note-tab-content", () => ({ NoteTabContent: () => null }));
vi.mock("./turn-rail", () => ({ TurnRail: () => null }));
vi.mock("./realtime-voice-bar", () => ({ RealtimeVoiceBar: () => null }));
vi.mock("./provider-auth-notice", () => ({ ProviderAuthNotice: () => null }));
vi.mock("./turn-changes-card", () => ({ TurnChangesCard: () => null }));
vi.mock("../hooks/use-plugin-logos", () => ({ usePluginLogoMap: () => new Map(), normalizeSlug: (name: string) => name, renderPluginIcon: () => null }));
vi.mock("../hooks/use-open-file-in-editor", () => ({ useOpenFileInEditor: () => vi.fn() }));
vi.mock("@/hooks/use-mode-config", () => ({ useModeConfig: () => ({ showTurnChanges: false }) }));
vi.mock("@/lib/redux/api", () => ({
  useGetAppSettingsQuery: () => ({ data: settings }),
  useGetProviderAccountInfoQuery: () => ({ data: { account: { id: "account" } } }),
  useGetProviderModelsQuery: () => ({ data: [] }),
}));

beforeEach(() => { settings.showToolCalls = true; });
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

it("keeps an in-flight row running when thought and progress snapshots arrive", () => {
  const thought: RunEvent = { id: "thought", type: "artifact", content: "Checking exports", timestamp: new Date(4000), metadata: { kind: "thinking", streaming: true } };
  const progress: RunEvent = { ...thought, id: "progress", content: "Compiling", metadata: { kind: "tool_progress", streaming: true } };
  const view = render(<WorkspaceEvents {...props} currentEvents={[prompt, command, thought, progress]} />);
  expect(view.getByRole("button", { name: /Running\s*npm test/ })).toBeTruthy();
  expect(view.queryByText("Running npm test")).toBeNull();
  expect(view.queryByText("Checking exports")).toBeNull();
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
