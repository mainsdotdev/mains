import { describe, expect, it, vi } from "vitest";
import { createEditorSaveLifecycle } from "./editor-save-lifecycle";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe("editor save ownership", () => {
  it("keeps edits made during a save dirty and uses the acknowledged baseline for their next save", async () => {
    const first = deferred<{ size: number; mtimeMs: number }>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ size: 6, mtimeMs: 3 });
    const editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write });
    editor.edit("first"); const saving = editor.flush();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    editor.edit("newest"); first.resolve({ size: 5, mtimeMs: 2 }); await saving;
    expect(editor.snapshot()).toMatchObject({ phase: "dirty", draft: "newest" });
    await editor.flush();
    expect(write).toHaveBeenLastCalledWith({ content: "newest", expectedMtimeMs: 2, expectedVersion: undefined });
    expect(editor.snapshot()).toMatchObject({ phase: "saved", draft: "newest" });
    await editor.close();
  });
  it("pauses a failed save while retaining later edits until an explicit retry", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("Disk unavailable")).mockResolvedValue({ size: 6, mtimeMs: 2 });
    const remember = vi.fn(), editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write, remember });
    editor.edit("first"); await editor.flush();
    editor.edit("newest"); await editor.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(editor.snapshot()).toMatchObject({ phase: "error", draft: "newest", error: "Disk unavailable" });
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ draft: "newest" }));
    await editor.retry();
    expect(write).toHaveBeenLastCalledWith({ content: "newest", expectedMtimeMs: 1, expectedVersion: undefined });
    expect(editor.snapshot().phase).toBe("saved"); await editor.close();
  });

  it("retires pending follow-up writes and feedback when the backend changes", async () => {
    const first = deferred<{ size: number; mtimeMs: number }>(), write = vi.fn().mockReturnValue(first.promise), publish = vi.fn();
    const remember = vi.fn(), editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write, publish, remember });
    editor.edit("first"); const saving = editor.flush(); await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    editor.edit("newest"); const follow = editor.flush(); editor.retire();
    first.resolve({ size: 5, mtimeMs: 2 }); await Promise.all([saving, follow]);
    expect(write).toHaveBeenCalledTimes(1); expect(publish).not.toHaveBeenCalled();
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ draft: "newest", baseline: expect.objectContaining({ content: "first" }) }));
    expect(editor.snapshot().phase).toBe("closed");
  });

  it("does not replace a newer draft with an older reload response", async () => {
    const loaded = deferred<{ content: string; size: number; mtimeMs: number }>();
    const editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write: vi.fn().mockRejectedValue(new Error("File changed on disk")), read: () => loaded.promise });
    editor.edit("my draft"); await editor.flush();
    const reloading = editor.reload(); editor.edit("newer draft");
    loaded.resolve({ content: "disk", size: 4, mtimeMs: 2 }); await reloading;
    expect(editor.snapshot().draft).toBe("newer draft");
    expect(editor.snapshot().conflict).toBe(true); await editor.close();
  });

  it("does not lose an explicit save arriving at the previous writer's handoff", async () => {
    const write = vi.fn().mockResolvedValue({ size: 6, mtimeMs: 2 }); let follow: Promise<void> | undefined;
    const editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write, publish() {
      if (write.mock.calls.length === 1) queueMicrotask(() => queueMicrotask(() => { editor.edit("newest"); follow = editor.flush(); }));
    } });
    editor.edit("first"); await editor.flush(); await follow;
    expect(write).toHaveBeenCalledTimes(2);
    expect(editor.snapshot()).toMatchObject({ phase: "saved", draft: "newest" }); await editor.close();
  });

  it("debounces automatic saves to the latest draft", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue({ size: 6, mtimeMs: 2 });
    const editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, write });
    try {
      editor.edit("first"); await vi.advanceTimersByTimeAsync(749); expect(write).not.toHaveBeenCalled();
      editor.edit("newest"); await vi.advanceTimersByTimeAsync(749); expect(write).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(write).toHaveBeenCalledExactlyOnceWith({ content: "newest", expectedMtimeMs: 1, expectedVersion: undefined });
    } finally { await editor.close(); vi.useRealTimers(); }
  });

  it("limits explicit overwrite to one revision and guards subsequent saves with its new baseline", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("File changed on disk")).mockResolvedValue({ size: 6, mtimeMs: 2, version: "accepted-version" });
    const editor = createEditorSaveLifecycle({ content: "initial", mtimeMs: 1, version: "original-version", write });
    editor.edit("mine"); await editor.flush(); await editor.overwrite();
    expect(write).toHaveBeenLastCalledWith({ content: "mine", expectedMtimeMs: undefined, expectedVersion: undefined });
    editor.edit("next"); await editor.flush();
    expect(write).toHaveBeenLastCalledWith({ content: "next", expectedMtimeMs: 2, expectedVersion: "accepted-version" }); await editor.close();
  });

});
