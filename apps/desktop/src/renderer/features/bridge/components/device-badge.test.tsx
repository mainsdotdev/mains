// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BridgeBackendInfo } from "@mains/contracts/bridge";
import { DeviceBadge } from "./device-badge";

const backend: BridgeBackendInfo = { backendId: "A", label: "M4 Pro", platform: "darwin", online: true, lastSeen: null };
afterEach(cleanup);

describe("DeviceBadge", () => {
  it("tints the Bridge mark while the device is online", () => {
    const { container, rerender } = render(<DeviceBadge backend={backend} compact />);
    const mark = () => container.querySelector("svg");
    expect(mark()?.classList.contains("text-success")).toBe(true);

    rerender(<DeviceBadge backend={{ ...backend, online: false }} compact />);
    expect(mark()?.classList.contains("text-success")).toBe(false);
  });
});
