// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "@mains/contracts/channels";
import { useBridgeRun } from "./use-bridge";

const fixture = vi.hoisted(() => ({ backend: "A", enabled: true, invokeA: vi.fn().mockResolvedValue({ success: true }), invokeB: vi.fn().mockResolvedValue({ success: true }) }));
// Independent documents can generate the same React id; their backend leases must differ.
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useId: () => "same-document-local-id" }));
vi.mock("@/lib/redux/api/bridgeApi", () => ({ useGetBridgeStatusQuery: () => ({ data: { enabled: fixture.enabled, runs: [] } }) }));
vi.mock("@/lib/redux/hooks", () => ({ useAppSelector: (select: (value: unknown) => unknown) => select({ backends: { activeBackendId: fixture.backend } }) }));
vi.mock("@/lib/transport", () => ({ getTransport: () => ({ invoke: fixture.backend === "A" ? fixture.invokeA : fixture.invokeB }) }));
afterEach(() => { fixture.backend = "A"; fixture.enabled = true; vi.clearAllMocks(); });

describe("Bridge transcript viewer leases", () => {
  it("gives separate clients distinct leases and releases only the departing viewer", () => {
    const first = renderHook(() => useBridgeRun("run", true)), second = renderHook(() => useBridgeRun("run", true));
    const watches = fixture.invokeA.mock.calls.filter(([channel]) => channel === CHANNELS.bridge.watchRun);
    expect(watches).toHaveLength(2);
    const firstId = watches[0][1][1], secondId = watches[1][1][1];
    expect(firstId).not.toBe(secondId);
    first.unmount();
    expect(fixture.invokeA).toHaveBeenCalledWith(CHANNELS.bridge.unwatchRun, [firstId]);
    expect(fixture.invokeA).not.toHaveBeenCalledWith(CHANNELS.bridge.unwatchRun, [secondId]);
    second.unmount();
  });
  it("releases a watch through its original backend when the selected connection changes", () => {
    const view = renderHook(() => useBridgeRun("run", true));
    const watcherId = fixture.invokeA.mock.calls[0][1][1];
    fixture.backend = "B"; view.rerender();
    expect(fixture.invokeA).toHaveBeenCalledWith(CHANNELS.bridge.unwatchRun, [watcherId]);
    expect(fixture.invokeB).toHaveBeenCalledWith(CHANNELS.bridge.watchRun, ["run", watcherId]);
    view.unmount();
  });
  it("leaves normal source remote control and disabled Bridge without a replica subscription", () => {
    const own = renderHook(() => useBridgeRun("owned-run", false));
    own.unmount(); fixture.enabled = false;
    const disabled = renderHook(() => useBridgeRun("replica-run", true));
    expect(fixture.invokeA).not.toHaveBeenCalled(); disabled.unmount();
  });
});
