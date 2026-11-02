import { describe, expect, it } from "vitest";
import { HISTORY_CHECKPOINTS, SESSION_IDLE_MS, SESSION_MAX_MS, continuesSession, historyCheckpoints, historyPrefix } from "./atlas.history";

const NOW = Date.UTC(2026, 9, 22, 12);
const minute = 60_000;
const row = (id: string, minutesAgo: number, actor = "user") => ({ id, actor, createdAt: new Date(NOW - minutesAgo * minute) });
const ids = (rows: { id: string }[]) => rows.map((entry) => entry.id);
const none = new Set<string>();

describe("historyCheckpoints", () => {
  it("keeps only the last revision of each editing session", () => {
    // Newest first: autosaves 30 seconds apart, a long pause, then an earlier session.
    const rows = [row("d", 0), row("c", 0.5), row("b", 1), row("a", 120), row("z", 121)];
    expect(ids(historyCheckpoints(rows, none))).toEqual(["d", "a"]);
  });

  it("treats a pause of the idle threshold as the end of a session", () => {
    const idle = SESSION_IDLE_MS / minute;
    expect(ids(historyCheckpoints([row("b", 0), row("a", idle - 1)], none))).toEqual(["b"]);
    expect(ids(historyCheckpoints([row("b", 0), row("a", idle)], none))).toEqual(["b", "a"]);
  });

  it("starts a new checkpoint when the author changes", () => {
    const rows = [row("user-2", 1), row("agent", 2, "agent"), row("user-1", 3)];
    expect(ids(historyCheckpoints(rows, none))).toEqual(["user-2", "agent", "user-1"]);
  });

  it("cuts a long unbroken session into restore points", () => {
    // One revision a minute for 90 minutes never pauses, but must not collapse to one entry.
    const rows = Array.from({ length: 91 }, (_, index) => row(`m${index}`, index));
    expect(ids(historyCheckpoints(rows, none))).toEqual(["m0", "m30", "m60", "m90"]);
  });

  it("limits the list but never hides a pinned revision", () => {
    // Sessions two hours apart, newest first.
    const rows = Array.from({ length: 15 }, (_, index) => row(`s${index}`, index * 120));
    expect(historyCheckpoints(rows, none)).toHaveLength(HISTORY_CHECKPOINTS);
    const pinned = historyCheckpoints(rows, new Set(["s14"]));
    expect(pinned).toHaveLength(HISTORY_CHECKPOINTS + 1);
    expect(pinned.at(-1)?.id).toBe("s14");
  });

  it("keeps a pinned revision inside a session and anchors the next one to it", () => {
    const rows = [row("c", 0), row("b", 1), row("a", 2)];
    expect(ids(historyCheckpoints(rows, new Set(["b"])))).toEqual(["c", "b"]);
  });

  it("returns nothing for an empty history", () => {
    expect(historyCheckpoints([], none)).toEqual([]);
  });
});

describe("historyPrefix", () => {
  it("drops sessions older than the retained window and keeps autosaves inside it", () => {
    const recent = [row("head", 0), row("mid", 1), row("older-in-session", 2)];
    const keptSessions = Array.from({ length: HISTORY_CHECKPOINTS - 1 }, (_, index) => row(`k${index}`, 120 * (index + 1)));
    const dropped = [row("old", 120 * (HISTORY_CHECKPOINTS + 1)), row("older", 120 * (HISTORY_CHECKPOINTS + 2))];
    const rows = [...recent, ...keptSessions, ...dropped];
    expect(ids(historyPrefix(rows, none))).toEqual(["old", "older"]);
    expect(ids(historyCheckpoints(rows, none))).toEqual(["head", ...keptSessions.map((entry) => entry.id)]);
  });

  it("keeps a pinned revision that sits beyond the window", () => {
    const rows = Array.from({ length: HISTORY_CHECKPOINTS + 2 }, (_, index) => row(`s${index}`, index * 120));
    expect(ids(historyPrefix(rows, new Set(["s11"])))).toEqual(["s10"]);
  });
});

describe("continuesSession", () => {
  const now = new Date(NOW);
  const user = { actor: "user", sourceRunId: null as string | null };
  const head = (startedMinutesAgo: number, author = user) => ({ ...author, createdAt: new Date(NOW - startedMinutesAgo * minute) });
  const wroteAgo = (minutes: number) => new Date(NOW - minutes * minute);

  it("continues for the same author inside the idle and length limits", () => {
    expect(continuesSession(head(5), user, wroteAgo(1), now)).toBe(true);
  });

  it("ends after a pause of the idle threshold", () => {
    const idle = SESSION_IDLE_MS / minute;
    expect(continuesSession(head(15), user, wroteAgo(idle - 1), now)).toBe(true);
    expect(continuesSession(head(15), user, wroteAgo(idle), now)).toBe(false);
  });

  it("ends once the session reaches its maximum length, however active", () => {
    const max = SESSION_MAX_MS / minute;
    expect(continuesSession(head(max - 1), user, wroteAgo(0), now)).toBe(true);
    expect(continuesSession(head(max), user, wroteAgo(0), now)).toBe(false);
  });

  it("does not continue another author's or another run's revision", () => {
    expect(continuesSession(head(1, { actor: "agent", sourceRunId: null }), user, wroteAgo(0), now)).toBe(false);
    expect(continuesSession(head(1, { actor: "user", sourceRunId: "run" }), user, wroteAgo(0), now)).toBe(false);
  });
});
