import { describe, expect, it, vi } from "vitest";
import { voiceChatPresence } from "./voice-chat-presence";

describe("actual chat visibility", () => {
  it("keeps a newer view visible when an old view unmounts and safely repeats cleanup", () => {
    const changed = vi.fn();
    const unsubscribe = voiceChatPresence.subscribe(changed);
    const hideOld = voiceChatPresence.show("voice");
    const hideNew = voiceChatPresence.show("voice");
    try {
      hideOld();
      expect(voiceChatPresence.getSnapshot().has("voice")).toBe(true);
      const snapshot = voiceChatPresence.getSnapshot();
      hideOld();
      expect(voiceChatPresence.getSnapshot()).toBe(snapshot);
      hideNew();
      expect(voiceChatPresence.getSnapshot().has("voice")).toBe(false);
      expect(changed).toHaveBeenCalledTimes(4);
    } finally { hideOld(); hideNew(); unsubscribe(); }
  });
});
