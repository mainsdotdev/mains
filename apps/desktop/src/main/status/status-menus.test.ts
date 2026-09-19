import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_TRAY_SNAPSHOT,
  buildDockMenu,
  buildTrayMenu,
  formatElapsed,
  needsAttention,
  trayTitle,
  trayTooltip,
  type TrayActions,
  type TraySnapshot,
} from "./status-menus";

const NOW = new Date("2026-09-19T10:00:00").getTime();

function actions(): TrayActions {
  return {
    answerApproval: vi.fn(),
    openRun: vi.fn(),
    stopRun: vi.fn(),
    openWorkspace: vi.fn(),
    newChat: vi.fn(),
    navigate: vi.fn(),
    captureWindow: vi.fn(),
    setPreventSleep: vi.fn(),
    installUpdate: vi.fn(),
    checkForUpdates: vi.fn(),
    showWindow: vi.fn(),
  };
}

const snapshot = (overrides: Partial<TraySnapshot> = {}): TraySnapshot => ({
  ...EMPTY_TRAY_SNAPSHOT,
  ...overrides,
});

/** Labels in order, separators as "---", headers as "# Title". */
function outline(items: MenuItemConstructorOptions[]): string[] {
  return items.map((item) =>
    item.type === "separator" ? "---" : item.type === "header" ? `# ${item.label}` : item.label!,
  );
}

function find(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = items.find((candidate) => candidate.label === label);
  if (!item) throw new Error(`No menu item "${label}" in ${outline(items).join(" | ")}`);
  return item;
}

function click(item: MenuItemConstructorOptions): void {
  (item.click as () => void)();
}

const submenu = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[];

describe("buildTrayMenu", () => {
  it("keeps an idle menu to the quick actions and the app", () => {
    expect(outline(buildTrayMenu(snapshot(), actions(), NOW))).toEqual([
      "New Chat",
      "Prevent Sleep During Runs",
      "Check for Updates…",
      "---",
      "Show Mains",
      "Quit Mains",
    ]);
  });

  it("lays out every section in order when there is something to show", () => {
    const menu = buildTrayMenu(
      snapshot({
        approvals: [
          { requestId: "req-1", runId: "run-1", title: "Allow Bash?", runLabel: "Hero", actions: ["Allow", "Deny"] },
        ],
        running: [
          { id: "run-1", label: "Hero", workspaceName: "web", startedAt: NOW - 4 * 60_000, queued: false },
        ],
        finished: [{ id: "run-0", label: "Docs", status: "succeeded" }],
        nextPulse: { title: "Daily standup", at: NOW + 60 * 60_000 },
        remoteAccess: { pairedDevices: 1 },
        lensShortcut: "Command+Shift+Space",
        preventSleepDuringRuns: true,
        updateReady: "0.11.0",
      }),
      actions(),
      NOW,
    );
    const lines = outline(menu);
    expect(lines.slice(0, 7)).toEqual([
      "# Needs you",
      "Allow Bash?",
      "---",
      "# Running",
      "Hero",
      "# Recently finished",
      "✓ Docs",
    ]);
    expect(lines[8]).toMatch(/^Next pulse: Daily standup · /);
    expect(lines.slice(9)).toEqual([
      "Remote access on · 1 paired device",
      "---",
      "New Chat",
      "Capture Window",
      "Prevent Sleep During Runs",
      "Restart to Update (0.11.0)",
      "---",
      "Show Mains",
      "Quit Mains",
    ]);
    expect(find(menu, "Allow Bash?").sublabel).toBe("Hero");
    expect(find(menu, "Hero").sublabel).toBe("web · 4m");
    expect(find(menu, "Capture Window").accelerator).toBe("Command+Shift+Space");
    expect(find(menu, "Prevent Sleep During Runs").checked).toBe(true);
  });

  it("answers a request from its submenu, or opens the run", () => {
    const act = actions();
    const menu = buildTrayMenu(
      snapshot({
        approvals: [
          { requestId: "req-1", runId: "run-1", title: "Database", runLabel: null, actions: ["SQLite", "Postgres"] },
          { requestId: "req-2", runId: "run-2", title: "Plan ready for review", runLabel: null, actions: [] },
        ],
      }),
      act,
      NOW,
    );

    const choice = submenu(find(menu, "Database"));
    expect(outline(choice)).toEqual(["SQLite", "Postgres", "---", "Open in Mains"]);
    click(find(choice, "Postgres"));
    expect(act.answerApproval).toHaveBeenCalledWith("req-1", 1);

    const plan = submenu(find(menu, "Plan ready for review"));
    expect(outline(plan)).toEqual(["Open in Mains"]);
    click(plan[0]);
    expect(act.openRun).toHaveBeenCalledWith("run-2");
  });

  it("opens or stops a running run, and shows a queued one as queued", () => {
    const act = actions();
    const menu = buildTrayMenu(
      snapshot({
        running: [
          { id: "run-1", label: "Hero", workspaceName: null, startedAt: NOW, queued: false },
          { id: "run-2", label: "Next", workspaceName: null, startedAt: null, queued: true },
        ],
      }),
      act,
      NOW,
    );
    click(find(submenu(find(menu, "Hero")), "Stop"));
    expect(act.stopRun).toHaveBeenCalledWith("run-1");
    click(find(submenu(find(menu, "Hero")), "Open"));
    expect(act.openRun).toHaveBeenCalledWith("run-1");
    expect(find(menu, "Hero").sublabel).toBe("<1m");
    expect(find(menu, "Next").sublabel).toBe("Queued");
  });

  it("marks how a run finished and opens it on click", () => {
    const act = actions();
    const menu = buildTrayMenu(
      snapshot({
        finished: [
          { id: "a", label: "Failed one", status: "failed" },
          { id: "b", label: "Stopped one", status: "canceled" },
        ],
      }),
      act,
      NOW,
    );
    expect(outline(menu).slice(0, 3)).toEqual(["# Recently finished", "✕ Failed one", "■ Stopped one"]);
    click(find(menu, "✕ Failed one"));
    expect(act.openRun).toHaveBeenCalledWith("a");
  });

  it("sends status lines to their pages", () => {
    const act = actions();
    const menu = buildTrayMenu(
      snapshot({
        nextPulse: { title: "Standup", at: NOW + 60_000 },
        remoteAccess: { pairedDevices: 0 },
      }),
      act,
      NOW,
    );
    click(menu.find((item) => item.label?.startsWith("Next pulse"))!);
    click(find(menu, "Remote access on"));
    expect(act.navigate).toHaveBeenNthCalledWith(1, "/pulse");
    expect(act.navigate).toHaveBeenNthCalledWith(2, "/relay");
  });

  it("flips the sleep setting from what the menu showed", () => {
    const act = actions();
    click(find(buildTrayMenu(snapshot(), act, NOW), "Prevent Sleep During Runs"));
    expect(act.setPreventSleep).toHaveBeenCalledWith(true);
  });

  it("clips long run names", () => {
    const menu = buildTrayMenu(
      snapshot({
        running: [{ id: "r", label: "x".repeat(80), workspaceName: null, startedAt: null, queued: false }],
      }),
      actions(),
      NOW,
    );
    expect(menu[1].label).toHaveLength(48);
    expect(menu[1].label!.endsWith("…")).toBe(true);
  });
});

describe("buildDockMenu", () => {
  it("offers a new chat even when nothing is going on", () => {
    expect(outline(buildDockMenu(snapshot(), actions()))).toEqual(["New Chat"]);
  });

  it("lists what needs you, what runs and the recent workspaces — no Show or Quit", () => {
    const menu = buildDockMenu(
      snapshot({
        approvals: [
          { requestId: "req-1", runId: "run-1", title: "Allow Bash?", runLabel: "Hero", actions: ["Allow", "Deny"] },
        ],
        running: [
          { id: "run-1", label: "Hero", workspaceName: "web", startedAt: NOW - 4 * 60_000, queued: false },
        ],
        finished: [{ id: "run-0", label: "Docs", status: "succeeded" }],
        recentWorkspaces: [
          { id: "ws-1", name: "web" },
          { id: "ws-2", name: "api" },
        ],
        updateReady: "0.11.0",
      }),
      actions(),
    );
    expect(outline(menu)).toEqual([
      "Needs you",
      "Allow Bash?",
      "---",
      "Running",
      "Hero",
      "---",
      "Recent Workspaces",
      "web",
      "api",
      "---",
      "New Chat",
    ]);
    // The Dock skips header items, so section titles are greyed rows.
    expect(find(menu, "Running")).toEqual({ label: "Running", enabled: false });
    // Set ahead of time, so no elapsed time that would go stale.
    expect(find(menu, "Hero").sublabel).toBe("web");
  });

  it("opens a workspace, answers a request and stops a run", () => {
    const act = actions();
    const menu = buildDockMenu(
      snapshot({
        approvals: [
          { requestId: "req-1", runId: "run-1", title: "Allow Bash?", runLabel: null, actions: ["Allow", "Deny"] },
        ],
        running: [{ id: "run-1", label: "Hero", workspaceName: null, startedAt: null, queued: false }],
        recentWorkspaces: [{ id: "ws-1", name: "web" }],
      }),
      act,
    );
    click(find(menu, "web"));
    expect(act.openWorkspace).toHaveBeenCalledWith("ws-1");
    click(find(submenu(find(menu, "Allow Bash?")), "Deny"));
    expect(act.answerApproval).toHaveBeenCalledWith("req-1", 1);
    click(find(submenu(find(menu, "Hero")), "Stop"));
    expect(act.stopRun).toHaveBeenCalledWith("run-1");
    click(find(menu, "New Chat"));
    expect(act.newChat).toHaveBeenCalled();
  });
});

describe("menu bar chrome", () => {
  it("counts running runs next to the icon and badges it while something waits", () => {
    const idle = snapshot();
    expect(trayTitle(idle)).toBe("");
    expect(needsAttention(idle)).toBe(false);
    expect(trayTooltip(idle)).toBe("Mains");

    const busy = snapshot({
      running: [
        { id: "a", label: "A", workspaceName: null, startedAt: null, queued: false },
        { id: "b", label: "B", workspaceName: null, startedAt: null, queued: false },
      ],
      approvals: [{ requestId: "r", runId: "a", title: "Allow Bash?", runLabel: null, actions: [] }],
    });
    expect(trayTitle(busy)).toBe("2");
    expect(needsAttention(busy)).toBe(true);
    expect(trayTooltip(busy)).toBe("Mains — 2 running · 1 waiting for you");
  });
});

describe("formatElapsed", () => {
  it("rounds down to minutes and switches to hours", () => {
    expect(formatElapsed(42_000)).toBe("<1m");
    expect(formatElapsed(4 * 60_000 + 59_000)).toBe("4m");
    expect(formatElapsed(60 * 60_000)).toBe("1h");
    expect(formatElapsed(65 * 60_000)).toBe("1h 5m");
    expect(formatElapsed(-5)).toBe("<1m");
  });
});
