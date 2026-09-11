import * as Network from "expo-network";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { toWebSocketUrl } from "@mains/contracts/backend";
import { CHANNELS } from "@mains/contracts/channels";
import type {
  AccountResponse,
  ContinueRunPayload,
  ContinueRunResponse,
  FileAttachment,
  ForkRunPayload,
  ForkRunResponse,
  ModeId,
  SkillSummary,
  SpaceModePayload,
  StartRunPayload,
  StartRunResponse,
  ToolApprovalResponse,
  UpdateRunSettingsPayload,
  ArtifactImage,
  RunEphemeralEvent,
} from "@mains/contracts/runs";
import { db } from "@/db/client";
import { runs, spaces } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { ServiceResponse } from "@mains/contracts/ws-protocol";
import {
  hasAiDataConsent,
  missingAiDataConsentMessage,
} from "@/lib/ai-data-consent";
import { newCommandId } from "@/lib/ids";

import {
  ConnectionSupervisor,
  type ConnectionState,
  type SupervisorSignals,
} from "./connection-supervisor";
import {
  forgetPairedBackend,
  loadPairedBackend,
  type PairedBackend,
} from "./paired-backend-store";
import {
  attachRunEvents,
  attachTargetEvents,
  clearBackend,
  deletePendingApproval,
  describeBackend,
  firstSpaceId,
  getLastSpaceId,
  getModelChoice,
  setLastSpaceId,
  syncContextSources,
  type ContextSourcesResult,
  syncRun,
  syncSnapshot,
  syncTargets,
  upsertBackend,
  readArtifactImage,
} from "./sync";
import { isConnectionLoss, WsTransport, type CloseInfo } from "./ws-transport";
import {
  clearAllStreamingMessages,
  clearStreamingMessages,
  receiveStreamingMessage,
} from "./streaming-messages";
import {
  createDemoTransport,
  DEMO_BACKEND_ID,
  isDemoEndpoint,
} from "./demo/transport";

/**
 * The app-wide composition of paired backend + supervisor + sync: one instance
 * for the app's lifetime, started from the root layout. Screens observe it
 * with `useSession()` and read data from the projection tables, never from
 * the socket. Later a second backend (another Mac, a cloud executor) becomes a
 * second supervisor in here; the screens won't notice.
 */

export interface SessionSnapshot {
  /** False until the keychain has been read once. */
  loaded: boolean;
  backend: PairedBackend | null;
  connection: ConnectionState;
  /** The Mac's account id — run mutations must carry it. Known once connected. */
  accountId: string | null;
  /** The space new runs are aimed at; chosen in the sidebar, remembered per Mac. */
  selectedSpaceId: string | null;
  /** When the projection last finished a full pull from the Mac; null before the first. */
  lastSyncedAt: Date | null;
  /** True while a "sync now" is out — the one pull the user asked for by hand. */
  refreshing: boolean;
}

const IDLE: ConnectionState = { kind: "idle" };

function isAuthRefusal(info: CloseInfo): boolean {
  return /\b401\b|unauthorized/i.test(info.reason ?? "");
}

function platformSignals(): SupervisorSignals {
  return {
    network: {
      async isOnline() {
        const state = await Network.getNetworkStateAsync();
        return state.isConnected ?? true;
      },
      subscribe(listener) {
        const subscription = Network.addNetworkStateListener((state) => {
          listener(state.isConnected ?? true);
        });
        return () => subscription.remove();
      },
    },
    lifecycle: {
      isActive() {
        return AppState.currentState === "active";
      },
      subscribe(listener) {
        const subscription = AppState.addEventListener("change", (state) => {
          listener(state === "active");
        });
        return () => subscription.remove();
      },
    },
  };
}

/** Demo Mode is fully on-device and must also work without a network. */
function demoSignals(): SupervisorSignals {
  const signals = platformSignals();
  return {
    ...signals,
    network: {
      async isOnline() {
        return true;
      },
      subscribe() {
        return () => {};
      },
    },
  };
}

class BackendSession {
  private snapshot: SessionSnapshot = {
    loaded: false,
    backend: null,
    connection: IDLE,
    accountId: null,
    selectedSpaceId: null,
    lastSyncedAt: null,
    refreshing: false,
  };
  private readonly listeners = new Set<() => void>();

  private supervisor: ConnectionSupervisor | null = null;
  private unsubscribeSupervisor: (() => void) | null = null;
  private transport: WsTransport | null = null;
  private detachEvents: (() => void) | null = null;
  private viewingRunId: string | null = null;

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** (Re)read the paired backend from the keychain and connect to it. */
  async start(): Promise<void> {
    this.stop();
    const backend = await loadPairedBackend();
    if (!backend) {
      this.publish({
        loaded: true,
        backend: null,
        connection: IDLE,
        accountId: null,
        selectedSpaceId: null,
        lastSyncedAt: null,
        refreshing: false,
      });
      return;
    }
    upsertBackend({
      backendId: backend.backendId,
      name: backend.name,
      appVersion: backend.appVersion,
      protocolVersion: backend.protocolVersion,
      capabilities: [],
      serverTime: backend.pairedAt,
    });
    this.publish({
      loaded: true,
      backend,
      connection: { kind: "connecting", endpoint: backend.endpoints[0] ?? "" },
      accountId: null,
      selectedSpaceId: getLastSpaceId(backend.backendId) ?? firstSpaceId(backend.backendId),
      lastSyncedAt: null,
      refreshing: false,
    });

    const supervisor = new ConnectionSupervisor({
      endpoints: backend.endpoints,
      createTransport: (endpoint) => {
        // The demo Mac lives inside the app; its endpoint only picks the socket.
        const transport = isDemoEndpoint(endpoint)
          ? createDemoTransport()
          : new WsTransport(toWebSocketUrl(endpoint), {
              token: backend.deviceToken,
              isFatalClose: isAuthRefusal,
            });
        this.transport = transport;
        return transport;
      },
      onConnected: async (transport) => {
        const descriptor = await describeBackend(transport);
        upsertBackend(descriptor);
        const account = await transport.invoke(CHANNELS.account.get);
        if (account.success && account.data) {
          this.publish({ ...this.snapshot, accountId: (account.data as AccountResponse).id });
        }
        await syncSnapshot(transport, backend.backendId);
        this.publish({ ...this.snapshot, lastSyncedAt: new Date() });
        this.ensureSelectedSpace(backend.backendId);
        this.detachEvents?.();
        const detachRuns = attachRunEvents(transport, backend.backendId, {
          isViewing: (runId) => runId === this.viewingRunId,
        });
        const detachStreaming = transport.subscribe(CHANNELS.runs.ephemeralEvent, (payload) => {
          const event = payload as RunEphemeralEvent;
          if (event.runId === this.viewingRunId) receiveStreamingMessage(event);
        });
        const detachTargets = attachTargetEvents(transport, backend.backendId);
        this.detachEvents = () => {
          detachRuns();
          detachStreaming();
          detachTargets();
        };
        if (this.viewingRunId) {
          void syncRun(transport, backend.backendId, this.viewingRunId).catch(() => {});
        }
        return descriptor;
      },
      signals: backend.backendId === DEMO_BACKEND_ID ? demoSignals() : platformSignals(),
    });
    this.supervisor = supervisor;
    this.unsubscribeSupervisor = supervisor.subscribe(() => {
      this.publish({ ...this.snapshot, connection: supervisor.getState() });
    });
    await supervisor.start();
  }

  stop(): void {
    clearAllStreamingMessages();
    this.detachEvents?.();
    this.detachEvents = null;
    this.unsubscribeSupervisor?.();
    this.unsubscribeSupervisor = null;
    this.supervisor?.dispose();
    this.supervisor = null;
    this.transport = null;
    if (this.snapshot.connection !== IDLE) {
      this.publish({ ...this.snapshot, connection: IDLE });
    }
  }

  /** Forget the Mac: credentials, projection, connection. */
  async forget(): Promise<void> {
    const backendId = this.snapshot.backend?.backendId;
    this.stop();
    await forgetPairedBackend();
    if (backendId) clearBackend(backendId);
    this.publish({
      loaded: true,
      backend: null,
      connection: IDLE,
      accountId: null,
      selectedSpaceId: null,
      lastSyncedAt: null,
      refreshing: false,
    });
  }

  // ── Run target (space) ──

  /** Keep the selection pointing at a space that still exists; fall back to the first. */
  private ensureSelectedSpace(backendId: string): void {
    const current = this.snapshot.selectedSpaceId;
    const exists = current
      ? db
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.backendId, backendId), eq(spaces.id, current)))
          .get() !== undefined
      : false;
    if (exists) return;
    const fallback = firstSpaceId(backendId);
    if (fallback) {
      setLastSpaceId(backendId, fallback);
    }
    this.publish({ ...this.snapshot, selectedSpaceId: fallback });
  }

  /** The sidebar's space switcher. */
  selectSpace(spaceId: string): void {
    const backendId = this.snapshot.backend?.backendId;
    if (backendId) setLastSpaceId(backendId, spaceId);
    this.publish({ ...this.snapshot, selectedSpaceId: spaceId });
  }

  /**
   * The mode segment: like the desktop's mode picker, it edits the space
   * itself (provider/mode compatibility is checked on the Mac).
   */
  async setSpaceMode(spaceId: string, mode: ModeId): Promise<ServiceResponse<unknown>> {
    const payload: SpaceModePayload = { mode };
    const result = await this.command(CHANNELS.space.update, [spaceId, payload]);
    const backendId = this.snapshot.backend?.backendId;
    if (result.success && this.transport && backendId) {
      await syncTargets(this.transport, backendId).catch(() => {});
    }
    return result;
  }

  /**
   * Edit a provider's run settings on the Mac — the same settings the
   * desktop's composer toolbar edits (effort, permission mode, fast / goal /
   * plan). Only the keys in `patch` change.
   */
  async updateRunSettings(
    providerId: string,
    patch: UpdateRunSettingsPayload,
  ): Promise<ServiceResponse<unknown>> {
    const result = await this.command(CHANNELS.providers.updateRunSettings, [providerId, patch]);
    const backendId = this.snapshot.backend?.backendId;
    if (result.success && this.transport && backendId) {
      await syncTargets(this.transport, backendId).catch(() => {});
    }
    return result;
  }

  /** Start a run in the selected space. Resolves the new run id. */
  async startRun(input: {
    goal: string;
    workspaceId?: string | null;
    collectionId?: string | null;
    /** Skills the composer attached; the Mac injects them and chips the prompt. */
    contextSkills?: SkillSummary[];
    /** Phone-local files serialized for the Mac's attachment pipeline. */
    attachments?: FileAttachment[];
    /** The model the composer shows — sent as is, so what you see is what runs. */
    model?: string | null;
  }): Promise<ServiceResponse<StartRunResponse>> {
    const { accountId, backend, selectedSpaceId } = this.snapshot;
    if (!accountId || !backend) {
      return { success: false, error: "Not connected to your Mac yet" };
    }
    if (!selectedSpaceId) {
      return { success: false, error: "Pick a space in the sidebar first" };
    }
    const space = db
      .select()
      .from(spaces)
      .where(and(eq(spaces.backendId, backend.backendId), eq(spaces.id, selectedSpaceId)))
      .get();
    if (!space) {
      return { success: false, error: "That space no longer exists on your Mac" };
    }
    if (
      backend.backendId !== DEMO_BACKEND_ID &&
      !hasAiDataConsent(backend.backendId, space.providerId)
    ) {
      return {
        success: false,
        error: missingAiDataConsentMessage(space.providerId),
      };
    }
    const model = input.model ?? getModelChoice(backend.backendId, space.providerId);
    const payload: StartRunPayload = {
      accountId,
      spaceId: space.id,
      providerId: space.providerId,
      goal: input.goal,
      // Only an explicit pick travels; otherwise the Mac uses the provider's default.
      ...(model ? { model } : {}),
      ...(space.mode === "developer" && input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(space.mode !== "developer" && input.collectionId ? { collectionId: input.collectionId } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.contextSkills?.length ? { contextSkills: input.contextSkills } : {}),
    };
    const result = await this.command<StartRunResponse>(CHANNELS.runs.execute, [payload]);
    if (result.success && this.transport) {
      void syncRun(this.transport, backend.backendId, result.data.runId).catch(() => {});
    }
    return result;
  }

  // ── Actions (the control loop's verbs, each an idempotent command) ──

  /**
   * Re-list one provider's skills and commands. The snapshot fetches them once;
   * this is for the moments a stale listing shows: opening the picker, or a
   * plugin installed on the Mac since the phone last connected.
   */
  async refreshContextSources(
    providerId: string,
    workspacePath?: string | null,
  ): Promise<ContextSourcesResult | null> {
    const backendId = this.snapshot.backend?.backendId;
    if (!this.transport || !backendId || !providerId) return null;
    try {
      const [result] = await syncContextSources(
        this.transport,
        backendId,
        [providerId],
        workspacePath,
      );
      return result ?? null;
    } catch (error) {
      return {
        providerId,
        skills: null,
        commands: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Answer an agent's request. The row leaves the projection as soon as the Mac confirms. */
  async respondToApproval(
    requestId: string,
    approved: boolean,
    answer?: string,
  ): Promise<ServiceResponse<void>> {
    const body: ToolApprovalResponse = answer === undefined
      ? { requestId, approved }
      : { requestId, approved, answer };
    const result = await this.command<void>(CHANNELS.runs.toolApprovalResponse, [body]);
    const backendId = this.snapshot.backend?.backendId;
    if (result.success && backendId) deletePendingApproval(backendId, requestId);
    return result;
  }

  /** Send a follow-up message to a finished run; the Mac resumes the session. */
  async continueRun(
    runId: string,
    message: string,
    contextSkills?: SkillSummary[],
    /** The model the composer shows; without one, the Mac keeps the run's. */
    shownModel?: string | null,
    /** Phone-local files serialized for the Mac's attachment pipeline. */
    attachments?: FileAttachment[],
  ): Promise<ServiceResponse<ContinueRunResponse>> {
    const { accountId, backend } = this.snapshot;
    if (!accountId || !backend) {
      return { success: false, error: "Not connected to your Mac yet" };
    }
    const run = db
      .select({ providerId: runs.providerId })
      .from(runs)
      .where(and(eq(runs.backendId, backend.backendId), eq(runs.id, runId)))
      .get();
    if (!run) {
      return { success: false, error: "That run is not available on this phone yet" };
    }
    if (
      backend.backendId !== DEMO_BACKEND_ID &&
      !hasAiDataConsent(backend.backendId, run.providerId)
    ) {
      return {
        success: false,
        error: missingAiDataConsentMessage(run.providerId),
      };
    }
    const model = shownModel ?? getModelChoice(backend.backendId, run.providerId);
    const payload: ContinueRunPayload = {
      runId,
      accountId,
      message,
      ...(model ? { model } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(contextSkills?.length ? { contextSkills } : {}),
    };
    const result = await this.command<ContinueRunResponse>(CHANNELS.runs.continue, [payload]);
    if (result.success && this.transport) {
      void syncRun(this.transport, backend.backendId, runId).catch(() => {});
    }
    return result;
  }

  /**
   * Branch a finished run into a new one. The Mac forks the provider session,
   * so the new run inherits the source's workspace, mode, policy and model —
   * only the opening message is ours to send. Resolves the new run's id.
   */
  async forkRun(
    sourceRunId: string,
    message: string,
  ): Promise<ServiceResponse<ForkRunResponse>> {
    const { accountId, backend } = this.snapshot;
    if (!accountId || !backend) {
      return { success: false, error: "Not connected to your Mac yet" };
    }
    const run = db
      .select({ providerId: runs.providerId })
      .from(runs)
      .where(and(eq(runs.backendId, backend.backendId), eq(runs.id, sourceRunId)))
      .get();
    if (!run) {
      return { success: false, error: "That run is not available on this phone yet" };
    }
    if (
      backend.backendId !== DEMO_BACKEND_ID &&
      !hasAiDataConsent(backend.backendId, run.providerId)
    ) {
      return {
        success: false,
        error: missingAiDataConsentMessage(run.providerId),
      };
    }
    const payload: ForkRunPayload = { sourceRunId, accountId, message };
    const result = await this.command<ForkRunResponse>(CHANNELS.runs.fork, [payload]);
    if (result.success && this.transport) {
      // The new run has no row in the projection yet; pull it before the
      // screen that is about to open queries for it.
      void syncRun(this.transport, backend.backendId, result.data.runId).catch(() => {});
    }
    return result;
  }

  /**
   * Stop a run mid-flight — the desktop's own verb (`runs:abort`, what its
   * composer's stop button calls). The Mac settles the run's status and pushes
   * it; the refetch here is only so the screen does not wait on that round trip.
   */
  async abortRun(runId: string): Promise<ServiceResponse<void>> {
    if (!this.snapshot.backend) {
      return { success: false, error: "Not connected to your Mac yet" };
    }
    const backendId = this.snapshot.backend.backendId;
    const result = await this.command<void>(CHANNELS.runs.abort, [runId]);
    if (result.success && this.transport) {
      void syncRun(this.transport, backendId, runId).catch(() => {});
    }
    return result;
  }

  /** An image artifact's pixels, from the Mac; rejects while it is out of reach. */
  readArtifactImage(artifactId: number): Promise<ArtifactImage> {
    if (!this.isConnected() || !this.transport) {
      return Promise.reject(new Error("Connect to your Mac to load this image"));
    }
    return readArtifactImage(this.transport, artifactId);
  }

  /** The transcript on screen — its events trigger refetches; others wait. */
  openRun(runId: string): void {
    if (this.viewingRunId && this.viewingRunId !== runId) {
      clearStreamingMessages(this.viewingRunId);
    }
    this.viewingRunId = runId;
    const backendId = this.snapshot.backend?.backendId;
    if (this.isConnected() && this.transport && backendId) {
      void syncRun(this.transport, backendId, runId).catch(() => {});
    }
  }

  closeRun(runId: string): void {
    if (this.viewingRunId === runId) {
      this.viewingRunId = null;
      clearStreamingMessages(runId);
    }
  }

  /**
   * Issue a mutation with exactly-once semantics. The same `commandId` is
   * re-sent after a dropped connection until the Mac answers — its receipt
   * store guarantees the handler ran at most once — or the deadline passes.
   * A `success: false` reply is an answer, not a reason to retry.
   */
  async command<T = unknown>(
    channel: string,
    args: unknown[] = [],
    options: { timeoutMs?: number } = {},
  ): Promise<ServiceResponse<T>> {
    const commandId = newCommandId();
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    for (;;) {
      const transport = await this.waitForConnected(deadline);
      try {
        return (await transport.invoke(channel, args, { commandId })) as ServiceResponse<T>;
      } catch (error) {
        if (!isConnectionLoss(error) || Date.now() >= deadline) throw error;
      }
    }
  }

  /** Resolve with the live transport once the session is `connected`. */
  private waitForConnected(deadline: number): Promise<WsTransport> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const { connection } = this.snapshot;
        if (connection.kind === "connected" && this.transport) {
          resolve(this.transport);
          return true;
        }
        if (
          connection.kind === "idle" ||
          connection.kind === "authBlocked" ||
          connection.kind === "incompatible"
        ) {
          reject(new Error(`Not connected to your Mac (${connection.kind})`));
          return true;
        }
        return false;
      };
      if (check()) return;
      const unsubscribe = this.subscribe(() => {
        if (check()) {
          clearTimeout(timer);
          unsubscribe();
        }
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timed out waiting for the connection"));
      }, Math.max(0, deadline - Date.now()));
    });
  }

  /** Pull a fresh snapshot now (pull-to-refresh, "sync now"). */
  async refresh(): Promise<void> {
    const backendId = this.snapshot.backend?.backendId;
    if (!this.isConnected() || !this.transport || !backendId) {
      this.supervisor?.retry();
      return;
    }
    if (this.snapshot.refreshing) return;
    this.publish({ ...this.snapshot, refreshing: true });
    try {
      await syncSnapshot(this.transport, backendId);
      if (this.viewingRunId) await syncRun(this.transport, backendId, this.viewingRunId);
      this.publish({ ...this.snapshot, lastSyncedAt: new Date(), refreshing: false });
    } catch (error) {
      this.publish({ ...this.snapshot, refreshing: false });
      throw error;
    }
  }

  /** Drop the current failure and try the Mac again now — the settings screen's "try again". */
  retry(): void {
    this.supervisor?.retry();
  }

  private isConnected(): boolean {
    return this.snapshot.connection.kind === "connected";
  }

  private publish(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export const backendSession = new BackendSession();

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(
    backendSession.subscribe,
    backendSession.getSnapshot,
    backendSession.getSnapshot,
  );
}
