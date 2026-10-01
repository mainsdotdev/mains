export {
  createMainWindow,
  getMainWindow,
  reopenMainWindow,
  type MainWindowOptions,
} from "./mainWindow";

export {
  createSplashWindow,
  closeSplashWindow,
  getSplashWindow,
  type SplashWindowOptions,
} from "./splashWindow";

export { openAboutWindow, getAboutWindow } from "./aboutWindow";

export { watchChildProcesses } from "./crash-recovery";

export {
  registerOnboardingWindowIpc,
  unregisterOnboardingWindowIpc,
} from "./onboarding-window.ipc";

export {
  applySavedThemeSource,
  registerThemeSourceIpc,
  unregisterThemeSourceIpc,
} from "./theme-source";

export {
  applySavedDockIcon,
  registerDockIconIpc,
  unregisterDockIconIpc,
} from "./dock-icon";

export {
  requestWindow,
  consumeWindowRequest,
  registerWindowRequestIpc,
  unregisterWindowRequestIpc,
} from "./window-requests";
