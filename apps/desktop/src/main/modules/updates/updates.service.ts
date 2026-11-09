import { app, autoUpdater } from "electron";
import { emit } from "@mains/backend/ipc-kit";
import { CHANNELS } from "@mains/contracts/channels";
import { createUpdateLifecycle } from "../../../shared/update-lifecycle";
import type { UpdateState } from "./updates.dto";

function supportsAutomaticUpdates(): boolean {
  return app.isPackaged && process.platform === "darwin" && !app.getVersion().includes("-");
}
const lifecycle = createUpdateLifecycle((state) => emit(CHANNELS.updates.status, state));
let initialized = false;
let ready: (() => void) | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
const listeners: Array<() => void> = [];

function listen(event: string, callback: (...args: any[]) => void) {
  const events = autoUpdater as NodeJS.EventEmitter;
  events.on(event, callback);
  listeners.push(() => events.removeListener(event, callback));
}
function detach() { for (const off of listeners.splice(0)) off(); }
function start() {
  ready = null;
  if (!lifecycle.active()) return;
  const scope = lifecycle.bind();
  listen("checking-for-update", () => scope.receive({ type: "checking" }));
  listen("update-available", () => scope.receive({ type: "available" }));
  listen("update-not-available", () => scope.receive({ type: "not-available" }));
  listen("update-downloaded", (_event, _notes, version) => scope.receive({ type: "downloaded", info: { version: version || "new version" } }));
  listen("error", (error: Error) => {
    scope.receive({ type: "error", error: error.message || "Update failed" });
  });
  try {
    // Own the feed and timer together so scheduled and explicit checks use the
    // same admission rule. update-electron-app schedules independent checks.
    autoUpdater.setFeedURL({
      url: `https://update.electronjs.org/mainsdotdev/mains/darwin-${process.arch}/${app.getVersion()}`,
      headers: { "User-Agent": `Mains/${app.getVersion()} (darwin: ${process.arch})` },
      serverType: "default",
    });
  } catch (error) {
    scope.close(); detach(); initialized = false;
    lifecycle.receive({ type: "error", error: error instanceof Error ? error.message : "Could not initialize updates" });
    return;
  }
  lifecycle.check(() => autoUpdater.checkForUpdates());
  if (lifecycle.active()) interval = setInterval(() => lifecycle.check(() => autoUpdater.checkForUpdates()), 3600000);
}

export const updatesService = {
  initialize() {
    if (initialized || !lifecycle.active()) return;
    initialized = true;
    if (!supportsAutomaticUpdates()) return;
    if (app.isReady()) start();
    else { ready = start; app.once("ready", ready); }
  },
  async checkForUpdates(): Promise<UpdateState> {
    if (!lifecycle.active()) return lifecycle.snapshot();
    if (!supportsAutomaticUpdates()) { lifecycle.unavailable(); return lifecycle.snapshot(); }
    if (!initialized) { this.initialize(); return lifecycle.snapshot(); }
    if (ready) return lifecycle.snapshot();
    return lifecycle.check(() => autoUpdater.checkForUpdates());
  },
  async downloadUpdate(): Promise<UpdateState> { return lifecycle.snapshot(); },
  quitAndInstall(): null {
    if (!app.isPackaged) throw new Error("Cannot install updates in development mode");
    if (!supportsAutomaticUpdates()) throw new Error("Install the latest release to upgrade this build");
    lifecycle.install(() => autoUpdater.quitAndInstall());
    return null;
  },
  getStatus(): UpdateState { return lifecycle.snapshot(); },
  shutdown() {
    if (!lifecycle.active()) return;
    lifecycle.close();
    if (ready) { app.removeListener("ready", ready); ready = null; }
    if (interval !== null) { clearInterval(interval); interval = null; }
    if (listeners.length) {
      // Native work cannot be canceled. Absorb its late EventEmitter errors
      // until process exit without retaining any projection callbacks.
      const absorb = () => {};
      autoUpdater.on("error", absorb);
      app.once("will-quit", () => autoUpdater.removeListener("error", absorb));
    }
    detach();
  },
};
