import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startWsHost, type WsHost } from "./ws-server-host";
import { clearHandlers, registerHandler } from "./handler-registry";
import { emit } from "./event-bus";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";

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

/** Send a tokenless upgrade with a raw request target; resolve the status line. */
function rawUpgrade(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString();
    });
    socket.on("close", () => resolve(response.split("\r\n")[0]));
    socket.on("error", reject);
  });
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

  it("refuses to start without an owner token, loopback included", async () => {
    await expect(startWsHost({ port: 0, host: "127.0.0.1", token: "" })).rejects.toThrow(
      "without an owner token",
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

  it("rejects an unparseable request target without taking the host down", async () => {
    host = await startWsHost({ port: 0, host: "127.0.0.1", token: TOKEN });

    // `new URL("//", base)` throws; this once crashed the process unauthenticated.
    for (const target of ["//", "//evil.example/__mains/ws", "/__mains/ws?x=1"]) {
      expect(await rawUpgrade(host.port, target)).toBe("HTTP/1.1 401 Unauthorized");
    }

    client = new WebSocket(`ws://127.0.0.1:${host.port}`, buildSubprotocols(TOKEN));
    await opened(client);
  });
});

describe("startWsHost browser sessions and HTTP image proxy", () => {
  let host: WsHost | null = null;
  let webRoot: string | null = null;

  afterEach(async () => {
    if (host) await host.close();
    host = null;
    if (webRoot) fs.rmSync(webRoot, { recursive: true, force: true });
    webRoot = null;
  });

  const target = encodeURIComponent("https://example.com/a.png");
  const imageFetcher = () =>
    vi.fn(async (_url: string) => new Response("png", { headers: { "content-type": "image/png" } }));

  async function startBrowserHost(fetchProxiedImage = imageFetcher()) {
    webRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mains-web-session-"));
    fs.writeFileSync(path.join(webRoot, "index.html"), "<main>Mains</main>");
    host = await startWsHost({
      port: 0,
      host: "127.0.0.1",
      token: "secret",
      webRoot,
      fetchProxiedImage,
    });
    return { host, fetchProxiedImage };
  }

  async function exchangeLogin(
    currentHost: WsHost,
    origin = `http://127.0.0.1:${currentHost.port}`,
  ): Promise<Response> {
    const login = currentHost.createWebLogin(origin);
    const code = new URLSearchParams(new URL(login.link).hash.slice(1)).get("login");
    return fetch(`http://127.0.0.1:${currentHost.port}/__mains/web-session`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${code}`,
        Origin: origin,
      },
    });
  }

  function cookies(res: Response): string[] {
    return (res.headers.get("set-cookie") ?? "")
      .split(/,(?=\s*mains_)/)
      .map((value) => value.trim());
  }

  function cookiePair(values: string[], prefix: string): string {
    return (values.find((value) => value.startsWith(prefix)) ?? "").split(";")[0];
  }

  it("spends a login code for scoped HttpOnly cookies", async () => {
    const { host: currentHost } = await startBrowserHost();
    const origin = `http://127.0.0.1:${currentHost.port}`;
    const login = currentHost.createWebLogin(origin);
    const code = new URLSearchParams(new URL(login.link).hash.slice(1)).get("login");

    const wrongOrigin = await fetch(
      `http://127.0.0.1:${currentHost.port}/__mains/web-session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${code}`,
          Origin: "http://other.example",
        },
      },
    );
    expect(wrongOrigin.status).toBe(401);

    const res = await fetch(
      `http://127.0.0.1:${currentHost.port}/__mains/web-session`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${code}`, Origin: origin },
      },
    );
    expect(res.status).toBe(204);
    const issued = cookies(res);
    expect(issued).toHaveLength(2);
    expect(issued).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^mains_web_[\w-]+=[\w-]+; Path=\/__mains;/),
        expect.stringMatching(/^mains_img_[\w-]+=[\w-]+; Path=\/__img;/),
      ]),
    );
    for (const cookie of issued) {
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).not.toContain("secret");
      expect(cookie).not.toContain("Secure");
    }

    const reused = await fetch(
      `http://127.0.0.1:${currentHost.port}/__mains/web-session`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${code}`, Origin: origin },
      },
    );
    expect(reused.status).toBe(401);
  });

  it("mints browser logins only through the owner-authenticated admin route", async () => {
    const { host: currentHost } = await startBrowserHost();
    const origin = `http://127.0.0.1:${currentHost.port}`;
    const endpoint = `${origin}/__mains/admin/web-login`;

    const unauthenticated = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: origin }),
    });
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseUrl: origin }),
    });
    expect(response.status).toBe(200);
    const login = (await response.json()) as {
      link: string;
      expiresAt: string;
    };
    expect(login.link).toMatch(
      new RegExp(`^${origin.replace(/\./g, "\\.")}/#login=[\\w-]+$`),
    );
    expect(Number.isNaN(Date.parse(login.expiresAt))).toBe(false);
    expect(login.link).not.toContain("secret");
  });

  it("refuses a request without the image cookie before fetching anything", async () => {
    const fetchProxiedImage = imageFetcher();
    const { host: currentHost } = await startBrowserHost(fetchProxiedImage);
    const base = `http://127.0.0.1:${currentHost.port}/__img?url=${target}`;

    expect((await fetch(base)).status).toBe(401);
    // The owner token itself is no longer an asset-URL credential.
    expect((await fetch(`${base}&token=secret`)).status).toBe(401);
    expect(
      (await fetch(base, { headers: { Cookie: "mains_img_foreign=bogus" } }))
        .status,
    ).toBe(401);
    expect(fetchProxiedImage).not.toHaveBeenCalled();
  });

  it("serves the image with the cookie, locked against sniffing and script", async () => {
    const fetchProxiedImage = imageFetcher();
    const { host: currentHost } = await startBrowserHost(fetchProxiedImage);
    const exchanged = await exchangeLogin(currentHost);
    const cookie = cookiePair(cookies(exchanged), "mains_img_");

    const res = await fetch(`http://127.0.0.1:${currentHost.port}/__img?url=${target}`, {
      headers: {
        Cookie: `unrelated=1; ${cookie}`,
        Referer: `http://127.0.0.1:${currentHost.port}/`,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(fetchProxiedImage).toHaveBeenCalledWith("https://example.com/a.png");

    const otherPort = await fetch(
      `http://127.0.0.1:${currentHost.port}/__img?url=${target}`,
      {
        headers: {
          Cookie: cookie,
          Referer: "http://127.0.0.1:9999/",
        },
      },
    );
    expect(otherPort.status).toBe(401);
  });

  it("accepts a web session cookie only from the login link's origin", async () => {
    const { host: currentHost } = await startBrowserHost();
    const origin = `http://127.0.0.1:${currentHost.port}`;
    const exchanged = await exchangeLogin(currentHost, origin);
    const sessionCookie = cookiePair(cookies(exchanged), "mains_web_");

    const browser = new WebSocket(
      `ws://127.0.0.1:${currentHost.port}/__mains/ws`,
      buildSubprotocols(),
      { headers: { Cookie: sessionCookie, Origin: origin } },
    );
    await opened(browser);
    browser.close();

    const wrongPath = new WebSocket(
      `ws://127.0.0.1:${currentHost.port}/`,
      buildSubprotocols(),
      { headers: { Cookie: sessionCookie, Origin: origin } },
    );
    const wrongPathError = await new Promise<string>((resolve) =>
      wrongPath.once("error", (reason) => resolve(reason.message)),
    );
    expect(wrongPathError).toBe("Unexpected server response: 401");

    const crossOrigin = new WebSocket(
      `ws://127.0.0.1:${currentHost.port}/__mains/ws`,
      buildSubprotocols(),
      {
        headers: {
          Cookie: sessionCookie,
          Origin: "http://attacker.example",
        },
      },
    );
    const error = await new Promise<string>((resolve) =>
      crossOrigin.once("error", (reason) => resolve(reason.message)),
    );
    expect(error).toBe("Unexpected server response: 401");
  });

  it("marks cookies Secure when the login link is HTTPS", async () => {
    const { host: currentHost } = await startBrowserHost();
    const exchanged = await exchangeLogin(currentHost, "https://mains.example");
    expect(cookies(exchanged)).toHaveLength(2);
    for (const cookie of cookies(exchanged)) expect(cookie).toContain("; Secure");
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
