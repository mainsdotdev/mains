import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";

const mocks = vi.hoisted(() => ({
  userData: "",
  nativeTheme: { themeSource: "system" as string },
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => mocks.userData },
  nativeTheme: mocks.nativeTheme,
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
}));

import {
  applySavedThemeSource,
  registerThemeSourceIpc,
  setThemeSource,
  unregisterThemeSourceIpc,
} from "./theme-source";

beforeEach(() => {
  mocks.userData = fs.mkdtempSync(path.join(os.tmpdir(), "mains-theme-"));
  mocks.nativeTheme.themeSource = "system";
});

afterEach(() => {
  unregisterThemeSourceIpc();
  fs.rmSync(mocks.userData, { recursive: true, force: true });
});

describe("theme source", () => {
  it("applies the theme and brings it back on the next launch", () => {
    setThemeSource("light");
    expect(mocks.nativeTheme.themeSource).toBe("light");

    mocks.nativeTheme.themeSource = "system"; // a fresh process
    applySavedThemeSource();
    expect(mocks.nativeTheme.themeSource).toBe("light");
  });

  it("follows the system when nothing was saved or the file is garbage", () => {
    applySavedThemeSource();
    expect(mocks.nativeTheme.themeSource).toBe("system");

    fs.writeFileSync(path.join(mocks.userData, "theme-source.json"), "{not json");
    applySavedThemeSource();
    expect(mocks.nativeTheme.themeSource).toBe("system");

    fs.writeFileSync(
      path.join(mocks.userData, "theme-source.json"),
      JSON.stringify({ themeSource: "sepia" }),
    );
    applySavedThemeSource();
    expect(mocks.nativeTheme.themeSource).toBe("system");
  });

  it("takes the renderer's preference over IPC and refuses anything else", async () => {
    registerThemeSourceIpc();
    const invoke = mocks.handlers.get(CHANNELS.app.setThemeSource)!;

    await expect(invoke({}, "dark")).resolves.toEqual({ success: true, data: null });
    expect(mocks.nativeTheme.themeSource).toBe("dark");

    await expect(invoke({}, "sepia")).resolves.toMatchObject({ success: false });
    expect(mocks.nativeTheme.themeSource).toBe("dark");
  });
});
