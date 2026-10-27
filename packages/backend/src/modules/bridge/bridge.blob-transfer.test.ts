import { afterEach, describe, expect, it } from "vitest";
import { createServer, type RequestListener } from "node:http";
import { requestBridgeChunk } from "./bridge.blob-transfer";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function server(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/chunk`;
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Bridge chunk inactivity timeout", () => {
  it("downloads while progress continues beyond the inactivity window", async () => {
    const url = await server(async (_request, response) => {
      for (let i = 0; i < 10 && !response.destroyed; i++) { response.write("part"); await pause(50); }
      response.end();
    });
    const response = await requestBridgeChunk(url, { signal: new AbortController().signal, idleTimeoutMs: 300 });
    expect(await response.text()).toBe("part".repeat(10));
  });
  it("uploads a full chunk to a slow reader beyond the inactivity window", async () => {
    let received = 0;
    const url = await server((request, response) => {
      request.on("data", (bytes: Buffer) => {
        received += bytes.length; request.pause(); setTimeout(() => request.resume(), 20).unref();
      });
      request.on("end", () => response.writeHead(204).end());
    });
    const body = Buffer.alloc(4 * 1024 * 1024, 7);
    const response = await requestBridgeChunk(url, { body, signal: new AbortController().signal, idleTimeoutMs: 300 });
    expect(response.status).toBe(204); expect(received).toBe(body.length);
  });
  it("aborts a stalled body after headers have arrived", async () => {
    const url = await server((_request, response) => { response.writeHead(200); response.write("partial"); });
    const response = await requestBridgeChunk(url, { signal: new AbortController().signal, idleTimeoutMs: 100 });
    await expect(response.text()).rejects.toThrow();
  });
  it("aborts a request with no response and preserves shutdown cancellation", async () => {
    const url = await server(() => {});
    await expect(requestBridgeChunk(url, { signal: new AbortController().signal, idleTimeoutMs: 100 })).rejects.toThrow(/without progress/);
    const abort = new AbortController(), request = requestBridgeChunk(url, { signal: abort.signal });
    abort.abort(); await expect(request).rejects.toThrow(/abort/i);
  });
  it("refuses redirects without requesting the destination", async () => {
    let requests = 0;
    const url = await server((_request, response) => { requests++; response.writeHead(302, { Location: "/other" }).end(); });
    await expect(requestBridgeChunk(url, { signal: new AbortController().signal })).rejects.toThrow(/redirect/);
    expect(requests).toBe(1);
  });
});
