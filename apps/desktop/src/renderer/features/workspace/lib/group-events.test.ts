import { describe, it, expect } from "vitest";
import { groupEvents, reconcileEventGroups } from "./group-events";
import type { RunEvent } from "../types";

function ev(partial: Partial<RunEvent> & { id: string }): RunEvent {
  return {
    type: "artifact",
    content: "",
    timestamp: new Date(partial.id.length * 1000),
    ...partial,
  };
}

/** A user prompt + an agent response + a streamed tail tool call. */
function baseEvents(): RunEvent[] {
  return [
    ev({ id: "u1", type: "artifact", content: "hello", metadata: { kind: "user-prompt" } }),
    ev({ id: "r1", type: "artifact", content: "hi there", metadata: { kind: "report" } }),
    ev({ id: "t1", type: "tool_call", content: "Read: a.ts", metadata: { status: "done" } }),
  ];
}

describe("groupEvents", () => {
  it("merges consecutive image artifacts into one response group", () => {
    const groups = groupEvents([
      ev({ id: "i1", metadata: { kind: "image", path: "/a/1.png" } }),
      ev({ id: "i2", metadata: { kind: "image", path: "/a/2.png" } }),
      ev({ id: "i3", metadata: { kind: "image", path: "/a/3.png" } }),
      ev({ id: "r1", content: "done", metadata: { kind: "report" } }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe("response");
    expect(groups[0].events.map((e) => e.id)).toEqual(["i1", "i2", "i3"]);
    expect(groups[1].events[0].id).toBe("r1");
  });

  it("does not merge image artifacts separated by a text response", () => {
    const groups = groupEvents([
      ev({ id: "i1", metadata: { kind: "image", path: "/a/1.png" } }),
      ev({ id: "r1", content: "and another", metadata: { kind: "report" } }),
      ev({ id: "i2", metadata: { kind: "image", path: "/a/2.png" } }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.events.length)).toEqual([1, 1, 1]);
  });

  it("keeps a stable group id while images stream in, so reconciliation matches", () => {
    const first = groupEvents([
      ev({ id: "i1", metadata: { kind: "image", path: "/a/1.png" } }),
    ]);
    const second = groupEvents([
      ev({ id: "i1", metadata: { kind: "image", path: "/a/1.png" } }),
      ev({ id: "i2", metadata: { kind: "image", path: "/a/2.png" } }),
    ]);
    expect(second[0].id).toBe(first[0].id);
    // Grown group must NOT be reused by reference — the new image has to render.
    const result = reconcileEventGroups(first, second);
    expect(result[0]).not.toBe(first[0]);
    expect(result[0].events).toHaveLength(2);
  });
});

describe("reconcileEventGroups", () => {
  it("returns the same array reference when nothing changed", () => {
    const prev = groupEvents(baseEvents());
    // Re-group an identical event list (fresh objects, same content).
    const next = groupEvents(baseEvents());
    const result = reconcileEventGroups(prev, next);
    expect(result).toBe(prev);
  });

  it("preserves group identity for unchanged groups when one group changes", () => {
    const prev = groupEvents(baseEvents());

    // Append a new tool call (a streamed token arriving) — only the trailing
    // content changes; the user prompt + response groups are untouched.
    const grown = baseEvents();
    grown.push(ev({ id: "t2", type: "tool_call", content: "Edit: a.ts", metadata: { status: "running" } }));
    const next = groupEvents(grown);

    const result = reconcileEventGroups(prev, next);

    expect(result).not.toBe(prev); // array changed (a group was added)
    // user prompt group + response group reused by reference...
    expect(result[0]).toBe(prev[0]);
    expect(result[1]).toBe(prev[1]);
    // ...but the tool group (now holding t1 + t2) is a fresh object.
    expect(result[2]).not.toBe(prev[2]);
  });

  it("does NOT reuse a group whose event content changed (no stale UI)", () => {
    const prev = groupEvents(baseEvents());

    // Same group ids, but the response text grew (streaming into r1).
    const edited = baseEvents();
    edited[1] = ev({ id: "r1", type: "artifact", content: "hi there, more text", metadata: { kind: "report" } });
    const next = groupEvents(edited);

    const result = reconcileEventGroups(prev, next);

    expect(result[0]).toBe(prev[0]); // user prompt unchanged → reused
    expect(result[1]).not.toBe(prev[1]); // response changed → fresh reference
    expect(result[1].events[0].content).toBe("hi there, more text");
  });

  it("does NOT reuse a tool group whose status flipped running → done", () => {
    const running = baseEvents();
    running[2] = ev({ id: "t1", type: "tool_call", content: "Read: a.ts", metadata: { status: "running" } });
    const prev = groupEvents(running);

    const done = baseEvents(); // t1 is "done"
    const next = groupEvents(done);

    const result = reconcileEventGroups(prev, next);
    expect(result[2]).not.toBe(prev[2]);
    expect(result[2].events[0].metadata?.status).toBe("done");
  });

  it("returns next unchanged when there is no previous result", () => {
    const next = groupEvents(baseEvents());
    expect(reconcileEventGroups(null, next)).toBe(next);
    expect(reconcileEventGroups([], next)).toBe(next);
  });
});

describe("groupEvents — subagent machinery stays out of the chat", () => {
  it("drops spawn tool calls — Codex collab variants and Claude's Agent/Task", () => {
    const groups = groupEvents([
      ev({ id: "t1", type: "tool_call", content: "Bash: git status" }),
      ev({ id: "c1", type: "tool_call", content: "spawnAgent: security_review" }),
      ev({ id: "c2", type: "tool_call", content: "waitCollabAgent: security_review" }),
      ev({ id: "c3", type: "tool_call", content: "closeCollabAgent: security_review" }),
      ev({ id: "c4", type: "tool_call", content: "sendCollabMessage: security_review" }),
      ev({ id: "c5", type: "tool_call", content: "followupCollabTask: security_review" }),
      ev({ id: "c6", type: "tool_call", content: "interruptCollabAgent: security_review" }),
      ev({ id: "c7", type: "tool_call", content: "listCollabAgents" }),
      ev({ id: "a1", type: "tool_call", content: "Agent: security review" }),
      ev({ id: "a2", type: "tool_call", content: "Task: audit deps" }),
      ev({ id: "t2", type: "tool_call", content: "Read: a.ts" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.id)).toEqual(["t1", "t2"]);
  });

  it("drops subagent message artifacts from the chat", () => {
    const groups = groupEvents([
      ev({ id: "r1", content: "parent says hi", metadata: { kind: "report" } }),
      ev({
        id: "m1",
        content: "subagent inner monologue",
        metadata: { kind: "report", isFromSubagent: true, parentToolUseId: "item-spawn" },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events[0].id).toBe("r1");
  });

  it("drops a subagent's own tool calls without splitting the accordion", () => {
    const groups = groupEvents([
      ev({ id: "t1", type: "tool_call", content: "Bash: git status" }),
      ev({
        id: "child1",
        type: "tool_call",
        content: "Bash: npm audit",
        metadata: { parentToolCallId: "item-spawn" },
      }),
      ev({
        id: "child2",
        type: "tool_call",
        content: "Read: b.ts",
        metadata: { isFromSubagent: true },
      }),
      ev({ id: "t2", type: "tool_call", content: "Read: a.ts" }),
    ]);

    // One unbroken accordion — dropping children must not flush the group.
    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((e) => e.id)).toEqual(["t1", "t2"]);
  });
});

describe("groupEvents / warning and error logs", () => {
  function shown(level: string, content: string): boolean {
    return groupEvents([ev({ id: "l1", type: "log", content, metadata: { level } })]).some(
      (group) => group.events.some((event) => event.id === "l1"),
    );
  }

  it("shows warnings and errors whatever shape the message takes", () => {
    // Providers tag exactly these with a bracketed prefix — a rate limit, a
    // denied tool, a model refusal — and the shape heuristic below reads a
    // leading "[" as internal chrome, so judging them by prefix hid the whole
    // set. Level decides for these two.
    expect(shown("warn", "[permission] Bash denied — matched deny rule")).toBe(true);
    expect(shown("error", "[model] claude-opus-5 declined and no fallback was available")).toBe(
      true,
    );
    expect(shown("warn", "[rate-limit] Rate limit reached")).toBe(true);
  });

  it("still hides internal chrome", () => {
    expect(shown("start", "[system] Session initialized with model: x")).toBe(false);
    expect(shown("resume", "Resuming session")).toBe(false);
    expect(shown("info", "[context] Conversation compacted (900 → 400 tokens)")).toBe(false);
  });

  it("keeps showing plain info prose", () => {
    expect(shown("info", "Wrote 3 files")).toBe(true);
  });
});
