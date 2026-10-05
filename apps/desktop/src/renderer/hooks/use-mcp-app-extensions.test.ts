// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpAppEntrypoint } from "@mains/contracts/mcp-apps";

const mocks = vi.hoisted(() => ({
  native: true, local: true, providerId: "codex", supported: true,
  currentData: [] as McpAppEntrypoint[], query: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({ useCapabilities: () => ({ mcpAppExtensions: mocks.native }) }));
vi.mock("@/lib/transport", () => ({
  getTransport: () => ({ kind: mocks.local ? "ipc" : "ws" }), onTransportChange: () => () => {},
}));
vi.mock("./use-space-provider-variant", () => ({
  useSpaceProviderVariant: () => ({ providerId: mocks.providerId, supportsMcpAppExtensions: mocks.supported }),
}));
vi.mock("@/lib/redux/api/mcpAppsApi", () => ({
  useGetMcpAppEntrypointsQuery: (...args: unknown[]) => {
    mocks.query(...args);
    return { currentData: mocks.currentData, refetch: mocks.refetch };
  },
}));

import { useMcpAppExtensions } from "./use-mcp-app-extensions";

function entry(id: string, name: string, entrypoints: McpAppEntrypoint["entrypoints"]): McpAppEntrypoint {
  return { id, name, entrypoints, server: "test", tool: "home", resourceUri: "ui://home", preferredModelDisplayMode: "fullscreen" };
}

beforeEach(() => {
  mocks.native = true; mocks.local = true; mocks.providerId = "codex"; mocks.supported = true;
  mocks.currentData = [];
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("rail app inventory", () => {
  it("shows global entrypoints and preserves separate accounts for the same app", () => {
    mocks.currentData = [entry("b", "Canvas", ["global"]), entry("thread", "Thread panel", ["thread"]),
      entry("a", "Canvas", ["global", "thread"]), entry("z", "Another app", ["global"])];
    const { result } = renderHook(useMcpAppExtensions);
    expect(result.current.entries.map((entry) => entry.id)).toEqual(["z", "a", "b"]);
    expect(mocks.currentData.map((entry) => entry.id)).toEqual(["b", "thread", "a", "z"]);
  });

  it.each(["native", "local", "supported"] as const)("skips discovery when %s support is unavailable", (flag) => {
    mocks[flag] = false;
    mocks.currentData = [entry("a", "Canvas", ["global"])];
    const { result } = renderHook(useMcpAppExtensions);
    expect(result.current.entries).toEqual([]);
    expect(mocks.query).toHaveBeenCalledWith("codex", expect.objectContaining({ skip: true }));
  });

  it("refreshes on window focus and removes its listener when unmounted", () => {
    const hook = renderHook(useMcpAppExtensions);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    hook.unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
