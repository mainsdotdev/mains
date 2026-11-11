import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "@/lib/transport/types";
import { resetTransport, setTransport } from "@/lib/transport";
import { hasPendingConversationSettings, persistConversationSettings, waitForConversationSettings } from "./conversation-settings-writer";

afterEach(resetTransport);

describe("conversation settings writes", () => {
  it("keeps admitted writes on their original backend while the same run id saves independently elsewhere", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalInvoke = vi.fn(async () => { await gate; return { success: true as const, data: null }; });
    const original: Transport = { kind: "test", invoke: originalInvoke, subscribe: () => () => {}, status: () => "connected", onStatusChange: () => () => {} };
    const replacement = { ...original, invoke: vi.fn(async () => ({ success: true as const, data: null })) };
    setTransport(original);
    const first = persistConversationSettings(original, "run", { model: "first", config: {} });
    const last = persistConversationSettings(original, "run", { model: "last", config: {} });
    try {
      setTransport(replacement);
      await persistConversationSettings(replacement, "run", { model: "remote", config: {} });
      expect(hasPendingConversationSettings(original, "run")).toBe(true);
      expect(hasPendingConversationSettings(replacement, "run")).toBe(false);
    } finally { release(); await Promise.all([first, last]); }
    expect(originalInvoke).toHaveBeenCalledTimes(2);
    expect(originalInvoke).toHaveBeenLastCalledWith(expect.any(String), ["run", { conversationSettings: { model: "last", config: {} } }]);
    expect(replacement.invoke).toHaveBeenCalledTimes(1);
  });
  it("freezes model and config at admission before asynchronous persistence", async () => {
    const invoke = vi.fn(async () => ({ success: true, data: null }));
    const transport = { invoke } as unknown as Transport;
    const settings = { model: "original", config: { fastMode: false } };
    const writing = persistConversationSettings(transport, "run", settings);
    settings.model = "changed"; settings.config.fastMode = true;
    await writing;
    expect(invoke).toHaveBeenCalledWith(expect.any(String), ["run", { conversationSettings: { model: "original", config: { fastMode: false } } }]);
    expect(hasPendingConversationSettings(transport, "run")).toBe(false);
  });
  it("lets a successor recover a failed write before the waiting send proceeds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const invoke = vi.fn(async (_channel, [_id, payload]) => {
      if (payload.conversationSettings.model === "bad") { await gate; return { success: false, error: "write failed" }; }
      return { success: true, data: null };
    });
    const transport = { invoke } as unknown as Transport;
    const failed = persistConversationSettings(transport, "run", { model: "bad", config: {} });
    const refused = expect(failed).rejects.toThrow("write failed");
    const barrier = waitForConversationSettings(transport, "run");
    const retry = persistConversationSettings(transport, "run", { model: "good", config: {} });
    release(); await Promise.all([refused, retry, barrier]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("rejects a failed final barrier and allows an explicit later retry", async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ success: false, error: "not saved" }).mockResolvedValue({ success: true, data: null });
    const transport = { invoke } as unknown as Transport;
    const write = persistConversationSettings(transport, "run", { model: "bad", config: {} });
    await Promise.all([expect(write).rejects.toThrow("not saved"), expect(waitForConversationSettings(transport, "run")).rejects.toThrow("not saved")]);
    await persistConversationSettings(transport, "run", { model: "retry", config: {} });
    expect(hasPendingConversationSettings(transport, "run")).toBe(false);
  });
  it("keeps the send barrier closed for edits admitted while it was already waiting", async () => {
    let releaseFirst!: () => void, releaseLast!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const lastGate = new Promise<void>((resolve) => { releaseLast = resolve; });
    const invoke = vi.fn(async (_channel, [_id, payload]) => {
      await (payload.conversationSettings.model === "first" ? firstGate : lastGate);
      return { success: true, data: null };
    });
    const transport = { invoke } as unknown as Transport;
    const first = persistConversationSettings(transport, "run", { model: "first", config: {} });
    let ready = false;
    const barrier = waitForConversationSettings(transport, "run").then(() => { ready = true; });
    const last = persistConversationSettings(transport, "run", { model: "last", config: {} });
    try {
      releaseFirst();
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
      expect(ready).toBe(false);
    } finally { releaseFirst(); releaseLast(); await Promise.all([first, last, barrier]); }
  });
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
