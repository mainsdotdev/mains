import { afterEach, describe, expect, it, vi } from "vitest";
import { IpcTransport } from "./ipc-transport";
import {
  getTransport,
  onTransportChange,
  resetTransport,
  setTransport,
} from "./registry";
import type { MainTransportBridge, Transport } from "./types";

function fakeBridge(): MainTransportBridge & {
  invoke: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
} {
  return {
    invoke: vi.fn(async () => ({ success: true as const, data: 42 })),
    subscribe: vi.fn(() => () => {}),
  };
}

describe("IpcTransport", () => {
  it("delegates invoke to the bridge, passing channel and args array", async () => {
    const bridge = fakeBridge();
    const transport = new IpcTransport(bridge);

    const result = await transport.invoke("runs:execute", ["payload"]);

    expect(bridge.invoke).toHaveBeenCalledWith("runs:execute", ["payload"]);
    expect(result).toEqual({ success: true, data: 42 });
  });

  it("defaults args to an empty array", async () => {
    const bridge = fakeBridge();
    const transport = new IpcTransport(bridge);

    await transport.invoke("account:get");

    expect(bridge.invoke).toHaveBeenCalledWith("account:get", []);
  });

  it("delegates subscribe and returns the bridge's unsubscribe", () => {
    const unsub = vi.fn();
    const bridge: MainTransportBridge = {
      invoke: vi.fn(),
      subscribe: vi.fn(() => unsub),
    };
    const transport = new IpcTransport(bridge);
    const listener = () => {};

    const returned = transport.subscribe("runs:ephemeralEvent", listener);
    returned();

    expect(bridge.subscribe).toHaveBeenCalledWith(
      "runs:ephemeralEvent",
      listener,
    );
    expect(unsub).toHaveBeenCalledOnce();
  });

  it("reports a stable connected status", () => {
    const transport = new IpcTransport(fakeBridge());
    expect(transport.kind).toBe("ipc");
    expect(transport.status()).toBe("connected");
    // Local status never changes; onStatusChange is a no-op unsubscribe.
    expect(() => transport.onStatusChange(() => {})()).not.toThrow();
  });

  it("throws a clear error when no bridge is available", () => {
    const transport = new IpcTransport();
    expect(() => transport.invoke("x:y")).toThrow(/mainTransport is unavailable/);
  });
});

describe("transport registry", () => {
  afterEach(() => {
    resetTransport();
  });

  it("defaults to the local IPC transport", () => {
    expect(getTransport().kind).toBe("ipc");
  });

  it("swaps the active transport and notifies listeners", () => {
    const remote: Transport = {
      kind: "ws",
      invoke: vi.fn(),
      subscribe: vi.fn(),
      status: () => "connected",
      onStatusChange: () => () => {},
    };
    const seen: string[] = [];
    const off = onTransportChange((t) => seen.push(t.kind));

    setTransport(remote);

    expect(getTransport().kind).toBe("ws");
    expect(seen).toEqual(["ws"]);
    off();
  });

  it("does not notify when setting the same transport instance", () => {
    const listener = vi.fn();
    const off = onTransportChange(listener);
    const current = getTransport();

    setTransport(current);

    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = onTransportChange(listener);
    off();

    setTransport(new IpcTransport(fakeBridge()));

    expect(listener).not.toHaveBeenCalled();
  });
});
