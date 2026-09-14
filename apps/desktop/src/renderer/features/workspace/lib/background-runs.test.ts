import { describe, it, expect } from "vitest";
import type { ActiveRun } from "@/lib/redux/api";
import {
  backgroundRunLabel,
  formatRunElapsed,
  isRunFinished,
  lastActivityLine,
  mergeLingeringRuns,
  resolveRunSpaceTarget,
  runOutcomeLabel,
  selectBackgroundRuns,
} from "./background-runs";

function makeRun(overrides: Partial<ActiveRun> = {}): ActiveRun {
  return {
    id: "r1",
    accountId: "default",
    workspaceId: "ws1",
    collectionId: null,
    spaceId: "space-codex",
    providerId: "codex",
    mode: "developer",
    model: null,
    title: null,
    goal: null,
    status: "running",
    systemPrompt: null,
    configSnapshot: null,
    toolPolicySnapshot: null,
    startedAt: null,
    endedAt: null,
    lastError: null,
    sessionId: null,
    isArchived: false,
    createdAt: 0,
    updatedAt: 0,
    workspace: { id: "ws1", name: "mains" },
    ...overrides,
  };
}

describe("selectBackgroundRuns", () => {
  it("keeps every live run when no workspace page is on screen", () => {
    const runs = [makeRun({ id: "r1" }), makeRun({ id: "r2" })];

    const result = selectBackgroundRuns({
      activeRuns: runs,
      visibleWorkspaceId: null,
      visibleProviderId: "codex",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result.map((run) => run.id)).toEqual(["r1", "r2"]);
  });

  it("drops the run the page is showing", () => {
    const result = selectBackgroundRuns({
      activeRuns: [makeRun({ id: "r1", workspaceId: "ws1" })],
      visibleWorkspaceId: "ws1",
      visibleProviderId: "codex",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result).toEqual([]);
  });

  it("drops it even without a space on the run", () => {
    // Runs carried no spaceId until recently; matching on space would have
    // backgrounded the very run the user was watching.
    const result = selectBackgroundRuns({
      activeRuns: [makeRun({ id: "r1", spaceId: null })],
      visibleWorkspaceId: "ws1",
      visibleProviderId: "codex",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result).toEqual([]);
  });

  it("keeps a same-workspace run driven by another provider", () => {
    // The page shows one agent's runs at a time, so the Codex run has no tab
    // while the Claude space renders the same workspace.
    const result = selectBackgroundRuns({
      activeRuns: [makeRun({ id: "r1", providerId: "codex" })],
      visibleWorkspaceId: "ws1",
      visibleProviderId: "claude_code",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result.map((run) => run.id)).toEqual(["r1"]);
  });

  it("keeps runs from other workspaces", () => {
    const result = selectBackgroundRuns({
      activeRuns: [makeRun({ id: "r1", workspaceId: "ws2" })],
      visibleWorkspaceId: "ws1",
      visibleProviderId: "codex",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result.map((run) => run.id)).toEqual(["r1"]);
  });

  it("drops the workspace-less run addressed by the run route", () => {
    const result = selectBackgroundRuns({
      activeRuns: [
        makeRun({ id: "work-run", workspaceId: null, mode: "work" }),
      ],
      visibleWorkspaceId: null,
      visibleProviderId: "codex",
      visibleMode: "work",
      visibleRunId: "work-run",
    });

    expect(result).toEqual([]);
  });

  it("keeps a same-provider Workspace run from another mode", () => {
    const result = selectBackgroundRuns({
      activeRuns: [makeRun({ id: "work-run", mode: "work" })],
      visibleWorkspaceId: "ws1",
      visibleProviderId: "codex",
      visibleMode: "developer",
      visibleRunId: null,
    });

    expect(result.map((run) => run.id)).toEqual(["work-run"]);
  });
});

describe("mergeLingeringRuns", () => {
  it("keeps a finished run alongside the live ones, in creation order", () => {
    const live = [makeRun({ id: "live", createdAt: 200 })];
    const held = [makeRun({ id: "held", createdAt: 100, status: "succeeded" })];

    expect(mergeLingeringRuns(live, held).map((run) => run.id)).toEqual([
      "held",
      "live",
    ]);
  });

  it("drops the held copy once the backend reports the run live again", () => {
    const live = [makeRun({ id: "r1", status: "running" })];
    const held = [makeRun({ id: "r1", status: "canceled" })];

    const result = mergeLingeringRuns(live, held);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("running");
  });

  it("returns the live list untouched when nothing is held", () => {
    const live = [makeRun({ id: "r1" })];

    expect(mergeLingeringRuns(live, [])).toBe(live);
  });
});

describe("isRunFinished / runOutcomeLabel", () => {
  it("treats only terminal statuses as finished", () => {
    expect(isRunFinished(makeRun({ status: "running" }))).toBe(false);
    expect(isRunFinished(makeRun({ status: "queued" }))).toBe(false);
    expect(isRunFinished(makeRun({ status: "succeeded" }))).toBe(true);
    expect(isRunFinished(makeRun({ status: "failed" }))).toBe(true);
    expect(isRunFinished(makeRun({ status: "canceled" }))).toBe(true);
  });

  it("names each outcome", () => {
    expect(runOutcomeLabel(makeRun({ status: "succeeded" }))).toBe("Done");
    expect(runOutcomeLabel(makeRun({ status: "failed" }))).toBe("Failed");
    expect(runOutcomeLabel(makeRun({ status: "canceled" }))).toBe("Stopped");
    expect(runOutcomeLabel(makeRun({ status: "running" }))).toBe("");
  });
});

describe("resolveRunSpaceTarget", () => {
  const spaces = [
    { id: "claude", providerId: "claude_code", mode: "developer" as const },
    { id: "codex", providerId: "codex", mode: "developer" as const },
    { id: "codex-review", providerId: "codex", mode: "developer" as const },
  ];

  it("prefers the space the run was started in", () => {
    const run = makeRun({ spaceId: "codex-review", providerId: "codex" });

    expect(resolveRunSpaceTarget(run, spaces, "claude")).toEqual({
      spaceId: "codex-review",
      modeSwitch: null,
    });
  });

  it("falls back to a space driving the run's provider", () => {
    // The case that made clicking a card land on the wrong run: no space on
    // the run, so the jump has to find one that can actually show it.
    const run = makeRun({ spaceId: null, providerId: "claude_code" });

    expect(resolveRunSpaceTarget(run, spaces, "codex")).toEqual({
      spaceId: "claude",
      modeSwitch: null,
    });
  });

  it("stays in the active space when it already drives the provider", () => {
    const run = makeRun({ spaceId: null, providerId: "codex" });

    expect(resolveRunSpaceTarget(run, spaces, "codex-review")).toEqual({
      spaceId: "codex-review",
      modeSwitch: null,
    });
  });

  it("ignores a space the run names but that no longer exists", () => {
    const run = makeRun({ spaceId: "archived", providerId: "codex" });

    expect(resolveRunSpaceTarget(run, spaces, "claude")).toEqual({
      spaceId: "codex",
      modeSwitch: null,
    });
  });

  it("returns null when no space drives the provider", () => {
    const run = makeRun({ spaceId: null, providerId: "cursor" });

    expect(resolveRunSpaceTarget(run, spaces, "claude")).toBeNull();
  });

  it("switches the run's own space back to the mode it ran under", () => {
    // The space picker rewrites `mode` in place, so a Chat run's own space is
    // in Developer the moment the user flips back — without the switch its
    // card is unopenable, which is what "No space is set up" used to mean.
    const run = makeRun({ spaceId: "codex", providerId: "codex", mode: "chat" });

    expect(resolveRunSpaceTarget(run, spaces, "claude")).toEqual({
      spaceId: "codex",
      modeSwitch: "chat",
    });
  });

  it("prefers a space already in the run's mode over switching one", () => {
    const inChat = [
      ...spaces,
      { id: "codex-chat", providerId: "codex", mode: "chat" as const },
    ];
    const run = makeRun({ spaceId: "codex", providerId: "codex", mode: "chat" });

    expect(resolveRunSpaceTarget(run, inChat, "codex")).toEqual({
      spaceId: "codex-chat",
      modeSwitch: null,
    });
  });

  it("switches the active space when the run names none", () => {
    const run = makeRun({ spaceId: null, providerId: "codex", mode: "work" });

    expect(resolveRunSpaceTarget(run, spaces, "codex")).toEqual({
      spaceId: "codex",
      modeSwitch: "work",
    });
  });
});

describe("backgroundRunLabel", () => {
  it("prefers the generated title", () => {
    expect(backgroundRunLabel(makeRun({ title: "Fix auth loop" }))).toBe(
      "Fix auth loop",
    );
  });

  it("falls back to the goal's first non-empty line", () => {
    expect(backgroundRunLabel(makeRun({ goal: "\n\nRefactor sync\nmore" }))).toBe(
      "Refactor sync",
    );
  });

  it("names an untitled run rather than rendering blank", () => {
    expect(backgroundRunLabel(makeRun({ title: "   ", goal: null }))).toBe(
      "Untitled run",
    );
  });
});

describe("formatRunElapsed", () => {
  it("counts from startedAt", () => {
    expect(formatRunElapsed(makeRun({ startedAt: 0 }), 45_000)).toBe("45s");
    expect(formatRunElapsed(makeRun({ startedAt: 0 }), 134_000)).toBe("2m 14s");
    expect(formatRunElapsed(makeRun({ startedAt: 0 }), 4_020_000)).toBe("1h 07m");
  });

  it("falls back to createdAt for a queued run that never started", () => {
    const run = makeRun({ status: "queued", startedAt: null, createdAt: 1_000 });

    expect(formatRunElapsed(run, 6_000)).toBe("5s");
  });

  it("never reports negative time from a clock skew", () => {
    expect(formatRunElapsed(makeRun({ startedAt: 10_000 }), 0)).toBe("0s");
  });

  it("freezes at endedAt, so a held card shows how long the run took", () => {
    const run = makeRun({ startedAt: 0, endedAt: 74_000, status: "succeeded" });

    // Five minutes later the label still reads the run's own duration.
    expect(formatRunElapsed(run, 374_000)).toBe("1m 14s");
  });

  it("accepts the Date the transports actually deliver", () => {
    // Both IPC paths revive these columns as Date objects, whatever the type
    // declaration says.
    const run = makeRun({ startedAt: new Date(0) as unknown as number });

    expect(formatRunElapsed(run, 90_000)).toBe("1m 30s");
  });
});

describe("lastActivityLine", () => {
  it("returns the last non-empty line of a streamed chunk", () => {
    expect(lastActivityLine("reading files\nrunning tests\n\n")).toBe(
      "running tests",
    );
  });

  it("truncates a very long line", () => {
    const line = lastActivityLine("x".repeat(200))!;

    expect(line).toHaveLength(121);
    expect(line.endsWith("…")).toBe(true);
  });

  it("returns null for an empty chunk", () => {
    expect(lastActivityLine("   \n\n")).toBeNull();
  });
});
