import { afterEach, describe, expect, it } from "vitest";
import { clearEventSinks, emit, registerEventSink } from "./event-bus";
import type { EventSink } from "./event-bus";

function recordingSink(kind = "test"): EventSink & {
  calls: Array<{ channel: string; payload: unknown; scope: unknown }>;
} {
  const calls: Array<{ channel: string; payload: unknown; scope: unknown }> = [];
  return {
    kind,
    calls,
    send: (channel, payload, scope) => calls.push({ channel, payload, scope }),
  };
}

describe("event bus", () => {
  afterEach(() => {
    clearEventSinks();
  });

  it("is a no-op when no sink is registered", () => {
    expect(() => emit("runs:statusChanged", { runId: "r1" })).not.toThrow();
  });

  it("routes channel, payload, and scope to a registered sink", () => {
    const sink = recordingSink();
    registerEventSink(sink);

    emit("runs:ephemeralEvent", { a: 1 }, { runId: "r1" });

    expect(sink.calls).toEqual([
      { channel: "runs:ephemeralEvent", payload: { a: 1 }, scope: { runId: "r1" } },
    ]);
  });

  it("fans out to every registered sink", () => {
    const a = recordingSink("a");
    const b = recordingSink("b");
    registerEventSink(a);
    registerEventSink(b);

    emit("x:y", 1);

    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it("dedupes the same sink instance", () => {
    const sink = recordingSink();
    registerEventSink(sink);
    registerEventSink(sink);

    emit("x:y", 1);

    expect(sink.calls).toHaveLength(1);
  });

  it("stops delivering to a sink after it unregisters", () => {
    const sink = recordingSink();
    const off = registerEventSink(sink);
    off();

    emit("x:y", 1);

    expect(sink.calls).toHaveLength(0);
  });

  it("clearEventSinks removes all sinks", () => {
    const sink = recordingSink();
    registerEventSink(sink);
    clearEventSinks();

    emit("x:y", 1);

    expect(sink.calls).toHaveLength(0);
  });
});
