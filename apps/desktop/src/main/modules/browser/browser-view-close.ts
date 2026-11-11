import type { WebContents } from "electron";
import { createTabResourceLifecycle } from "../../../shared/tab-resource-lifecycle";

export type BrowserViewCloseResult = "closed" | "prevented" | "timeout" | "failed";
const lifecycles = new WeakMap<WebContents, ReturnType<typeof createTabResourceLifecycle<BrowserViewCloseResult>>>();

/** A tab keeps ownership until Chromium confirms destruction. */
export function closeBrowserView(contents: WebContents): Promise<BrowserViewCloseResult> {
  if (contents.isDestroyed()) return Promise.resolve("closed");
  let lifecycle = lifecycles.get(contents);
  if (!lifecycle) {
    lifecycle = createTabResourceLifecycle((result: BrowserViewCloseResult) => result === "closed");
    lifecycles.set(contents, lifecycle);
  }
  return lifecycle.prepare(contents, () => new Promise<BrowserViewCloseResult>((resolve) => {
    let settled = false;
    const finish = (result: BrowserViewCloseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      contents.removeListener("destroyed", onDestroyed);
      contents.removeListener("will-prevent-unload", onPrevented);
      resolve(result);
    };
    const onDestroyed = () => finish("closed");
    const onPrevented = () => finish("prevented");
    const timer = setTimeout(() => finish(contents.isDestroyed() ? "closed" : "timeout"), 2_000);
    contents.once("destroyed", onDestroyed);
    contents.once("will-prevent-unload", onPrevented);
    try { contents.close({ waitForBeforeUnload: true }); }
    catch { finish("failed"); }
  })).result;
}
