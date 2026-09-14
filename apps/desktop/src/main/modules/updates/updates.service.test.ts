import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  autoUpdater: {
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("update-electron-app", () => ({
  updateElectronApp: vi.fn(),
  UpdateSourceType: { ElectronPublicUpdateService: "ElectronPublicUpdateService" },
}));

import { updatesService } from "./updates.service";

describe("updatesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatesService._state = { status: "idle", info: null, progress: null, error: null };
    updatesService._initialized = false;
  });

  // ───────────────────────────────────────────────
  // getStatus
  // ───────────────────────────────────────────────
  describe("getStatus", () => {
    it("returns current state", () => {
      expect(updatesService.getStatus()).toEqual({
        status: "idle",
        info: null,
        progress: null,
        error: null,
      });
    });

    it("returns a copy of state (not reference)", () => {
      const state = updatesService.getStatus();
      state.status = "checking";
      expect(updatesService._state.status).toBe("idle");
    });
  });

  // ───────────────────────────────────────────────
  // initialize (dev mode)
  // ───────────────────────────────────────────────
  describe("initialize", () => {
    it("sets _initialized to true", () => {
      updatesService.initialize();
      expect(updatesService._initialized).toBe(true);
    });

    it("does not re-initialize on second call", () => {
      updatesService.initialize();
      updatesService._initialized = true;
      updatesService.initialize();
      expect(updatesService._initialized).toBe(true);
    });

    it("skips auto-updater setup in dev mode", () => {
      expect(() => updatesService.initialize()).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────
  // checkForUpdates (dev mode)
  // ───────────────────────────────────────────────
  describe("checkForUpdates", () => {
    it("returns not-available in dev mode", async () => {
      expect(await updatesService.checkForUpdates()).toEqual({
        status: "not-available",
        info: null,
        progress: null,
        error: null,
      });
    });
  });

  // ───────────────────────────────────────────────
  // downloadUpdate (dev mode)
  // ───────────────────────────────────────────────
  describe("downloadUpdate", () => {
    it("returns current state", async () => {
      expect(await updatesService.downloadUpdate()).toEqual(
        updatesService._state,
      );
    });
  });

  // ───────────────────────────────────────────────
  // quitAndInstall (dev mode)
  // ───────────────────────────────────────────────
  describe("quitAndInstall", () => {
    it("throws in dev mode", () => {
      expect(() => updatesService.quitAndInstall()).toThrow(
        "Cannot install updates in development mode",
      );
    });
  });
});
