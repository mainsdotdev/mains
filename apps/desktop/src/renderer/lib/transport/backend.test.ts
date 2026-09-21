import type { BackendDescriptor } from "@mains/contracts/backend";
import { afterEach, describe, expect, it } from "vitest";
import {
  connectRemoteBackend,
  disconnectRemoteBackend,
  getActiveRemote,
  type RemoteBackendConnection,
} from "./backend";
import { getTransport } from "./registry";
import type { WebSocketLike } from "./ws-transport";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  respond(result: unknown): void {
    const request = JSON.parse(this.sent[0]) as { id: number };
    this.onmessage?.({
      data: JSON.stringify({ kind: "response", id: request.id, result }),
    });
  }
}

const descriptor: BackendDescriptor = {
  backendId: "backend-1",
  name: "devbox",
  appVersion: "0.11.0",
  protocolVersion: 1,
  capabilities: ["runs", "workspace"],
  serverTime: "2026-09-21T10:00:00.000Z",
};

function startConnection(url = "ws://test") {
  const sockets: FakeSocket[] = [];
  const promise = connectRemoteBackend(url, {
    factory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnect: false,
    invokeTimeoutMs: 0,
  });
  return { promise, sockets };
}

async function accept(
  attempt: ReturnType<typeof startConnection>,
  value: BackendDescriptor = descriptor,
): Promise<RemoteBackendConnection> {
  const socket = attempt.sockets[0];
  socket.open();
  expect(JSON.parse(socket.sent[0])).toMatchObject({
    kind: "invoke",
    channel: "backend:describe",
    args: [],
  });
  socket.respond({ success: true, data: value });
  return attempt.promise;
}

describe("remote backend activation", () => {
  afterEach(() => {
    disconnectRemoteBackend();
  });

  it("keeps the local transport active until the backend is verified", async () => {
    const local = getTransport();
    const attempt = startConnection();

    expect(getTransport()).toBe(local);
    const connection = await accept(attempt);

    expect(connection.descriptor).toEqual(descriptor);
    expect(getTransport()).toBe(connection.transport);
    expect(getActiveRemote()).toBe(connection.transport);
    expect(attempt.sockets).toHaveLength(1);
  });

  it("disconnect returns to the local IPC transport", async () => {
    await accept(startConnection());
    disconnectRemoteBackend();

    expect(getTransport().kind).toBe("ipc");
    expect(getActiveRemote()).toBeNull();
  });

  it("does not dispose the current remote until its replacement is verified", async () => {
    const first = await accept(startConnection("ws://a"));
    const secondAttempt = startConnection("ws://b");

    expect(getActiveRemote()).toBe(first.transport);
    expect(first.transport.status()).toBe("connected");

    const second = await accept(secondAttempt, {
      ...descriptor,
      backendId: "backend-2",
      name: "buildbox",
    });

    expect(getActiveRemote()).toBe(second.transport);
    await expect(first.transport.invoke("x:y")).rejects.toThrow(/disposed/);
  });

  it("leaves the current remote untouched when verification is rejected", async () => {
    const current = await accept(startConnection("ws://current"));
    const attempt = startConnection("ws://candidate");
    attempt.sockets[0].open();
    attempt.sockets[0].respond({ success: false, error: "Unauthorized" });

    await expect(attempt.promise).rejects.toThrow(
      "Could not verify this Mains server. Unauthorized",
    );
    expect(getTransport()).toBe(current.transport);
    expect(getActiveRemote()).toBe(current.transport);
    expect(current.transport.status()).toBe("connected");
    expect(attempt.sockets[0].closed).toBe(true);
  });

  it("rejects an incompatible protocol before activation", async () => {
    const local = getTransport();
    const attempt = startConnection();
    attempt.sockets[0].open();
    attempt.sockets[0].respond({
      success: true,
      data: { ...descriptor, protocolVersion: 99 },
    });

    await expect(attempt.promise).rejects.toThrow(
      /Incompatible Mains protocol: server uses v99, this app uses v1/,
    );
    expect(getTransport()).toBe(local);
  });

  it("rejects a non-Mains response before activation", async () => {
    const attempt = startConnection();
    attempt.sockets[0].open();
    attempt.sockets[0].respond({ success: true, data: { name: "not enough" } });

    await expect(attempt.promise).rejects.toThrow(/valid Mains descriptor/);
    expect(getTransport().kind).toBe("ipc");
  });
});
