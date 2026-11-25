import { describe, expect, it } from "vitest";
import { createRunQueueProjectionStore } from "./run-queue-projection";

describe("pending queue display projection", () => {
  it("shares metadata without acquiring delivery ownership and fences stale removals and expired publishers", () => {
    let now = 1000;
    const store = createRunQueueProjectionStore(() => now);
    const snapshot = { runId: "run", producerId: "desktop", revision: 1,
      messages: [{ id: "one", text: "Still waiting", attachmentNames: ["photo.png"], status: "queued" as const }] };
    store.publish(snapshot);
    expect(store.read("run")[0].messages[0].text).toBe("Still waiting");
    expect(store.read("another")).toEqual([]);
    store.publish({ ...snapshot, revision: 2, messages: [] });
    expect(store.publish(snapshot)).toBe(false);
    expect(store.read("run")).toEqual([]);
    store.publish({ ...snapshot, revision: 3 });
    now += 60_001;
    expect(store.read("run")).toEqual([]);
  });
  it("rejects filesystem references, duplicate ids and unbounded content", () => {
    const store = createRunQueueProjectionStore();
    const snapshot = { runId: "run", producerId: "desktop", revision: 1,
      messages: [{ id: "one", text: "Waiting", attachmentNames: ["/private/photo.png"], status: "queued" as const }] };
    expect(() => store.publish(snapshot)).toThrow();
    snapshot.messages[0].attachmentNames = ["photo.png"];
    expect(() => store.publish({ ...snapshot, messages: [...snapshot.messages, ...snapshot.messages] })).toThrow();
    expect(() => store.publish({ ...snapshot, messages: [{ ...snapshot.messages[0], text: "x".repeat(4097) }] })).toThrow();
  });
});
