import { Menu, Notification, Tray } from "electron";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import { emit, registerEventSink, type EventSink } from "../ipc-kit";
import { reopenMainWindow, requestWindow } from "../windows";
import { appSettingsService } from "../modules/appSettings";
import { appshotsService } from "../modules/appshots";
import { backendService } from "../modules/backend";
import { localBackendService } from "../modules/localBackend";
import { pulseService } from "../modules/pulse";
import {
  describeApprovalNotification,
  formatRunLabel,
  handleToolApprovalResponse,
  listPendingApprovals,
  openRunInWindow,
  responseFromNotification,
  runsService,
  type ActiveRunResponse,
} from "../modules/runs";
import { updatesService } from "../modules/updates";
import { loadTrayIcons, type TrayIcons } from "./tray-icon";
import {
  EMPTY_TRAY_SNAPSHOT,
  buildTrayMenu,
  needsAttention,
  trayTitle,
  trayTooltip,
  type TrayActions,
  type TrayFinishedStatus,
  type TraySnapshot,
} from "./tray-menu";

/**
 * The menu bar icon: a live count of running runs, a badge while something
 * waits on the user, and a menu to act on both without opening the window.
 *
 * It listens on the event bus like any other client (a sink), so the icon
 * follows run and approval changes without a single call site knowing it
 * exists. The menu itself is built when it opens, from a fresh snapshot, so
 * elapsed times and status lines are never stale.
 */

/** Pushes that change what the icon or the menu shows. */
const WATCHED_CHANNELS = new Set<string>([
  CHANNELS.runs.statusChanged,
  CHANNELS.runs.toolApprovalRequest,
  CHANNELS.runs.toolApprovalResolved,
  CHANNELS.updates.status,
]);

const TERMINAL_STATUSES = new Set<string>(["succeeded", "failed", "canceled"]);
const MAX_FINISHED = 3;
/** Coalesce a burst of pushes (a run ending settles its approvals too). */
const REFRESH_DEBOUNCE_MS = 150;

let tray: Tray | null = null;
let icons: TrayIcons | null = null;
let showingAttention = false;
let snapshot: TraySnapshot = EMPTY_TRAY_SNAPSHOT;
let refreshTimer: NodeJS.Timeout | null = null;
let unregisterSink: (() => void) | null = null;
/** Runs that ended while the app was up, newest first. */
let finished: Array<{ id: string; status: TrayFinishedStatus }> = [];

async function safely<T>(what: string, read: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.warn(`[tray] could not read ${what}:`, error);
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
    nextPulse:
      pulse?.nextRunAt ? { title: pulse.title, at: new Date(pulse.nextRunAt).getTime() } : null,
    remoteAccess: exposed ? { pairedDevices } : null,
    lensShortcut: lens?.supported && lens.enabled ? lens.shortcut : null,
    preventSleepDuringRuns: settings?.preventSleepDuringRuns ?? false,
    updateReady: update?.status === "downloaded" ? (update.info?.version ?? "new version") : null,
  };
}

/** Title, tooltip and badge — what the menu bar shows without opening the menu. */
function applyToIcon(): void {
  if (!tray || tray.isDestroyed()) return;
  tray.setTitle(trayTitle(snapshot), { fontType: "monospacedDigit" });
  tray.setToolTip(trayTooltip(snapshot));
  const attention = needsAttention(snapshot);
  if (icons && attention !== showingAttention) {
    tray.setImage(attention ? icons.attention : icons.normal);
    showingAttention = attention;
  }
}

async function refresh(): Promise<void> {
  snapshot = await readSnapshot();
  applyToIcon();
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
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

const traySink: EventSink = {
  kind: "tray",
  send(channel, payload) {
    if (!WATCHED_CHANNELS.has(channel)) return;
    if (channel === CHANNELS.runs.statusChanged) recordStatus(payload);
    scheduleRefresh();
  },
};

function warnOnFailure(what: string) {
  return (error: unknown) => console.warn(`[tray] ${what} failed:`, error);
}

const actions: TrayActions = {
  answerApproval(requestId, actionIndex) {
    const request = listPendingApprovals().find((r) => r.requestId === requestId);
    if (!request) return;
    const response = responseFromNotification(request, {
      type: "action",
      index: actionIndex,
    });
    if (response) handleToolApprovalResponse(response);
  },
  openRun(runId) {
    void openRunInWindow(runId).catch(warnOnFailure("opening the run"));
  },
  stopRun(runId) {
    void runsService.abortRun(runId).catch(warnOnFailure("stopping the run"));
  },
  newChat() {
    requestWindow({ kind: "newChat" });
  },
  navigate(path) {
    requestWindow({ kind: "navigate", path });
  },
  captureWindow() {
    void appshotsService.captureAndDeliver().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      new Notification({ title: "Couldn't capture the window", body: message }).show();
    });
  },
  setPreventSleep(enabled) {
    void appSettingsService
      .updateSettings({ preventSleepDuringRuns: enabled })
      // The window didn't make this change — tell it, so Settings isn't stale.
      .then(() => emit(CHANNELS.appSettings.changed, {}))
      .catch(warnOnFailure("updating the sleep setting"));
  },
  installUpdate() {
    try {
      updatesService.quitAndInstall();
    } catch (error) {
      warnOnFailure("installing the update")(error);
    }
  },
  checkForUpdates() {
    void updatesService.checkForUpdates().catch(warnOnFailure("checking for updates"));
  },
  showWindow() {
    reopenMainWindow();
  },
};

async function openMenu(): Promise<void> {
  await refresh().catch(warnOnFailure("refreshing the menu"));
  if (!tray || tray.isDestroyed()) return;
  tray.popUpContextMenu(Menu.buildFromTemplate(buildTrayMenu(snapshot, actions, Date.now())));
}

/** Put the icon in the menu bar (idempotent). */
export function showTray(): void {
  if (tray) return;
  icons = loadTrayIcons();
  showingAttention = false;
  tray = new Tray(icons.normal);
  tray.setToolTip("Mains");
  // No `setContextMenu`: the menu is built fresh on every open, and either
  // button opens it — the window is one item away ("Show Mains").
  tray.on("click", () => void openMenu());
  tray.on("right-click", () => void openMenu());
  unregisterSink = registerEventSink(traySink);
  void refresh().catch(warnOnFailure("reading the tray state"));
}

/** Take the icon out of the menu bar (idempotent). */
export function hideTray(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  unregisterSink?.();
  unregisterSink = null;
  tray?.destroy();
  tray = null;
  finished = [];
  snapshot = EMPTY_TRAY_SNAPSHOT;
}
