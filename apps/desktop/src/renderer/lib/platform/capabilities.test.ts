import { describe, expect, it } from "vitest";
import { getCapabilities } from "./capabilities";

describe("desktop OS capabilities", () => {
  it("keeps working desktop features and hides unavailable Windows beta features", () => {
    expect(getCapabilities(true, "win32")).toMatchObject({
      nativeDialogs: true, terminal: true, localImages: true, embeddedBrowser: true,
      nativeNotifications: true, windowChrome: true, preventSleep: true,
      dockIcon: false, macWindowChrome: false, appshots: false, openWithApp: false, autoUpdate: false,
    });
    expect(getCapabilities(true, "darwin")).toMatchObject({
      dockIcon: true, macWindowChrome: true, appshots: true, openWithApp: true, autoUpdate: true,
    });
  });
  it("keeps web capabilities independent of the backend host's OS", () => {
    expect(getCapabilities(false, "win32")).toEqual(getCapabilities(false, "darwin"));
  });
});
