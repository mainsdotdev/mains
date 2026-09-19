import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(),
    isInApplicationsFolder: vi.fn(),
    moveToApplicationsFolder: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showMessageBoxSync: vi.fn(),
    showErrorBox: vi.fn(),
  },
}));

vi.mock("electron", () => ({ app: mocks.app, dialog: mocks.dialog }));

import { offerMoveToApplications, shouldOfferMove } from "./move-to-applications";

const onMac = process.platform === "darwin";
let userData = "";

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-move-"));
  mocks.app.isPackaged = true;
  mocks.app.getPath.mockReturnValue(userData);
  mocks.app.isInApplicationsFolder.mockReturnValue(false);
  mocks.app.moveToApplicationsFolder.mockReset();
  mocks.dialog.showMessageBox.mockReset();
  mocks.dialog.showMessageBoxSync.mockReset();
  mocks.dialog.showErrorBox.mockReset();
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("shouldOfferMove", () => {
  const base = {
    isPackaged: true,
    platform: "darwin" as const,
    inApplicationsFolder: false,
    declined: false,
  };

  it("offers only a packaged Mac app running outside Applications that wasn't told to stop", () => {
    expect(shouldOfferMove(base)).toBe(true);
    expect(shouldOfferMove({ ...base, isPackaged: false })).toBe(false);
    expect(shouldOfferMove({ ...base, platform: "linux" })).toBe(false);
    expect(shouldOfferMove({ ...base, inApplicationsFolder: true })).toBe(false);
    expect(shouldOfferMove({ ...base, declined: true })).toBe(false);
  });
});

describe.runIf(onMac)("offerMoveToApplications", () => {
  it("moves when the user agrees, and tells the caller to stop booting", async () => {
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
    mocks.app.moveToApplicationsFolder.mockReturnValue(true);

    await expect(offerMoveToApplications()).resolves.toBe(true);
    expect(mocks.app.moveToApplicationsFolder).toHaveBeenCalledTimes(1);
  });

  it("asks nothing in development or once in Applications", async () => {
    mocks.app.isPackaged = false;
    await expect(offerMoveToApplications()).resolves.toBe(false);

    mocks.app.isPackaged = true;
    mocks.app.isInApplicationsFolder.mockReturnValue(true);
    await expect(offerMoveToApplications()).resolves.toBe(false);

    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("asks again next launch after Not Now — unless told not to", async () => {
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
    await expect(offerMoveToApplications()).resolves.toBe(false);
    await expect(offerMoveToApplications()).resolves.toBe(false);
    expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(2);

    mocks.dialog.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: true });
    await offerMoveToApplications();
    await offerMoveToApplications();
    expect(mocks.dialog.showMessageBox).toHaveBeenCalledTimes(3);
    expect(mocks.app.moveToApplicationsFolder).not.toHaveBeenCalled();
  });

  it("confirms before trashing another copy in Applications", async () => {
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
    let answers: boolean[] = [];
    mocks.app.moveToApplicationsFolder.mockImplementation(
      ({ conflictHandler }: { conflictHandler: (c: string) => boolean }) => {
        answers = [conflictHandler("exists"), conflictHandler("existsAndRunning")];
        return false;
      },
    );
    mocks.dialog.showMessageBoxSync.mockReturnValue(1); // Cancel

    await expect(offerMoveToApplications()).resolves.toBe(false);
    // Cancel keeps the existing copy; a running copy just takes over.
    expect(answers).toEqual([false, true]);
    expect(mocks.dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
  });

  it("explains a failed move and keeps launching", async () => {
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
    mocks.app.moveToApplicationsFolder.mockImplementation(() => {
      throw new Error("Failed to copy");
    });

    await expect(offerMoveToApplications()).resolves.toBe(false);
    expect(mocks.dialog.showErrorBox).toHaveBeenCalledWith(
      "Couldn't move Mains",
      expect.stringContaining("Failed to copy"),
    );
  });
});
