// @vitest-environment jsdom
import type { ReactNode } from "react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, AssistantWelcome } from "@mains/contracts/assistants";
import type { Workspace } from "@/lib/redux/api";
import { Textarea } from "@/components/ui";
import assistantsReducer, { assistantConversationOwner } from "@/lib/redux/slices/assistantsSlice";
import workspaceReducer from "@/lib/redux/slices/workspaceSlice";
import appSettingsReducer from "@/lib/redux/slices/appSettingsSlice";
import { AssistantChat } from "./assistant-chat";
import { AVATAR_COLORS } from "./assistant-avatar";
import type { AssistantAvatarState } from "../lib/assistant-avatar-activity";
import type { StreamingEvent } from "@/features/workspace/hooks/use-streaming-events";
import { voiceChatPresence } from "@/features/workspace/lib/voice-chat-presence";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), respond: vi.fn(), refetch: vi.fn(), load: vi.fn(),
  registerAppConversation: vi.fn(), attachAppRun: vi.fn(), appContext: vi.fn(),
  run: undefined as Record<string, unknown> | undefined,
  workspace: undefined as Workspace | undefined,
  context: { items: [] }, history: { historical: false }, events: [] as StreamingEvent[],
  approval: false, question: false,
  transport: { subscribe: () => () => {}, onStatusChange: () => () => {} },
}));
vi.mock("@/lib/redux/api", () => ({
  useGetRunByIdQuery: () => ({ currentData: mocks.run, refetch: mocks.refetch }),
  useGetWorkspaceQuery: () => ({ currentData: mocks.workspace }),
  useAbortRunMutation: () => [vi.fn()],
}));
vi.mock("@/lib/redux/api/assistantsApi", () => ({
  useSendAssistantMessageMutation: () => [mocks.send, { isLoading: false }],
  useRespondAssistantWelcomeMutation: () => [mocks.respond, { isLoading: false }],
  usePrepareAssistantWelcomeMutation: () => [vi.fn(), { isLoading: false }],
}));
vi.mock("@/lib/transport", () => ({ getTransport: () => mocks.transport, onTransportChange: () => () => {} }));
vi.mock("@/hooks/use-mcp-app-panel", () => ({ useMcpAppPanel: () => ({
  registerConversation: mocks.registerAppConversation, attachRun: mocks.attachAppRun, appContext: mocks.appContext,
}) }));
vi.mock("@/features/workspace/hooks/use-run-history", () => ({ useRunHistory: () => ({ runEvents: {}, runTurns: {}, load: mocks.load, history: mocks.history }) }));
vi.mock("@/features/workspace/hooks/use-streaming-events", () => ({ useStreamingEvents: () => ({ streamingEvents: mocks.events, clearTurnStreams: vi.fn() }) }));
vi.mock("@/features/workspace/hooks/use-tool-approval", () => ({ useToolApproval: () => ({
  pendingApprovals: mocks.approval ? [{ runId: "existing" }] : [], respond: vi.fn(),
}) }));
vi.mock("@/features/workspace/hooks/use-composer-context", () => ({ useComposerContext: () => mocks.context }));
vi.mock("@/features/workspace/hooks/use-transient-uploads", () => ({ useTransientUploads: () => [[], vi.fn()] }));
vi.mock("@/features/workspace/hooks/use-plugin-logos", () => ({ PluginLogoProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/workspace/components/tools/async-question-dialog", () => ({
  AsyncQuestionDialogProvider: ({ children }: { children: ReactNode }) => children,
  ComposerSlot: ({ children }: { children: ReactNode }) => children,
  useAsyncQuestionDialog: () => mocks.question ? { dialog: {} } : null,
}));
vi.mock("@/features/workspace/components/workspace-events", () => ({ WorkspaceEvents: () => <div>Existing transcript</div> }));
vi.mock("@/features/workspace/components/workspace-input", () => ({ WorkspaceInput: ({ goal, onGoalChange, onSubmit, disabled, sendDisabled, allowVoice, workspacePath, mode }: {
  goal: string; onGoalChange(text: string): void; onSubmit(): void; disabled: boolean; sendDisabled: boolean; allowVoice: boolean; workspacePath?: string; mode: string;
}) => <div data-testid="mate-composer" data-allow-voice={allowVoice}>
  <Textarea aria-label="Message" value={goal} onChange={event => onGoalChange(event.target.value)} disabled={disabled} />
  <button disabled={disabled || sendDisabled} onClick={onSubmit}>Send</button>
  <output data-testid="composer-workspace">{workspacePath ?? ""}</output><output data-testid="composer-mode">{mode}</output>
</div> }));
vi.mock("./assistant-welcome-card", () => ({ AssistantWelcomeCard: ({ onAnswer }: { onAnswer(answer: string | null): Promise<void> }) => <div><button onClick={() => void onAnswer("Review the project")}>Start welcome</button><button onClick={() => void onAnswer(null)}>Skip welcome</button></div> }));

const assistant = { id: "assistant", accountId: "account", name: "Release", providerId: "codex", model: "model", effort: "high", conversationSettings: { config: {} }, avatar: { shape: "sphere", color: "blue" } } as Assistant;
const ownerKey = assistantConversationOwner("local", "account", assistant.id);
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
beforeEach(() => {
  mocks.send.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ runId: "new-run" }) });
  mocks.respond.mockReset().mockReturnValue({ unwrap: () => Promise.resolve({ runId: "welcome-run" }) });
  mocks.registerAppConversation.mockReset().mockReturnValue(() => {});
  mocks.attachAppRun.mockReset(); mocks.appContext.mockReset().mockReturnValue([]);
  mocks.run = undefined; mocks.workspace = undefined;
  mocks.events = []; mocks.approval = false; mocks.question = false;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView; else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView"); });

function setup(options: { selectedRunId?: string; welcome?: AssistantWelcome; seedWorkspaceId?: string; archived?: boolean; onAvatarState?: (state: AssistantAvatarState | undefined) => void } = {}) {
  const legacyState = { ...assistantsReducer(undefined, { type: "init" }), draftExecutionByOwner: options.seedWorkspaceId ? { [ownerKey]: { mode: "developer", workspaceId: options.seedWorkspaceId } } : {} };
  const store = configureStore({ reducer: { assistants: assistantsReducer, workspace: workspaceReducer, appSettings: appSettingsReducer, backends: () => ({ activeBackendId: "local" }) }, preloadedState: { assistants: legacyState } });
  const selected = vi.fn();
  const tree = () => <Provider store={store}><AssistantChat assistant={{ ...assistant, isArchived: options.archived === true }} selectedRunId={options.selectedRunId ?? null} welcome={options.welcome} onSelectRun={selected} onOpenDetails={vi.fn()} onAvatarState={options.onAvatarState} /></Provider>;
  const view = render(tree());
  return { store, selected, ...view, update: () => view.rerender(tree()) };
}

it("shows an archived Mate's history without a composer or an app send handler", () => {
  mocks.run = { id: "existing", assistantId: assistant.id, status: "succeeded", mode: "work", createdAt: new Date() };
  setup({ selectedRunId: "existing", archived: true });
  expect(screen.getByText("Existing transcript")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
  expect(mocks.registerAppConversation).not.toHaveBeenCalled();
});

describe("Mate voice eligibility", () => {
  const run = { id: "existing", assistantId: assistant.id, providerId: "codex", status: "succeeded", mode: "work", createdAt: new Date() };

  it("enables voice and registers the transcript for an existing Codex Mate chat", () => {
    mocks.run = run;
    const view = setup({ selectedRunId: run.id });
    expect(screen.getByTestId("mate-composer").dataset.allowVoice).toBe("true");
    expect(voiceChatPresence.getSnapshot().has(run.id)).toBe(true);
    view.unmount();
    expect(voiceChatPresence.getSnapshot().has(run.id)).toBe(false);
  });

  it.each([
    ["another provider", { providerId: "claude_code" }],
    ["a Bridge replica", { isReplica: true }],
    ["an archived chat", { isArchived: true }],
    ["a different Mate's chat", { assistantId: "other-mate" }],
  ])("keeps the microphone unavailable for %s", (_label, overrides) => {
    mocks.run = { ...run, ...overrides };
    setup({ selectedRunId: run.id });
    expect(screen.getByTestId("mate-composer").dataset.allowVoice).toBe("false");
    expect(voiceChatPresence.getSnapshot().has(run.id)).toBe(false);
  });

  it("requires a saved chat before starting Mate voice", () => {
    setup();
    expect(screen.getByTestId("mate-composer").dataset.allowVoice).toBe("false");
  });
});

describe("assistant avatar activity", () => {
  const run = { id: "existing", assistantId: assistant.id, mode: "work", createdAt: new Date() };

  it("distinguishes thinking, streaming, approvals and questions before a live completion", () => {
    const onAvatarState = vi.fn();
    mocks.run = { ...run, status: "queued" };
    const view = setup({ selectedRunId: "existing", onAvatarState });
    expect(onAvatarState).toHaveBeenLastCalledWith("queued");
    mocks.run = { ...run, status: "running" };
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("thinking");
    mocks.events = [{ id: "stream-reply", type: "artifact", kind: "report", streamId: "reply", content: "I found the result.", timestamp: Date.now() }];
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("replying");
    mocks.approval = true;
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("waiting");
    mocks.approval = false;
    mocks.question = true;
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("waiting");
    mocks.question = false;
    mocks.run = { ...run, status: "succeeded" };
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("done");
  });

  it("shows older completions as idle and treats cancellation as idle", () => {
    const onAvatarState = vi.fn();
    mocks.run = { ...run, status: "succeeded" };
    const view = setup({ selectedRunId: "existing", onAvatarState });
    expect(onAvatarState).toHaveBeenLastCalledWith("idle");
    mocks.run = { ...run, status: "running" };
    view.update();
    mocks.run = { ...run, status: "canceled" };
    view.update();
    expect(onAvatarState).toHaveBeenLastCalledWith("idle");
  });
});
describe("assistant task location", () => {
  it("binds an app to the assistant's conversation and sends its messages through the assistant API", async () => {
    mocks.run = { id: "existing", assistantId: assistant.id, spaceId: "frozen-space", providerId: "codex", mode: "work",
      workspaceId: null, status: "succeeded", createdAt: new Date(), goal: "Find flights" };
    mocks.send.mockReturnValue({ unwrap: () => Promise.resolve({ runId: "existing" }) });
    mocks.appContext.mockReturnValue([{ kind: "mcp-app", id: "flights:app", sessionId: "flights", appName: "Skyscanner",
      updateId: "app", label: "Skyscanner", hidden: true, block: { type: "text", text: "Active app: Skyscanner" } }]);
    const { selected } = setup({ selectedRunId: "existing" });
    const chat = screen.getByText("Existing transcript").closest<HTMLElement>('[style*="--mate-color"]');
    expect(chat?.style.getPropertyValue("--mate-color")).toBe(AVATAR_COLORS[assistant.avatar.color].fill);
    const host = mocks.registerAppConversation.mock.lastCall![0];
    expect(host).toMatchObject({ runId: "existing", scope: { assistantId: assistant.id, spaceId: "frozen-space", mode: "work", workspaceId: undefined } });
    let result;
    await act(async () => { result = await host.send("Show cheaper flights"); });
    expect(result).toBe("existing");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ assistantId: assistant.id, runId: "existing", message: "Show cheaper flights" }));
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("execution");
    expect(JSON.stringify(mocks.send.mock.calls[0][0].context)).toContain("Active app: Skyscanner");
    expect(selected).toHaveBeenCalledWith("existing");
  });

  it("keeps an app-requested new chat under the same assistant and starts it in Work", async () => {
    mocks.run = { id: "existing", assistantId: assistant.id, mode: "developer", workspaceId: "repo", status: "succeeded", createdAt: new Date(), goal: "Check" };
    setup({ selectedRunId: "existing" });
    const host = mocks.registerAppConversation.mock.lastCall![0];
    await act(async () => { await host.send("Compare flights", { target: "new" }); });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ assistantId: assistant.id, message: "Compare flights", execution: { mode: "work" } }));
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("runId");
    expect(mocks.attachAppRun).toHaveBeenCalledWith(host.ownerKey, "new-run", expect.objectContaining({ assistantId: assistant.id, mode: "work", workspaceId: undefined }));
  });

  it.each([undefined, "repo", "deleted-repo"])("starts standalone chats in Work while ignoring legacy repo preferences: %s", async seedWorkspaceId => {
    const user = userEvent.setup(); setup({ seedWorkspaceId });
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
    expect(screen.getByTestId("composer-workspace").textContent).toBe("");
    expect(screen.getByTestId("composer-mode").textContent).toBe("work");
    await user.type(screen.getByLabelText("Message"), "Plan a trip");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ message: "Plan a trip", execution: { mode: "work" } })));
  });
  it("keeps Work execution and request identity while checking a lost delivery", async () => {
    mocks.send.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error("Lost response")) });
    const user = userEvent.setup(); setup({ seedWorkspaceId: "repo" });
    await user.type(screen.getByLabelText("Message"), "Review the repo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Lost response");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Check delivery" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
    expect(mocks.send.mock.calls[1][0]).toEqual(mocks.send.mock.calls[0][0]);
    expect(mocks.send.mock.calls[1][0].execution).toEqual({ mode: "work" });
  });
  it("starts the welcome's first task in Work", async () => {
    const user = userEvent.setup();
    setup({ selectedRunId: "welcome-run", seedWorkspaceId: "repo", welcome: { assistantId: assistant.id, runId: "welcome-run", state: "ready", answer: null } as AssistantWelcome });
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start welcome" }));
    await waitFor(() => expect(mocks.respond).toHaveBeenCalledWith({ accountId: "account", id: assistant.id, answer: "Review the project", execution: { mode: "work" } }));
  });
  it("starts a typed first task in Work after skipping the welcome", async () => {
    const user = userEvent.setup();
    setup({ selectedRunId: "welcome-run", welcome: { assistantId: assistant.id, runId: "welcome-run", state: "skipped", answer: null } as AssistantWelcome });
    await user.type(screen.getByLabelText("Message"), "Review the repo");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ requestId: `welcome-${assistant.id}`, runId: "welcome-run", execution: { mode: "work" } })));
  });
  it("retains an already accepted Developer welcome target when checking its delivery", async () => {
    const user = userEvent.setup();
    setup({ selectedRunId: "welcome-run", welcome: { assistantId: assistant.id, runId: "welcome-run", state: "failed", answer: "Review the project", execution: { mode: "developer", workspaceId: "repo" } } as AssistantWelcome });
    await user.click(screen.getByRole("button", { name: "Start welcome" }));
    await waitFor(() => expect(mocks.respond).toHaveBeenCalledWith(expect.objectContaining({ execution: { mode: "developer", workspaceId: "repo" } })));
  });
  it("keeps an existing chat's repo fixed when continuing the conversation", async () => {
    mocks.run = { id: "existing", assistantId: assistant.id, mode: "developer", workspaceId: "repo", status: "succeeded", createdAt: new Date(), goal: "Review" };
    mocks.workspace = { id: "repo", accountId: "account", projectId: "project", name: "main", rootPath: "/repos/mains", isArchived: false } as Workspace;
    const user = userEvent.setup(); setup({ selectedRunId: "existing", seedWorkspaceId: "different-repo" });
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
    expect(screen.getByText("Existing transcript")).toBeTruthy();
    expect(screen.getByTestId("composer-mode").textContent).toBe("developer");
    expect(screen.getByTestId("composer-workspace").textContent).toBe("/repos/mains");
    await user.type(screen.getByLabelText("Message"), "Continue");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ runId: "existing", message: "Continue" })));
    expect(mocks.send.mock.calls[0][0]).not.toHaveProperty("execution");
  });
  it("keeps an existing Work chat unbound when another repo is selected in its draft", () => {
    mocks.run = { id: "existing-work", assistantId: assistant.id, mode: "work", workspaceId: null, status: "succeeded", createdAt: new Date(), goal: "Plan" };
    setup({ selectedRunId: "existing-work", seedWorkspaceId: "repo" });
    expect(screen.getByTestId("composer-workspace").textContent).toBe("");
    expect(screen.getByTestId("composer-mode").textContent).toBe("work");
    expect(screen.queryByRole("button", { name: "Repo / workspace" })).toBeNull();
  });
});
