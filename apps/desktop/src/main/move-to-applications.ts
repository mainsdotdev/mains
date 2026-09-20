import { app, dialog } from "electron";
import fs from "fs";
import path from "path";

/**
 * Offer to move Mains into /Applications when it runs from anywhere else.
 *
 * Launched from inside the DMG, or from a zip unpacked in Downloads (which
 * macOS "translocates" to a random read-only path), the app can't replace
 * itself — Squirrel's auto-update fails and the user is stuck on the version
 * they downloaded. `app.moveToApplicationsFolder` handles both cases (it finds
 * a translocated app's real location) and relaunches from the new place.
 *
 * Asked before anything else starts, so a move never interrupts a half-booted
 * app. "Don't ask again" is remembered beside the window state.
 */

const PREFS_FILE = "move-to-applications.json";

export interface MoveOfferContext {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  inApplicationsFolder: boolean;
  declined: boolean;
}

export function shouldOfferMove(context: MoveOfferContext): boolean {
  return (
    context.isPackaged &&
    context.platform === "darwin" &&
    !context.inApplicationsFolder &&
    !context.declined
  );
}

function prefsPath(): string {
  return path.join(app.getPath("userData"), PREFS_FILE);
}

function wasDeclined(): boolean {
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath(), "utf-8")) as { declined?: unknown };
    return prefs.declined === true;
  } catch {
    return false;
  }
}

function rememberDeclined(): void {
  try {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), JSON.stringify({ declined: true }));
  } catch {
    // Best-effort: at worst the question comes back next launch.
  }
}

/** Another copy already sits in Applications — replacing it trashes that copy. */
function confirmReplace(conflict: "exists" | "existsAndRunning"): boolean {
  // A running copy takes focus and this one quits; nothing is trashed.
  if (conflict === "existsAndRunning") return true;
  return (
    dialog.showMessageBoxSync({
      type: "question",
      message: "Replace the Mains in Applications?",
      detail: "Another copy of Mains is already in Applications. It will be moved to the Trash.",
      buttons: ["Replace", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    }) === 0
  );
}

/**
 * Ask, and move if the user agrees. Resolves true when the move went through —
 * the app is quitting to relaunch from Applications, so stop booting.
 */
export async function offerMoveToApplications(): Promise<boolean> {
  const offer = shouldOfferMove({
    isPackaged: app.isPackaged,
    platform: process.platform,
    inApplicationsFolder: app.isInApplicationsFolder(),
    declined: wasDeclined(),
  });
  if (!offer) return false;

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    message: "Move Mains to the Applications folder?",
    detail:
      "Mains is running from outside Applications (a disk image or Downloads), " +
      "where it can't update itself. Moving it keeps automatic updates working.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
  });
  if (response !== 0) {
    if (checkboxChecked) rememberDeclined();
    return false;
  }

  try {
    return app.moveToApplicationsFolder({ conflictHandler: confirmReplace });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "Couldn't move Mains",
      `${message}\n\nYou can drag Mains into the Applications folder yourself.`,
    );
    return false;
  }
}
