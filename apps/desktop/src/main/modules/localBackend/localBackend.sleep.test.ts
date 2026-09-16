import { describe, expect, it } from "vitest";
import { shouldKeepRemoteHostAwake } from "./localBackend.sleep";

describe("shouldKeepRemoteHostAwake", () => {
  it("keeps an AC-powered remote host awake", () => {
    expect(
      shouldKeepRemoteHostAwake({
        enabled: true,
        remoteAccess: true,
        tailscale: false,
        onBatteryPower: false,
      }),
    ).toBe(true);
  });

  it("also treats Tailscale HTTPS as remote exposure", () => {
    expect(
      shouldKeepRemoteHostAwake({
        enabled: true,
        remoteAccess: false,
        tailscale: true,
        onBatteryPower: false,
      }),
    ).toBe(true);
  });

  it.each([
    { enabled: false, remoteAccess: true, tailscale: false, onBatteryPower: false },
    { enabled: true, remoteAccess: false, tailscale: false, onBatteryPower: false },
    { enabled: true, remoteAccess: true, tailscale: false, onBatteryPower: true },
  ])("does not block sleep for %o", (state) => {
    expect(shouldKeepRemoteHostAwake(state)).toBe(false);
  });
});
