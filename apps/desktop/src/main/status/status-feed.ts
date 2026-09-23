import { CHANNELS } from "@mains/contracts/channels";
import { registerEventSink, type EventSink } from "@mains/backend/ipc-kit";
import { appSettingsService } from "@mains/backend/modules/appSettings";
import { appshotsService } from "../modules/appshots";
import { backendService } from "@mains/backend/modules/backend";
import { localBackendService } from "../modules/localBackend";
import { pulseService } from "@mains/backend/modules/pulse";
import {
  describeApprovalNotification,
  formatRunLabel,
  listPendingApprovals,
  runsService,
  type ActiveRunResponse,
} from "@mains/backend/modules/runs";
import { updatesService } from "../modules/updates";
import { workspaceService } from "@mains/backend/modules/workspace";
import type { TrayFinishedStatus, TraySnapshot } from "./status-menus";

/**
 * What the menu bar icon and the Dock menu show, kept current for both.
 *
 * It listens on the event bus like any other client (a sink), so it follows
 * run and approval changes without a single call site knowing it exists. A
 * slow heartbeat covers what nothing announces (a new workspace, a pulse, a
 * remote-access toggle). It only runs while someone subscribes.
 */

/** Pushes that change what the icon or the menus show. */
const WATCHED_CHANNELS = new Set<string>([
  CHANNELS.runs.statusChanged,
  CHANNELS.runs.toolApprovalRequest,
  CHANNELS.runs.toolApprovalResolved,
  CHANNELS.updates.status,
]);

const TERMINAL_STATUSES = new Set<string>(["succeeded", "failed", "canceled"]);
const MAX_FINISHED = 3;
const MAX_RECENT_WORKSPACES = 5;
/** Coalesce a burst of pushes (a run ending settles its approvals too). */
const REFRESH_DEBOUNCE_MS = 150;
const HEARTBEAT_MS = 60_000;

type Listener = (snapshot: TraySnapshot) => void;

const listeners = new Set<Listener>();
let refreshTimer: NodeJS.Timeout | null = null;
let heartbeat: NodeJS.Timeout | null = null;
let unregisterSink: (() => void) | null = null;
/** Runs that ended while the feed was running, newest first. */
let finished: Array<{ id: string; status: TrayFinishedStatus }> = [];

async function safely<T>(what: string, read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.warn(`[status] could not read ${what}:`, error);
    return fallback;
  }
}

async function labelOf(runId: string, active: ActiveRunResponse[]): Promise<string | null> {
  const run =
    active.find((candidate) => candidate.id === runId) ??
    (await safely("run", () => runsService.getRunById(runId), null));
  return run ? formatRunLabel(run) : null;
}

async function readSnapshot(): Promise<TraySnapshot> {
  const active = await safely("active runs", () => runsService.listActiveRuns(), []);
  const settings = await safely("settings", () => appSettingsService.getSettings(), null);

  const approvals = await Promise.all(
    listPendingApprovals().map(async (request) => {
      const runLabel = await labelOf(request.runId, active);
      const spec = describeApprovalNotification(request, runLabel);
      return {
        requestId: request.requestId,
        runId: request.runId,
        title: spec.title,
        runLabel,
        actions: spec.actions,
      };
    }),
  );

  const running = active.map((run) => ({
    id: run.id,
    label: formatRunLabel(run) ?? "Untitled run",
    workspaceName: run.workspace?.name ?? null,
    startedAt: run.startedAt ? new Date(run.startedAt).getTime() : null,
    queued: run.status === "queued",
  }));

  const finishedRuns = await Promise.all(
    finished
      // A run that is going again (continued) belongs under Running.
      .filter((entry) => !active.some((run) => run.id === entry.id))
      .map(async (entry) => ({
        id: entry.id,
        status: entry.status,
        label: (await labelOf(entry.id, active)) ?? "Untitled run",
      })),
  );

  const workspaces = await safely("workspaces", () => workspaceService.list(), []);
  const pulse = await safely("next pulse", () => pulseService.getNextScheduled(), null);
  const backend = await safely("remote access", () => localBackendService.getStatus(), null);
  const exposed = !!backend && (backend.remoteAccess || backend.tailscale);
  const pairedDevices = exposed
    ? (await safely("paired devices", () => backendService.listPairedDevices(), [])).length
    : 0;
  const lens = await safely("Lens", () => appshotsService.getStatus(), null);
  const update = await safely("updates", () => updatesService.getStatus(), null);

  return {
    approvals,
    running,
    finished: finishedRuns,
    recentWorkspaces: workspaces
      .slice(0, MAX_RECENT_WORKSPACES)
      .map((workspace) => ({ id: workspace.id, name: workspace.name })),
    nextPulse:
      pulse?.nextRunAt ? { title: pulse.title, at: new Date(pulse.nextRunAt).getTime() } : null,
    remoteAccess: exposed ? { pairedDevices } : null,
    lensShortcut: lens?.supported && lens.enabled ? lens.shortcut : null,
    preventSleepDuringRuns: settings?.preventSleepDuringRuns ?? false,
    updateReady: update?.status === "downloaded" ? (update.info?.version ?? "new version") : null,
  };
}

/** Re-read everything and tell the subscribers. Resolves with the fresh snapshot. */
export async function refreshStatus(): Promise<TraySnapshot> {
  const snapshot = await readSnapshot();
  for (const listener of listeners) listener(snapshot);
  return snapshot;
}

function refreshQuietly(): void {
  refreshStatus().catch((error) => console.warn("[status] refresh failed:", error));
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshQuietly();
  }, REFRESH_DEBOUNCE_MS);
}

function recordStatus(payload: unknown): void {
  const { runId, status } = (payload ?? {}) as { runId?: unknown; status?: unknown };
  if (typeof runId !== "string" || typeof status !== "string") return;
  finished = finished.filter((entry) => entry.id !== runId);
  if (TERMINAL_STATUSES.has(status)) {
    finished = [{ id: runId, status: status as TrayFinishedStatus }, ...finished].slice(
      0,
      MAX_FINISHED,
    );
  }
}

const statusSink: EventSink = {
  kind: "status",
  send(channel, payload) {
    if (!WATCHED_CHANNELS.has(channel)) return;
    if (channel === CHANNELS.runs.statusChanged) recordStatus(payload);
    scheduleRefresh();
  },
};

function start(): void {
  unregisterSink = registerEventSink(statusSink);
  heartbeat = setInterval(refreshQuietly, HEARTBEAT_MS);
  heartbeat.unref();
}

function stop(): void {
  unregisterSink?.();
  unregisterSink = null;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  finished = [];
}

/**
 * Follow the status. The listener gets every fresh snapshot, starting with one
 * read right away. Returns the unsubscribe; the feed stops with its last one.
 */
export function subscribeStatus(listener: Listener): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  refreshQuietly();
  return () => {
    if (!listeners.delete(listener)) return;
    if (listeners.size === 0) stop();
  };
}
