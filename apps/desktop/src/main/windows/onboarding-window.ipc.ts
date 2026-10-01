import { ipcMain, type WebContents } from "electron";
import { CHANNELS } from "@mains/contracts/channels";
import { handle } from "@mains/backend/ipc-kit";
import { getMainWindow, setMainWindowOnboarding } from "./mainWindow";

/** Local window chrome only; this handler must never enter the WS registry. */
export function registerOnboardingWindowIpc(): void {
  const setPresentation = handle(async (onboarding: unknown, contentReady: unknown, sender: WebContents) => {
    if (typeof onboarding !== "boolean") throw new Error("Onboarding state must be a boolean");
    if (typeof contentReady !== "boolean") throw new Error("Content readiness must be a boolean");
    if (sender !== getMainWindow()?.webContents) throw new Error("Only the main window can change onboarding");
    await setMainWindowOnboarding(onboarding, contentReady);
    return null;
  });
  ipcMain.handle(CHANNELS.app.setOnboardingWindow, (event, onboarding: unknown, contentReady: unknown = true) =>
    setPresentation(event, onboarding, contentReady, event.sender),
  );
}

export function unregisterOnboardingWindowIpc(): void {
  ipcMain.removeHandler(CHANNELS.app.setOnboardingWindow);
}
