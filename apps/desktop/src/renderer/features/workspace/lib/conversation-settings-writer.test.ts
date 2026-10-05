import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@/lib/transport/types";
import { persistConversationSettings, waitForConversationSettings } from "./conversation-settings-writer";

describe("conversation settings writes", () => {
  it("serializes rapid edits to one chat while allowing another chat to save", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const stored = new Map<string, string>();
    const invoke = vi.fn(async (_channel, [id, payload]) => {
      if (payload.conversationSettings.model === "slow") await pending;
      stored.set(id, payload.conversationSettings.model);
      return { success: true, data: null };
    });
    const transport = { invoke } as unknown as Transport;
    const first = persistConversationSettings(transport, "a", { model: "slow", config: {} });
    const last = persistConversationSettings(transport, "a", { model: "last", config: {} });
    let flushed = false;
    const flush = waitForConversationSettings(transport, "a").then(() => { flushed = true; });
    await persistConversationSettings(transport, "b", { model: "other", config: {} });
    expect(stored.get("b")).toBe("other");
    expect(stored.has("a")).toBe(false);
    expect(flushed).toBe(false);
    release();
    await Promise.all([first, last, flush]);
    expect(stored.get("a")).toBe("last");
    expect(flushed).toBe(true);
  });
});
