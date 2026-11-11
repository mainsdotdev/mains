import { createResourceLifecycle, type ResourceScope } from "../../../../runtime/resource-lifecycle";
import type { CodexAppServer } from "./codex-app-server.client";

/** Owns initialization, crash recovery and explicit shutdown as one operation.
 * Recovery joins the retired child's close before reopening; an explicit close
 * invalidates those waiters so they cannot resurrect the server after shutdown. */
export function createCodexServerLifecycle(isRunning: () => boolean) {
  const resource = createResourceLifecycle<CodexAppServer>("Codex app-server");
  let recovery: Promise<void> | undefined;
  let shutdownRevision = 0;

  function retire(): Promise<void> {
    if (recovery) return recovery;
    const closing = resource.close();
    recovery = closing;
    const clear = () => { if (recovery === closing) recovery = undefined; };
    void closing.then(clear, clear);
    return closing;
  }

  return {
    get ready() { return resource.ready; },
    start(acquire: (scope: ResourceScope) => Promise<CodexAppServer>): Promise<CodexAppServer> {
      // exit may precede close. Both paths must join the same retirement.
      const revision = shutdownRevision;
      if (resource.ready && !isRunning()) retire();
      if (recovery) {
        return recovery.then(() => {
          if (revision !== shutdownRevision) {
            throw new Error("Codex app-server initialization was canceled by close");
          }
          return resource.start(acquire);
        });
      }
      return resource.start(acquire);
    },
    retire,
    close(): Promise<void> {
      shutdownRevision++;
      recovery = undefined;
      return resource.close();
    },
  };
}
