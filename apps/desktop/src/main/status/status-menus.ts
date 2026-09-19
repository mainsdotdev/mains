import type { MenuItemConstructorOptions } from "electron";

/**
 * The menu bar (tray) and Dock menus as pure functions of what is going on —
 * no Electron runtime, so the layouts are testable. `status-feed.ts` gathers
 * the snapshot; `status-actions.ts` supplies the actions.
 */

/** A request waiting on the user, already described the way its notification is. */
export interface TrayApproval {
  requestId: string;
  runId: string;
  /** e.g. "Allow Bash?" — the notification's title. */
  title: string;
  runLabel: string | null;
  /** Buttons the request can be answered with here; empty = open the app. */
  actions: string[];
}

export interface TrayRun {
  id: string;
  label: string;
  workspaceName: string | null;
  startedAt: number | null;
  queued: boolean;
}

export type TrayFinishedStatus = "succeeded" | "failed" | "canceled";

export interface TrayFinishedRun {
  id: string;
  label: string;
  status: TrayFinishedStatus;
}

export interface TrayWorkspace {
  id: string;
  name: string;
}

export interface TraySnapshot {
  approvals: TrayApproval[];
  running: TrayRun[];
  /** Newest first. */
  finished: TrayFinishedRun[];
  /** Most recently touched first. */
  recentWorkspaces: TrayWorkspace[];
  nextPulse: { title: string; at: number } | null;
  /** Null while the desktop is not exposed as a backend. */
  remoteAccess: { pairedDevices: number } | null;
  /** The Lens shortcut, or null when Lens is off. */
  lensShortcut: string | null;
  preventSleepDuringRuns: boolean;
  /** Version of a downloaded update waiting for a restart. */
  updateReady: string | null;
}

export const EMPTY_TRAY_SNAPSHOT: TraySnapshot = {
  approvals: [],
  running: [],
  finished: [],
  recentWorkspaces: [],
  nextPulse: null,
  remoteAccess: null,
  lensShortcut: null,
  preventSleepDuringRuns: false,
  updateReady: null,
};

export interface TrayActions {
  answerApproval(requestId: string, actionIndex: number): void;
  openRun(runId: string): void;
  stopRun(runId: string): void;
  openWorkspace(workspaceId: string): void;
  newChat(): void;
  navigate(path: string): void;
  captureWindow(): void;
  setPreventSleep(enabled: boolean): void;
  installUpdate(): void;
  checkForUpdates(): void;
  showWindow(): void;
}

const MAX_LABEL_CHARS = 48;

const FINISHED_MARK: Record<TrayFinishedStatus, string> = {
  succeeded: "✓",
  failed: "✕",
  canceled: "■",
};

function clip(text: string, max = MAX_LABEL_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** `42s` → `<1m`, `4m`, `1h 5m`. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Clock time today, weekday + time within the week, date beyond. */
export function formatPulseTime(at: number, now: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (when.toDateString() === new Date(now).toDateString()) return time;
  const days = (at - now) / 86_400_000;
  const day =
    days < 6
      ? when.toLocaleDateString([], { weekday: "short" })
      : when.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} ${time}`;
}

/** Shown next to the icon: how many runs are going. */
export function trayTitle(snapshot: TraySnapshot): string {
  return snapshot.running.length > 0 ? String(snapshot.running.length) : "";
}

/** A request is waiting — the icon wears its badge. */
export function needsAttention(snapshot: TraySnapshot): boolean {
  return snapshot.approvals.length > 0;
}

export function trayTooltip(snapshot: TraySnapshot): string {
  const parts: string[] = [];
  if (snapshot.running.length > 0) parts.push(`${snapshot.running.length} running`);
  if (snapshot.approvals.length > 0) parts.push(`${snapshot.approvals.length} waiting for you`);
  return parts.length > 0 ? `Mains — ${parts.join(" · ")}` : "Mains";
}

function approvalItem(
  approval: TrayApproval,
  actions: TrayActions,
): MenuItemConstructorOptions {
  const answers: MenuItemConstructorOptions[] = approval.actions.map((text, index) => ({
    label: clip(text),
    click: () => actions.answerApproval(approval.requestId, index),
  }));
  return {
    label: clip(approval.title),
    ...(approval.runLabel ? { sublabel: clip(approval.runLabel) } : {}),
    submenu: [
      ...answers,
      ...(answers.length > 0 ? [{ type: "separator" as const }] : []),
      { label: "Open in Mains", click: () => actions.openRun(approval.runId) },
    ],
  };
}

/** `now` null leaves out the elapsed time (a menu that is not rebuilt per open). */
function runningItem(
  run: TrayRun,
  actions: TrayActions,
  now: number | null,
): MenuItemConstructorOptions {
  const progress = run.queued
    ? "Queued"
    : run.startedAt !== null && now !== null
      ? formatElapsed(now - run.startedAt)
      : null;
  const sublabel = [run.workspaceName, progress].filter(Boolean).join(" · ");
  return {
    label: clip(run.label),
    ...(sublabel ? { sublabel } : {}),
    submenu: [
      { label: "Open", click: () => actions.openRun(run.id) },
      { label: "Stop", click: () => actions.stopRun(run.id) },
    ],
  };
}

function section(
  title: string,
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  return items.length > 0 ? [{ type: "header", label: title }, ...items] : [];
}

/** The Dock draws its menu itself and skips header items; a greyed title reads the same. */
function dockSection(
  title: string,
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  return items.length > 0 ? [{ label: title, enabled: false }, ...items] : [];
}

/** Join non-empty groups with separators. */
function joinGroups(groups: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : [{ type: "separator" as const }, ...group]));
}

export function buildTrayMenu(
  snapshot: TraySnapshot,
  actions: TrayActions,
  now: number,
): MenuItemConstructorOptions[] {
  const needsYou = section(
    "Needs you",
    snapshot.approvals.map((approval) => approvalItem(approval, actions)),
  );

  const runs = [
    ...section(
      "Running",
      snapshot.running.map((run) => runningItem(run, actions, now)),
    ),
    ...section(
      "Recently finished",
      snapshot.finished.map((run) => ({
        label: `${FINISHED_MARK[run.status]} ${clip(run.label)}`,
        click: () => actions.openRun(run.id),
      })),
    ),
  ];

  const status: MenuItemConstructorOptions[] = [];
  if (snapshot.nextPulse) {
    status.push({
      label: `Next pulse: ${clip(snapshot.nextPulse.title, 32)} · ${formatPulseTime(snapshot.nextPulse.at, now)}`,
      click: () => actions.navigate("/pulse"),
    });
  }
  if (snapshot.remoteAccess) {
    const devices = snapshot.remoteAccess.pairedDevices;
    status.push({
      label:
        devices > 0
          ? `Remote access on · ${devices} paired ${devices === 1 ? "device" : "devices"}`
          : "Remote access on",
      click: () => actions.navigate("/relay"),
    });
  }

  const quick: MenuItemConstructorOptions[] = [
    { label: "New Chat", click: () => actions.newChat() },
  ];
  if (snapshot.lensShortcut) {
    quick.push({
      label: "Capture Window",
      accelerator: snapshot.lensShortcut,
      click: () => actions.captureWindow(),
    });
  }
  quick.push({
    label: "Prevent Sleep During Runs",
    type: "checkbox",
    checked: snapshot.preventSleepDuringRuns,
    click: () => actions.setPreventSleep(!snapshot.preventSleepDuringRuns),
  });
  quick.push(
    snapshot.updateReady
      ? {
          label: `Restart to Update (${snapshot.updateReady})`,
          click: () => actions.installUpdate(),
        }
      : { label: "Check for Updates…", click: () => actions.checkForUpdates() },
  );

  const app: MenuItemConstructorOptions[] = [
    { label: "Show Mains", click: () => actions.showWindow() },
    { label: "Quit Mains", role: "quit" },
  ];

  return joinGroups([needsYou, runs, status, quick, app]);
}

/**
 * The Dock icon's menu: what needs the user and what is running, the recent
 * workspaces, and a new chat. macOS appends its own items (Options, Show All
 * Windows, Hide, Quit), so there is no Show / Quit here. It is set ahead of
 * time rather than built on open, so it carries no elapsed times.
 */
export function buildDockMenu(
  snapshot: TraySnapshot,
  actions: TrayActions,
): MenuItemConstructorOptions[] {
  const needsYou = dockSection(
    "Needs you",
    snapshot.approvals.map((approval) => approvalItem(approval, actions)),
  );
  const running = dockSection(
    "Running",
    snapshot.running.map((run) => runningItem(run, actions, null)),
  );
  const recent = dockSection(
    "Recent Workspaces",
    snapshot.recentWorkspaces.map((workspace) => ({
      label: clip(workspace.name),
      click: () => actions.openWorkspace(workspace.id),
    })),
  );
  const quick: MenuItemConstructorOptions[] = [
    { label: "New Chat", click: () => actions.newChat() },
  ];
  return joinGroups([needsYou, running, recent, quick]);
}
