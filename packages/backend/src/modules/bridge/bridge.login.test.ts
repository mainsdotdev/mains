import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBridgeLoopback } from "./bridge.login";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });

async function loginFixture(received: (token: string) => Promise<void>, failed = vi.fn()) {
  const exchange = vi.fn();
  const hub = createServer((request, response) => {
    exchange(request.url);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ token: "test-login-token" }));
  });
  await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => { hub.close(); hub.closeAllConnections(); });
  const port = (hub.address() as { port: number }).port;
  const listener = await startBridgeLoopback(`http://127.0.0.1:${port}`, received, failed);
  cleanup.push(listener.close);
  const authorize = new URL(listener.url);
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  callback.searchParams.set("state", authorize.searchParams.get("state")!);
  callback.searchParams.set("code", "one-time-login-code");
  return { callback, exchange, failed };
}

describe("Bridge browser callback", () => {
  it("gives repeated redirects the same successful receipt while completing enrollment only once", async () => {
    let entered!: () => void, release!: () => void;
    const receiving = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const received = vi.fn(async () => { entered(); await blocked; });
    const { callback, exchange, failed } = await loginFixture(received);
    const first = fetch(callback);
    await receiving;
    const repeated = fetch(callback);
    // Enrollment includes key creation and can outlast a repeated browser request.
    const timer = setTimeout(release, 100);
    try {
      const responses = await Promise.all([first, repeated]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(await responses[0].text()).toBe(await responses[1].text());
      expect(exchange).toHaveBeenCalledTimes(1);
      expect(received).toHaveBeenCalledExactlyOnceWith("test-login-token");
      expect(failed).not.toHaveBeenCalled();
    } finally { clearTimeout(timer); release(); }
  });

  it("rejects a foreign state or missing code without consuming the real callback", async () => {
    const received = vi.fn(async () => {});
    const { callback, exchange } = await loginFixture(received);
    const foreign = new URL(callback); foreign.searchParams.set("state", "another-login");
    expect((await fetch(foreign)).status).toBe(400);
    const missing = new URL(callback); missing.searchParams.delete("code");
    expect((await fetch(missing)).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect((await fetch(callback)).status).toBe(200);
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("rejects a different authorization code while the accepted callback is pending", async () => {
    let entered!: () => void, release!: () => void;
    const receiving = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { callback, exchange } = await loginFixture(async () => { entered(); await blocked; });
    const first = fetch(callback);
    try {
      await receiving;
      const foreign = new URL(callback); foreign.searchParams.set("code", "different-code");
      expect((await fetch(foreign)).status).toBe(400);
      expect(exchange).toHaveBeenCalledTimes(1);
    } finally { release(); }
    expect((await first).status).toBe(200);
  });
});
