import { vi } from "vitest";

/** Controls native frame delivery, including a callback already queued before cancellation. */
export function installOverlayFrameClock() {
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  const take = () => { const callbacks = [...pending.values()]; pending.clear(); return callbacks; };
  return { take, flush: () => { for (const callback of take()) callback(0); }, count: () => pending.size };
}
