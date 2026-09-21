import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startWsHost, type WsHost } from "./ws-server-host";
import { clearHandlers, registerHandler } from "./handler-registry";
import { emit } from "./event-bus";
import { buildSubprotocols } from "../../shared/ipc-kit/ws-protocol";

const TOKEN = "test-pairing-token";

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) =>
    ws.once("message", (data) => resolve(data.toString())),
  );
}

describe("startWsHost (integration)", () => {
  let host: WsHost | null = null;
  let client: WebSocket | null = null;

  afterEach(async () => {
    if (client && client.readyState === WebSocket.OPEN) client.close();
    client = null;
    if (host) await host.close();
    host = null;
    clearHandlers();
  });

  it("serves invokes and pushes bus events end-to-end", async () => {
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: TOKEN });
    registerHandler("ping:ping", async (_ctx, name) => ({
      success: true,
      data: `pong:${name}`,
    }));

    client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(TOKEN));
    await opened(client);

    // request/response over the wire
    const responsePromise = nextMessage(client);
    client.send(
      JSON.stringify({ kind: "invoke", id: 1, channel: "ping:ping", args: ["x"] }),
    );
    expect(JSON.parse(await responsePromise)).toEqual({
      kind: "response",
      id: 1,
      result: { success: true, data: "pong:x" },
    });

    // event-bus push reaches the connected client
    const eventPromise = nextMessage(client);
    emit("runs:statusChanged", { runId: "r1" });
    expect(JSON.parse(await eventPromise)).toEqual({
      kind: "event",
      channel: "runs:statusChanged",
      payload: { runId: "r1" },
    });
  });

  it("replies with a failure for an unknown channel", async () => {
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: TOKEN });
    client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(TOKEN));
    await opened(client);

    const responsePromise = nextMessage(client);
    client.send(
      JSON.stringify({ kind: "invoke", id: 9, channel: "nope:missing", args: [] }),
    );
    const decoded = JSON.parse(await responsePromise);
    expect(decoded.id).toBe(9);
    expect(decoded.result.success).toBe(false);
  });

  it("refuses to start without a pairing token, loopback included", async () => {
    await expect(startWsHost({ port: 0, host: "127.0.0.1", token: "" })).rejects.toThrow(
      "without a pairing token",
    );
  });

  it("rejects a tokenless handshake on loopback — what any web page would send", async () => {
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: TOKEN });
    client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols());
    const error = await new Promise<string>((resolve) =>
      client!.once("error", (e) => resolve(e.message)),
    );
    expect(error).toBe("Unexpected server response: 401");
  });
});

describe("startWsHost HTTP image proxy", () => {
  let host: WsHost | null = null;

  afterEach(async () => {
    if (host) await host.close();
    host = null;
  });

  const target = encodeURIComponent("https://example.com/a.png");
  const imageFetcher = () =>
    vi.fn(async (_url: string) => new Response("png", { headers: { "content-type": "image/png" } }));

  it("refuses a request without the pairing token before fetching anything", async () => {
    const fetchProxiedImage = imageFetcher();
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: "secret", fetchProxiedImage });
    const base = `http://127.0.0.1:${host.port}/__img?url=${target}`;

    expect((await fetch(base)).status).toBe(401);
    expect((await fetch(`${base}&token=wrong`)).status).toBe(401);
    expect(fetchProxiedImage).not.toHaveBeenCalled();
  });

  it("serves the image with the token, locked against sniffing and script", async () => {
    const fetchProxiedImage = imageFetcher();
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: "secret", fetchProxiedImage });

    const res = await fetch(`http://127.0.0.1:${host.port}/__img?url=${target}&token=secret`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(fetchProxiedImage).toHaveBeenCalledWith("https://example.com/a.png");
  });
});

describe("startWsHost static web UI", () => {
  let host: WsHost | null = null;
  let webRoot: string | null = null;

  afterEach(async () => {
    if (host) await host.close();
    host = null;
    if (webRoot) fs.rmSync(webRoot, { recursive: true, force: true });
    webRoot = null;
  });

  it("serves assets when the web root is a relative path", async () => {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mains-web-root-"));
    fs.mkdirSync(path.join(webRoot, "assets"));
    fs.writeFileSync(path.join(webRoot, "index.html"), "<main>Mains</main>");
    fs.writeFileSync(path.join(webRoot, "assets", "app.js"), "export const ok = true;");

    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: TOKEN,
      webRoot: path.relative(process.cwd(), webRoot),
    });

    const response = await fetch(
      `http://127.0.0.1:${host.port}/assets/app.js`,
    );
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(await response.text()).toBe("export const ok = true;");
  });
});
