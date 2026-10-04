// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Run } from "../types";
import type { StreamingEvent } from "./use-streaming-events";
import type { RealtimeVoiceState } from "../lib/realtime-voice-controller";

const streaming = vi.hoisted(() => ({ events: [] as StreamingEvent[] }));
const runUpdates = vi.hoisted(() => new Set<(event: { runId: string }) => void>());
const voice = vi.hoisted(() => ({ state: {
  phase: "idle", runId: null, connectionId: null, startedAt: null,
} as Pick<RealtimeVoiceState, "phase" | "runId" | "connectionId" | "startedAt"> }));

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getByWorkspace: vi.fn(),
  getById: vi.fn(),
  getArtifacts: vi.fn(),
  getToolCalls: vi.fn(),
  getTurns: vi.fn(),
}));

vi.mock("@/lib/transport", () => ({
  appEvents: { runs: { onUpdated: (listener: (event: { runId: string }) => void) => {
    runUpdates.add(listener); return () => { runUpdates.delete(listener); };
  } } },
  appApi: {
    runs: {
      getByWorkspace: mocks.getByWorkspace,
      getById: mocks.getById,
      getToolCalls: mocks.getToolCalls,
    },
    runArtifacts: { getByRun: mocks.getArtifacts },
    runTurns: { getByRun: mocks.getTurns },
  },
}));
vi.mock("@/lib/redux/hooks", () => ({
  useAppDispatch: () => mocks.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ workspace: { pendingRunId: null } }),
}));
vi.mock("@/lib/redux/api", () => ({
  workspaceApi: { util: { invalidateTags: vi.fn() } },
  useArchiveRunMutation: () => [vi.fn()],
}));
vi.mock("@/components/ui", () => ({ toast: { error: vi.fn() } }));
vi.mock("./use-run-operations", () => ({
  useRunOperations: () => ({
    isLoading: false,
    error: null,
    executeRun: vi.fn(),
    continueRun: vi.fn(),
    forkRun: vi.fn(),
    executeReview: vi.fn(),
    checkCanResume: vi.fn(),
  }),
}));
vi.mock("./use-run-sync", () => ({
  useRunSync: () => ({ finalizeRun: vi.fn() }),
}));
vi.mock("./use-streaming-events", () => ({
  useStreamingEvents: () => ({ streamingEvents: streaming.events, clearTurnStreams: vi.fn() }),
}));
vi.mock("./use-realtime-voice", () => ({ useRealtimeVoice: () => ({ state: voice.state }) }));

import { useWorkspaceRuns } from "./use-workspace-runs";

const runA: Run = {
  id: "run-a",
  workspaceId: "ws-a",
  status: "succeeded",
  goal: "first conversation",
  providerId: "codex",
  mode: "developer",
};
const runB: Run = {
  id: "run-b",
  workspaceId: "ws-b",
  status: "succeeded",
  goal: "existing conversation",
  providerId: "codex",
  mode: "developer",
};
const prefetchWorkspaceIds = ["ws-a", "ws-b"];

beforeEach(() => {
  runUpdates.clear();
  streaming.events = [];
  voice.state = { phase: "idle", runId: null, connectionId: null, startedAt: null };
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getArtifacts.mockImplementation(async (runId: string) => ({
    success: true,
    data: [{
      id: 1,
      runId,
      kind: "user-prompt",
      content: runId === runB.id ? runB.goal : runA.goal,
      createdAt: new Date("2026-09-26T20:00:00Z"),
    }],
  }));
  mocks.getToolCalls.mockResolvedValue({ success: true, data: [] });
  mocks.getTurns.mockResolvedValue({ success: true, data: [] });
});

describe("working chats created from voice", () => {
  it("adds the new worker tab without a refresh or stealing the voice chat selection", async () => {
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [runA] });
    const worker = { ...runA, id: "voice-worker", status: "running", title: "Use case refactor" };
    mocks.getById.mockResolvedValue({ success: true, data: worker });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    await act(async () => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    await waitFor(() => expect(view.result.current.runs.map((run) => run.id)).toEqual([worker.id, runA.id]));
    expect(view.result.current.activeRunId).toBe(runA.id);
    await act(async () => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    expect(view.result.current.runs.filter((run) => run.id === worker.id)).toHaveLength(1);
    view.unmount(); expect(runUpdates.size).toBe(0);
  });

  it("ignores workers in another workspace, provider or mode", async () => {
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [runA] });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    for (const worker of [runB, { ...runA, id: "other-provider", providerId: "claude_code" }, { ...runA, id: "other-mode", mode: "chat" }]) {
      mocks.getById.mockResolvedValue({ success: true, data: worker });
      await act(async () => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    }
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runA.id]);
    view.unmount();
  });

  it("does not insert a delayed worker into a workspace opened after the notification", async () => {
    mocks.getByWorkspace.mockImplementation(async (workspaceId) => ({ success: true, data: workspaceId === "ws-a" ? [runA] : [runB] }));
    let resolveWorker!: (value: unknown) => void;
    mocks.getById.mockReturnValue(new Promise((resolve) => { resolveWorker = resolve; }));
    const view = renderHook(({ workspaceId }) => useWorkspaceRuns(workspaceId, "codex", "developer"), { initialProps: { workspaceId: "ws-a" } });
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    act(() => { for (const listener of runUpdates) listener({ runId: "voice-worker" }); });
    view.rerender({ workspaceId: "ws-b" });
    await waitFor(() => expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]));
    await act(async () => { resolveWorker({ success: true, data: { ...runA, id: "voice-worker" } }); });
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]);
    view.unmount();
  });

  it("retains a worker notification arriving while the initial tab list is loading", async () => {
    let resolveList!: (value: unknown) => void;
    mocks.getByWorkspace.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    const worker = { ...runA, id: "voice-worker", status: "running" };
    mocks.getById.mockResolvedValue({ success: true, data: worker });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    act(() => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    expect(mocks.getById).not.toHaveBeenCalled();
    await act(async () => { resolveList({ success: true, data: [runA] }); });
    await waitFor(() => expect(view.result.current.runs.map((run) => run.id)).toEqual([worker.id, runA.id]));
    expect(view.result.current.activeRunId).toBe(runA.id);
    view.unmount();
  });

  it("keeps the latest worker update when lookup responses arrive out of order", async () => {
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [runA] });
    let resolveOld!: (value: unknown) => void;
    mocks.getById.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const worker = { ...runA, id: "voice-worker", status: "running", title: "Updated task" };
    mocks.getById.mockResolvedValue({ success: true, data: worker });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    await act(async () => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    await act(async () => { for (const listener of runUpdates) listener({ runId: worker.id }); });
    await waitFor(() => expect(view.result.current.runs[0].title).toBe("Updated task"));
    await act(async () => { resolveOld({ success: true, data: { ...worker, title: "Original task" } }); });
    expect(view.result.current.runs[0].title).toBe("Updated task");
    view.unmount();
  });
});

describe("useWorkspaceRuns streaming transcript", () => {
  async function transcript(artifacts: unknown[], providerId = "copilot_cli") {
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [{ ...runA, providerId, status: "running" }] });
    mocks.getArtifacts.mockResolvedValue({ success: true, data: artifacts });
    const view = renderHook(() => useWorkspaceRuns("ws-a", providerId, "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    await waitFor(() => expect(view.result.current.isTranscriptLoading).toBe(false));
    return view;
  }

  function preview(content: string, kind = "report", correlated = true): StreamingEvent {
    const streamId = `copilot-${kind === "report" ? "msg" : "think"}-run-a-m`;
    return { id: `stream-${streamId}`, type: "artifact", kind, content, streamId,
      metadata: correlated ? { streamId } : undefined, timestamp: Date.now() };
  }

  function startVoice() {
    voice.state = { phase: "connected", runId: "run-a", connectionId: "connection", startedAt: 18_000 };
  }

  it("replaces a live preview by message identity when the final text differs", async () => {
    streaming.events = [preview("partial answer")];
    const view = await transcript([{ id: 2, kind: "report", content: "Corrected final answer",
      metadata: { streamId: streaming.events[0].streamId } }]);
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Corrected final answer"]);
  });

  it("keeps a new message visible when its text repeats an older message", async () => {
    streaming.events = [preview("Hello")];
    const view = await transcript([{ id: 2, kind: "report", content: "Hello",
      metadata: { streamId: "copilot-msg-run-a-older-message" } }]);
    expect(view.result.current.currentEvents).toHaveLength(2);
    expect(view.result.current.currentEvents[1].metadata).toMatchObject({ streaming: true });
  });

  it("routes a thinking snapshot to the thinking lane", async () => {
    streaming.events = [preview("Checking files", "thinking")];
    const view = await transcript([]);
    expect(view.result.current.currentEvents[0].metadata).toMatchObject({ kind: "thinking", streaming: true });
  });

  it("retains content-based reconciliation for providers without a persisted stream identity", async () => {
    streaming.events = [{ ...preview("Hello", "report", false), streamId: "claude-msg-run-a-0" }];
    const view = await transcript([{ id: 2, kind: "report", content: "Hello" }]);
    expect(view.result.current.currentEvents).toHaveLength(1);
    expect(view.result.current.currentEvents[0].metadata?.streaming).toBeUndefined();
  });

  it("updates live voice input in the user bubble and holds a completed reply until its artifact arrives", async () => {
    startVoice();
    streaming.events = [
      { ...preview("Spoken input", "user-prompt"), metadata: { voice: true, source: "user" } },
      { ...preview("Completed reply"), metadata: { voice: true, source: "agent_message", streaming: false, realtimeSessionId: "connection" } },
    ];
    const view = await transcript([]);
    expect(view.result.current.currentEvents[0].metadata).toMatchObject({ kind: "user-prompt", source: "user", streaming: true });
    expect(view.result.current.currentEvents[1].metadata).toMatchObject({ kind: "report", streaming: false });
  });

  it("keeps speech in its original position among persisted work events", async () => {
    startVoice();
    streaming.events = [{ ...preview("Live speech"), timestamp: 19_000,
      metadata: { voice: true, source: "agent_message", realtimeSessionId: "connection" } }];
    const view = await transcript([{ id: 2, kind: "report", content: "Earlier work result", createdAt: new Date(10_000) }]);
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Earlier work result", "Live speech"]);
  });

  const written = "Üç olası neden buldum: ekranın altındaki videolar açılışta yükleniyor, ana başlık JavaScript ve animasyonu bekliyor, telefonda gizli olan ses efekti de çalışıyor. Önce video yükünü ve başlığın gecikmesini doğrulayıp düzeltiyorum.";
  const spoken = " Üç olası neden buldum: alttaki videoların açılışta yüklenmesi, ana başlığın JavaScript ve animasyonu beklemesi, telefonda gizli ses efektinin de çalışması. Önce video yükünü ve başlık gecikmesini doğrulayıp düzeltiyorum.";
  const writtenArtifact = { id: 312, kind: "report", content: written, createdAt: new Date(20_000),
    metadata: { source: "agent_message", itemId: "agent-message", messagePhase: "commentary" } };
  const voiceMetadata = { source: "agent_message", voice: true, streamId: "voice-connection-speech", itemId: "speech",
    voiceStartedAt: 19_000, realtimeSessionId: "connection", providerTurnId: "native-turn" };

  it("preserves both speech and work when reopening history outside voice mode", async () => {
    const view = await transcript([writtenArtifact, { id: 313, kind: "report", content: spoken,
      createdAt: new Date(32_000), metadata: voiceMetadata }], "codex");
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual([spoken, written]);
  });

  it("updates live speech alongside work without changing visibility when voice ends", async () => {
    startVoice();
    streaming.events = [{ id: "stream-voice-connection-speech", type: "artifact", kind: "report", content: "Üç olası neden",
      streamId: voiceMetadata.streamId, timestamp: voiceMetadata.voiceStartedAt, metadata: { ...voiceMetadata, streaming: true } }];
    const view = await transcript([writtenArtifact], "codex");
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Üç olası neden", written]);
    streaming.events = [{ ...streaming.events[0], content: spoken }];
    view.rerender();
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual([spoken, written]);
    voice.state = { phase: "idle", runId: null, connectionId: null, startedAt: null };
    view.rerender();
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual([spoken, written]);
  });

  it.each(["ending", "stop_failed", "error"] as const)("preserves speech, user input and work on %s", async (phase) => {
    startVoice();
    const normal = "Henüz bitmedi; şu an inceliyorum. Alt bölümlerdeki üç videonun sayfa açılır açılmaz oynatıldığını gördüm. Bunları yalnızca ekrana geldiklerinde yükleyecek şekilde düzenleyeceğim.";
    const speech = " Henüz bitmedi; şu an inceliyorum Okan. Altta üç video direkt autoplay ile başlıyor, onları görünce yükleme şekline çekeceğim.";
    const artifacts = [
      { id: 380, kind: "user-prompt", content: "Ne ara hallettin", createdAt: new Date(18_000),
        metadata: { ...voiceMetadata, voiceStartedAt: 18_000, source: "user", streamId: "voice-connection-user" } },
      { ...writtenArtifact, id: 383, content: normal, metadata: { ...writtenArtifact.metadata, realtimeSessionId: "connection" } },
      { id: 384, kind: "report", content: speech, createdAt: new Date(30_000), metadata: voiceMetadata },
    ];
    const view = await transcript(artifacts, "codex");
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Ne ara hallettin", speech, normal]);
    voice.state = { ...voice.state, phase };
    view.rerender();
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Ne ara hallettin", speech, normal]);
  });

  it("keeps earlier voice calls in history even when voice moves to another conversation", async () => {
    startVoice();
    const view = await transcript([
      { ...writtenArtifact, id: 300, content: "Earlier answer", createdAt: new Date(10_000) },
      writtenArtifact,
      { id: 301, kind: "report", content: "Old voice call", createdAt: new Date(10_000),
        metadata: { ...voiceMetadata, voiceStartedAt: 11_000, realtimeSessionId: "old-connection", streamId: "voice-old-connection-speech" } },
      { id: 313, kind: "report", content: spoken, createdAt: new Date(32_000), metadata: voiceMetadata },
    ], "codex");
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Earlier answer", "Old voice call", spoken, written]);
    voice.state = { ...voice.state, runId: "run-b" };
    view.rerender();
    expect(view.result.current.currentEvents.map((event) => event.content)).toEqual(["Earlier answer", "Old voice call", spoken, written]);
  });
});

describe("useWorkspaceRuns workspace switches", () => {
  it("ignores a selected run fetch that finishes after leaving its workspace", async () => {
    const external = { ...runA, id: "external-run" };
    let resolveRun!: (value: { success: true; data: Run }) => void;
    mocks.getByWorkspace.mockImplementation(async (workspaceId: string) => ({
      success: true, data: workspaceId === "ws-a" ? [runA] : [runB],
    }));
    mocks.getById.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));
    const view = renderHook(
      ({ workspaceId }) => useWorkspaceRuns(workspaceId, "codex", "developer"),
      { initialProps: { workspaceId: "ws-a" } },
    );
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    act(() => view.result.current.selectTab(external.id));
    view.rerender({ workspaceId: "ws-b" });
    await waitFor(() => expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]));
    await act(async () => resolveRun({ success: true, data: external }));
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]);
  });

  it("adds an externally created run once when both tab selection paths request it", async () => {
    const external = { ...runA, id: "external-run" };
    mocks.getByWorkspace.mockResolvedValue({ success: true, data: [runA] });
    mocks.getById.mockResolvedValue({ success: true, data: external });
    const view = renderHook(() => useWorkspaceRuns("ws-a", "codex", "developer"));
    await waitFor(() => expect(view.result.current.runsLoaded).toBe(true));
    await act(async () => {
      view.result.current.selectTab(external.id);
      view.result.current.selectTab(external.id);
    });
    expect(view.result.current.runs.map((run) => run.id)).toEqual([external.id, runA.id]);
  });

  it("loads a preloaded workspace's selected run transcript", async () => {
    let resolvePrefetchB!: (value: { success: true; data: Run[] }) => void;
    let resolveReloadB!: (value: { success: true; data: Run[] }) => void;
    let bCalls = 0;
    mocks.getByWorkspace.mockImplementation((workspaceId: string) => {
      if (workspaceId === "ws-a") {
        return Promise.resolve({ success: true, data: [runA] });
      }
      bCalls += 1;
      return new Promise((resolve) => {
        if (bCalls === 1) resolvePrefetchB = resolve;
        else resolveReloadB = resolve;
      });
    });

    const view = renderHook(
      ({ workspaceId }) => useWorkspaceRuns(
        workspaceId,
        "codex",
        "developer",
        undefined,
        prefetchWorkspaceIds,
      ),
      { initialProps: { workspaceId: "ws-a" } },
    );
    await waitFor(() => expect(resolvePrefetchB).toBeDefined());
    await act(async () => {
      resolvePrefetchB({ success: true, data: [runB] });
    });

    view.rerender({ workspaceId: "ws-b" });
    expect(view.result.current.runs.map((run) => run.id)).toEqual([runB.id]);
    expect(view.result.current.activeRunId).toBe(runB.id);
    await waitFor(() => expect(resolveReloadB).toBeDefined());
    await act(async () => {
      resolveReloadB({ success: true, data: [runB] });
    });

    await waitFor(() => {
      expect(view.result.current.runsLoaded).toBe(true);
      expect(view.result.current.isTranscriptLoading).toBe(false);
      expect(view.result.current.currentEvents[0]?.content).toBe(runB.goal);
    });
  });
});
