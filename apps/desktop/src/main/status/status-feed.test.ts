import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../../shared/ipc-kit/channels";
import { clearEventSinks, emit } from "../ipc-kit";
import type { TraySnapshot } from "./status-menus";

const mocks = vi.hoisted(() => ({
  activeRuns: [] as Array<Record<string, unknown>>,
  runsById: new Map<string, Record<string, unknown>>(),
  pending: [] as Array<Record<string, unknown>>,
  workspaces: [] as Array<{ id: string; name: string }>,
}));

vi.mock("../modules/runs", () => ({
  runsService: {
    listActiveRuns: async () => mocks.activeRuns,
    getRunById: async (id: string) => mocks.runsById.get(id) ?? null,
  },
  listPendingApprovals: () => mocks.pending,
  describeApprovalNotification: (req: { toolName: string }) => ({
    title: `Allow ${req.toolName}?`,
    actions: ["Allow", "Deny"],
  }),
  formatRunLabel: (run: { title?: string | null }) => run.title ?? null,
}));
vi.mock("../modules/workspace", () => ({
  workspaceService: { list: async () => mocks.workspaces },
}));
vi.mock("../modules/appSettings", () => ({
  appSettingsService: { getSettings: async () => ({ preventSleepDuringRuns: true }) },
}));
vi.mock("../modules/pulse", () => ({
  pulseService: { getNextScheduled: () => null },
}));
vi.mock("../modules/localBackend", () => ({
  localBackendService: { getStatus: () => ({ remoteAccess: false, tailscale: false }) },
}));
vi.mock("../modules/backend", () => ({
  backendService: { listPairedDevices: async () => [] },
}));
vi.mock("../modules/appshots", () => ({
  appshotsService: { getStatus: () => ({ supported: true, enabled: false, shortcut: "x" }) },
}));
vi.mock("../modules/updates", () => ({
  updatesService: { getStatus: () => ({ status: "idle", info: null }) },
}));

import { refreshStatus, subscribeStatus } from "./status-feed";

/** Let the debounced refresh and its async reads land. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(200);
}

let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.activeRuns = [];
  mocks.runsById = new Map();
  mocks.pending = [];
  mocks.workspaces = [];
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  clearEventSinks();
  vi.useRealTimers();
});

function follow(): TraySnapshot[] {
  const seen: TraySnapshot[] = [];
  unsubscribe = subscribeStatus((snapshot) => seen.push(snapshot));
  return seen;
}

describe("status feed", () => {
  it("reads a snapshot as soon as someone subscribes", async () => {
    mocks.activeRuns = [
      { id: "run-1", title: "Hero", status: "running", startedAt: new Date(1_000), workspace: { name: "web" } },
    ];
    mocks.pending = [{ requestId: "req-1", runId: "run-1", toolName: "Bash" }];
    mocks.workspaces = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `ws-${n}`, name: `ws ${n}` }));

    const seen = follow();
    await settle();

    const latest = seen.at(-1)!;
    expect(latest.running).toEqual([
      { id: "run-1", label: "Hero", workspaceName: "web", startedAt: 1_000, queued: false },
    ]);
    expect(latest.approvals).toEqual([
      { requestId: "req-1", runId: "run-1", title: "Allow Bash?", runLabel: "Hero", actions: ["Allow", "Deny"] },
    ]);
    expect(latest.recentWorkspaces.map((w) => w.id)).toEqual(["ws-1", "ws-2", "ws-3", "ws-4", "ws-5"]);
    expect(latest.preventSleepDuringRuns).toBe(true);
  });

  it("follows run pushes, and remembers the runs that just finished", async () => {
    const seen = follow();
    await settle();
    const before = seen.length;

    mocks.runsById.set("run-9", { title: "Docs" });
    emit(CHANNELS.runs.statusChanged, { runId: "run-9", status: "succeeded" });
    emit(CHANNELS.runs.toolApprovalResolved, { requestId: "x" }); // same burst, one refresh
    await settle();

    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)!.finished).toEqual([{ id: "run-9", label: "Docs", status: "succeeded" }]);
  });

  it("moves a continued run back out of Recently finished", async () => {
    const seen = follow();
    mocks.runsById.set("run-9", { title: "Docs" });
    emit(CHANNELS.runs.statusChanged, { runId: "run-9", status: "failed" });
    await settle();
    expect(seen.at(-1)!.finished).toHaveLength(1);

    emit(CHANNELS.runs.statusChanged, { runId: "run-9", status: "running" });
    await settle();
    expect(seen.at(-1)!.finished).toEqual([]);
  });

  it("ignores pushes it doesn't show", async () => {
    const seen = follow();
    await settle();
    const before = seen.length;
    emit(CHANNELS.runs.ephemeralEvent, { runId: "run-1" });
    await settle();
    expect(seen.length).toBe(before);
  });

  it("stops listening with its last subscriber", async () => {
    const seen = follow();
    await settle();
    unsubscribe?.();
    unsubscribe = null;
    const before = seen.length;

    emit(CHANNELS.runs.statusChanged, { runId: "run-1", status: "succeeded" });
    await vi.advanceTimersByTimeAsync(120_000); // past a heartbeat, too

    expect(seen.length).toBe(before);
  });

  it("hands a fresh snapshot to whoever asks (the tray, opening its menu)", async () => {
    mocks.workspaces = [{ id: "ws-1", name: "web" }];
    await expect(refreshStatus()).resolves.toMatchObject({
      recentWorkspaces: [{ id: "ws-1", name: "web" }],
    });
  });
});
