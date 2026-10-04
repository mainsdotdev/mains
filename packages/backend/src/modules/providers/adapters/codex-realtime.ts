import type { RunRealtimeEvent, RunRealtimeUpdate } from "@mains/contracts/realtime";
import type { RealtimeWorkHandlers, WorkRunRealtimeRequest } from "../../../../shared/adapter.types";
import type { CodexAppServer } from "./codex-app-server.client";
import type { CodexRunCoordinator } from "./codex-run-coordinator";
import type { CodexSessionAcquisition } from "./codex-session-acquisition";
import type { ThreadRealtimeItem } from "./codex-app-server-protocol/generated/v2/ThreadRealtimeItem";
import type { RealtimeVoice } from "./codex-app-server-protocol/generated/RealtimeVoice";

interface VoiceSession {
  runId: string;
  connectionId: string;
  threadId?: string;
  server?: CodexAppServer;
  release?: () => void;
  dispose?: () => Promise<void>;
  publish: (event: RunRealtimeEvent) => void;
  items: Map<string, { role: "user" | "assistant"; text: string }>;
  legacyIds: Map<string, string>;
  sequence: number;
  latestUserText: string;
  canonicalTimeline: boolean;
  startRequest?: Promise<unknown>;
  startup?: Promise<void>;
  cancelRequested?: boolean;
  stopping?: Promise<void>;
  finishing?: Promise<void>;
}

/** One native call per driver; its lifetime is independent of work turns. */
export function createCodexRealtime(options: {
  sessions: CodexSessionAcquisition;
  runs: CodexRunCoordinator;
  getTimeout?: () => number;
  getVoice?: () => string | undefined;
}) {
  let active: VoiceSession | undefined;
  let startup = Promise.resolve();
  let cleanup = Promise.resolve();

  function publish(session: VoiceSession, event: RunRealtimeUpdate) {
    session.publish({ ...event, runId: session.runId, connectionId: session.connectionId });
  }

  function finish(session: VoiceSession, reason: string | null) {
    if (session.finishing) return session.finishing;
    if (active !== session) return Promise.resolve();
    active = undefined;
    session.release?.();
    cleanup = Promise.all([
      session.server ? options.runs.cleanupRun(session.server, session.runId) : Promise.resolve(),
      session.dispose?.(),
    ]).then(() => {}).catch(() => {});
    // A new ordinary continuation must see closed only after the old thread's
    // subscription cleanup is complete, not while unsubscribe is in flight.
    return session.finishing = cleanup.then(() => publish(session, { type: "closed", reason }));
  }

  function transcript(session: VoiceSession, itemId: string, role: "user" | "assistant", text: string, final: boolean) {
    if (role === "user") session.latestUserText = text;
    publish(session, { type: "transcript", itemId, role, text, final });
  }

  function handleNotification(method: string, params: unknown) {
    const session = active;
    if (!session) return;
    const p = params as Record<string, unknown> | undefined;
    if (!p || !session.threadId || p.threadId !== session.threadId) return;
    switch (method) {
      case "thread/realtime/started":
        publish(session, { type: "started", sessionId: typeof p.realtimeSessionId === "string" ? p.realtimeSessionId : null });
        break;
      case "thread/realtime/sdp":
        if (typeof p.sdp === "string") publish(session, { type: "sdp", sdp: p.sdp });
        break;
      case "thread/realtime/item/started":
      case "thread/realtime/item/completed": {
        const item = p.item as ThreadRealtimeItem | undefined;
        if (item?.type !== "transcriptSegment") break;
        session.canonicalTimeline = true;
        session.items.set(item.id, { role: item.role, text: item.text });
        transcript(session, item.id, item.role, item.text, method.endsWith("completed"));
        break;
      }
      case "thread/realtime/item/transcript/delta": {
        const item = typeof p.itemId === "string" ? session.items.get(p.itemId) : undefined;
        if (!item || typeof p.delta !== "string") break;
        item.text += p.delta;
        transcript(session, String(p.itemId), item.role, item.text, false);
        break;
      }
      case "thread/realtime/transcript/delta":
      case "thread/realtime/transcript/done": {
        if (session.canonicalTimeline) break;
        if (p.role !== "user" && p.role !== "assistant") break;
        const final = method.endsWith("done");
        const id = session.legacyIds.get(p.role) ?? `voice-${session.connectionId}-${++session.sequence}`;
        session.legacyIds.set(p.role, id);
        const item = session.items.get(id) ?? { role: p.role, text: "" };
        item.text = final && typeof p.text === "string" ? p.text : item.text + (typeof p.delta === "string" ? p.delta : "");
        session.items.set(id, item);
        transcript(session, id, p.role, item.text, final);
        if (final) session.legacyIds.delete(p.role);
        break;
      }
      case "thread/realtime/itemAdded": {
        const item = p.item as { input_transcript?: unknown } | undefined;
        if (typeof item?.input_transcript === "string") session.latestUserText = item.input_transcript;
        break;
      }
      case "thread/realtime/error":
        publish(session, { type: "error", message: typeof p.message === "string" ? p.message : "Voice chat failed." });
        // Tear down signaling even if the server never follows with closed.
        void stop(session.runId, session.connectionId).catch(() => {});
        break;
      case "thread/realtime/closed":
      case "thread/archived":
      case "thread/deleted":
        void finish(session, typeof p.reason === "string" ? p.reason : null);
        break;
    }
    // Voice history is bounded in memory; completed transcripts are persisted
    // by the runs service, while partials live only in the current call.
    if (session.items.size > 256) session.items.delete(session.items.keys().next().value!);
  }

  async function start(request: WorkRunRealtimeRequest, onEvent: (event: RunRealtimeEvent) => void, work: RealtimeWorkHandlers) {
    if (active) throw new Error("End the current voice chat before starting another one.");
    const session: VoiceSession = {
      runId: request.runId, connectionId: request.connectionId, publish: onEvent,
      items: new Map(), legacyIds: new Map(), sequence: 0, latestUserText: "", canonicalTimeline: false,
    };
    active = session;
    const previousStartup = startup;
    let finishStartup!: () => void;
    startup = new Promise<void>((resolve) => { finishStartup = resolve; });
    session.startup = startup;
    try {
      // A canceled preparation may still be resuming a thread. Finish it
      // before a new call can register ownership over that same thread.
      await previousStartup;
      await cleanup;
      if (active !== session || session.cancelRequested) return;
      const prepared = await options.sessions.prepareRealtimeSession(request);
      if (active !== session || session.cancelRequested) {
        try { await options.runs.cleanupRun(prepared.server, request.runId); }
        finally { await prepared.dispose?.(); }
        return;
      }
      session.threadId = prepared.threadId;
      session.server = prepared.server;
      session.dispose = prepared.dispose;
      session.release = options.runs.watchRealtimeRun(request.runId, prepared.model ?? undefined, work, () => session.latestUserText, options.getTimeout?.());
      const voice = options.getVoice?.();
      session.startRequest = prepared.server.sendRequest("thread/realtime/start", {
        threadId: prepared.threadId, outputModality: "audio", version: "v3",
        // The native server validates the advertised voice against v3. An unset
        // preference preserves its configured/default speaker.
        ...(voice ? { voice: voice as RealtimeVoice } : {}),
        transport: { type: "webrtc", sdp: request.sdp },
        // Let app-server own native delegation and response forwarding.
        clientManagedHandoffs: false,
        includeStartupContext: true,
        flushTranscriptTailOnSessionEnd: false,
        ...(request.voiceInstructions ? {
          realtimeStartInstructions: request.voiceInstructions,
          realtimeEndInstructions: "The voice call has ended. Voice coordination tools are unavailable. Leave separately delegated working chats running; resume ordinary written conversation when the user sends a message.",
          initialItems: [{ role: "developer", text: "You are the voice coordinator. For work requests, ask the backing Codex agent to use the mains_voice task tools and return promptly. Working chats run independently. Speak naturally in the user's language. Report only verified results." }],
        } : {}),
      });
      await session.startRequest;
    } catch (error) {
      await finish(session, "start_failed");
      throw error;
    } finally { finishStartup(); }
  }

  async function stop(runId: string, connectionId: string) {
    const session = active;
    if (!session || session.runId !== runId || session.connectionId !== connectionId) return;
    const stopping = session.stopping ??= (async () => {
      session.cancelRequested = true;
      try {
        await (session.startRequest ?? session.startup)?.catch(() => {});
        if (active !== session) { await session.finishing; return; }
        if (session.server?.isRunning && session.threadId) {
          await session.server.sendRequest("thread/realtime/stop", { threadId: session.threadId });
        }
        await finish(session, "ended");
      } catch (error) {
        // A native close or process exit confirms teardown even if the
        // concurrent stop RPC fails. Otherwise retain ownership for a retry.
        if (session.finishing) { await session.finishing; return; }
        if (!session.server?.isRunning) { await finish(session, "disconnected"); return; }
        throw error;
      }
    })();
    try { await stopping; }
    catch (error) {
      if (session.stopping === stopping) session.stopping = undefined;
      throw error;
    }
  }

  return {
    start, stop, handleNotification,
    serverClosed() {
      if (!active) return;
      publish(active, { type: "error", message: "Codex disconnected. Voice chat ended." });
      void finish(active, "disconnected");
    },
    async stopRun(runId: string) {
      if (active?.runId === runId) await stop(runId, active.connectionId);
    },
  };
}
