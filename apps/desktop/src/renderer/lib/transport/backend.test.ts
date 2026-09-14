import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectRemoteBackend,
  disconnectRemoteBackend,
  getActiveRemote,
} from "./backend";
import { getTransport } from "./registry";
import type { WebSocketLike } from "./ws-transport";

function fakeSocket(): WebSocketLike {
  return {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
}

const opts = { factory: () => fakeSocket(), reconnect: false };

describe("remote backend activation", () => {
  afterEach(() => {
    disconnectRemoteBackend();
  });

  it("connect makes a WsTransport the active transport", () => {
    const transport = connectRemoteBackend("ws://test", opts);

    expect(getTransport()).toBe(transport);
    expect(getTransport().kind).toBe("ws");
    expect(getActiveRemote()).toBe(transport);
  });

  it("disconnect returns to the local IPC transport", () => {
    connectRemoteBackend("ws://test", opts);
    disconnectRemoteBackend();

    expect(getTransport().kind).toBe("ipc");
    expect(getActiveRemote()).toBeNull();
  });

  it("reconnecting disposes the previous remote", async () => {
    const first = connectRemoteBackend("ws://a", opts);
    const second = connectRemoteBackend("ws://b", opts);

    expect(first).not.toBe(second);
    expect(getActiveRemote()).toBe(second);
    await expect(first.invoke("x:y")).rejects.toThrow(/disposed/);
  });
});
