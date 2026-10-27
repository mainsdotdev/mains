import path from "node:path";
import { describe, expect, it } from "vitest";
import { desktopUserDataPath } from "./user-data-path";

const appData = path.resolve("application-data");
const profile = path.resolve("isolated profile Türkçe");
const defaults = { appData, isPackaged: true, smokeTest: false };

describe("desktop profile isolation", () => {
  it("keeps the existing canonical directory when no profile is requested", () => {
    expect(desktopUserDataPath(defaults)).toBe(path.join(appData, "mains"));
    expect(desktopUserDataPath({ ...defaults, devPath: profile })).toBe(path.join(appData, "mains"));
  });

  it("honors an explicit packaged profile without using development configuration", () => {
    expect(desktopUserDataPath({ ...defaults, requestedPath: profile, devPath: path.resolve("other") })).toBe(profile);
  });

  it.each(["", "relative/profile"])("rejects unsafe explicit profiles instead of using real data: %j", (requestedPath) => {
    expect(() => desktopUserDataPath({ ...defaults, requestedPath })).toThrow(/absolute directory/);
  });

  it("gives development its own default profile, apart from the installed app's", () => {
    expect(desktopUserDataPath({ ...defaults, isPackaged: false })).toBe(path.join(appData, "mains-dev"));
  });

  it("preserves development profile selection and explicit command-line precedence", () => {
    expect(desktopUserDataPath({ ...defaults, isPackaged: false, devPath: profile })).toBe(profile);
    expect(() => desktopUserDataPath({ ...defaults, isPackaged: false, devPath: "relative" })).toThrow(/absolute directory/);
    expect(desktopUserDataPath({ ...defaults, isPackaged: false, devPath: path.resolve("other"), requestedPath: profile })).toBe(profile);
  });

  it("keeps smoke isolation mandatory even when another profile was supplied", () => {
    expect(() => desktopUserDataPath({ ...defaults, smokeTest: true, requestedPath: profile })).toThrow(/isolated absolute/);
    expect(desktopUserDataPath({ ...defaults, smokeTest: true, requestedPath: profile, smokePath: path.resolve("smoke") })).toBe(path.resolve("smoke"));
  });
});
