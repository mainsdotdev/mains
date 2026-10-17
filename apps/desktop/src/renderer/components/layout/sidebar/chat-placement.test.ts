import { describe, expect, it } from "vitest";
import { placeChats } from "./chat-placement";

const chat = (id: string, collectionId: string | null, extra: { pinnedAt?: string | null; isReplica?: boolean } = {}) =>
  ({ id, collectionId, pinnedAt: extra.pinnedAt ?? null, isReplica: extra.isReplica ?? false });

describe("placeChats", () => {
  it("puts another device's chat in its project when it exists here, otherwise in Recents", () => {
    const runs = [chat("local", "work"), chat("replica-in-project", "work", { isReplica: true }),
      chat("replica-standalone", null, { isReplica: true }), chat("replica-unknown-project", "elsewhere", { isReplica: true })];
    const placed = placeChats(runs, new Set(["work"]));
    expect(placed.byCollection.get("work")?.map((run) => run.id)).toEqual(["local", "replica-in-project"]);
    expect(placed.standalone.map((run) => run.id)).toEqual(["replica-standalone", "replica-unknown-project"]);
    expect(placed.byCollection.has("elsewhere")).toBe(false);
  });

  it("keeps Pinned for this device's own chats and places each chat exactly once", () => {
    const runs = [chat("pinned-local", "work", { pinnedAt: "2026-10-17" }), chat("pinned-replica", "work", { pinnedAt: "2026-10-17", isReplica: true }),
      chat("local-standalone", null)];
    const placed = placeChats(runs, new Set(["work"]));
    expect(placed.pinned.map((run) => run.id)).toEqual(["pinned-local"]);
    expect(placed.byCollection.get("work")?.map((run) => run.id)).toEqual(["pinned-replica"]);
    expect(placed.standalone.map((run) => run.id)).toEqual(["local-standalone"]);
    const all = [...placed.pinned, ...placed.standalone, ...[...placed.byCollection.values()].flat()].map((run) => run.id).sort();
    expect(all).toEqual(runs.map((run) => run.id).sort());
  });
});
