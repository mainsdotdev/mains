import { describe, expect, it, vi } from "vitest";
import type { AtlasPage } from "@mains/contracts/atlas";
import { createPageSaveQueue } from "./page-save-queue";

function page(version = 1, title = "Notes"): AtlasPage {
  return { item: { id: "page", accountId: "default", kind: "page", title, version },
    revision: { version, blocks: [{ type: "paragraph", content: title }] } } as AtlasPage;
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
describe("Page autosave", () => {
  it("retains typing during a save and serializes the next revision", async () => {
    const first = pending<AtlasPage>();
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValueOnce(page(3, "Newer draft"));
    const persist = vi.fn();
    const queue = createPageSaveQueue({ page: page(), save, persist, onState: vi.fn() });
    queue.edit({ title: "First draft", blocks: [] });
    const flushing = queue.flush();
    expect(queue.flush()).toBe(flushing);
    queue.edit({ title: "Newer draft", blocks: [{ type: "paragraph", content: "Still typing" }] });
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve(page(2, "First draft"));
    expect(await flushing).toBe(true);
    expect(save.mock.calls.map(([draft, version]) => [draft.title, version])).toEqual([["First draft", 1], ["Newer draft", 2]]);
    expect(queue.version).toBe(3);
    expect(persist).toHaveBeenLastCalledWith(null, 3);
  });
  it("keeps an interrupted draft and retries from the last confirmed version", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValueOnce(page(2));
    const persist = vi.fn();
    const state = vi.fn();
    const queue = createPageSaveQueue({ page: page(), save, persist, onState: state });
    const draft = { title: "Offline notes", blocks: [] };
    queue.edit(draft);
    expect(await queue.flush()).toBe(false);
    expect(persist).toHaveBeenLastCalledWith(draft, 1);
    expect(state.mock.lastCall?.[0].dirty).toBe(true);
    expect(await queue.flush()).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    expect(await queue.retry()).toBe(true);
    expect(save).toHaveBeenLastCalledWith(draft, 1);
  });
  it("never overwrites a local draft when another editor advances the page", async () => {
    const save = vi.fn().mockResolvedValue(page(3));
    const persist = vi.fn();
    const queue = createPageSaveQueue({ page: page(), save, persist, onState: vi.fn() });
    queue.edit({ title: "My draft", blocks: [] });
    expect(queue.sync(page(2, "Agent changes"))).toBe(false);
    expect(await queue.retry()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(queue.draft.title).toBe("My draft");
    expect(persist.mock.lastCall?.[0].title).toBe("My draft");
    queue.reset(page(2, "Agent changes"));
    queue.edit({ title: "Edited latest", blocks: [] });
    expect(await queue.flush()).toBe(true);
    expect(save).toHaveBeenCalledWith({ title: "Edited latest", blocks: [] }, 2);
  });
  it("applies a newer revision only when the editor has no pending changes", () => {
    const queue = createPageSaveQueue({ page: page(), save: vi.fn(), persist: vi.fn(), onState: vi.fn() });
    expect(queue.sync(page(2, "Updated elsewhere"))).toBe(true);
    expect(queue.version).toBe(2);
    expect(queue.draft.title).toBe("Updated elsewhere");
    expect(queue.sync(page(1))).toBe(false);
  });
});
