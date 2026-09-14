import { isElectron } from "./platform";

/**
 * Feature availability per platform. Gate UI on capabilities ("can I do X?")
 * rather than on the platform ("am I web?") — components shouldn't care *why* a
 * feature is missing, only *whether* it's there. Platform → capability mapping
 * lives here, in one place.
 */
export interface Capabilities {
  /** Open a URL externally (native shell, or a new browser tab on web). */
  openExternal: boolean;
  /** Reveal a file in Finder. */
  revealInFolder: boolean;
  /** Open a file with a chosen native app (macOS). */
  openWithApp: boolean;
  /** Embedded BrowserView panel. */
  embeddedBrowser: boolean;
  /** Native dialogs (e.g. directory picker). */
  nativeDialogs: boolean;
  /** Signed local-file images (mains-localimg). */
  localImages: boolean;
  /** App auto-update. */
  autoUpdate: boolean;
  /** Window chrome controls (fullscreen, menu-bar icon). */
  windowChrome: boolean;
  /** Keep the host machine awake during runs (local power management). */
  preventSleep: boolean;
  /** OS notifications fired on the host machine. */
  nativeNotifications: boolean;
  /** Interactive terminal (works over WS too). */
  terminal: boolean;
}

const ELECTRON: Capabilities = {
  openExternal: true,
  revealInFolder: true,
  openWithApp: true,
  embeddedBrowser: true,
  nativeDialogs: true,
  localImages: true,
  autoUpdate: true,
  windowChrome: true,
  preventSleep: true,
  nativeNotifications: true,
  terminal: true,
};

const WEB: Capabilities = {
  openExternal: true, // window.open
  revealInFolder: false,
  openWithApp: false,
  embeddedBrowser: false,
  nativeDialogs: false,
  localImages: true, // served over HTTP at /__localimg + /__localdoc
  autoUpdate: false,
  windowChrome: false,
  preventSleep: false,
  nativeNotifications: false,
  terminal: true, // runs on the backend, streamed over WS
};

export const capabilities: Capabilities = isElectron ? ELECTRON : WEB;
