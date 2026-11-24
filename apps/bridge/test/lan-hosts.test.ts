import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createTestTls, requestTls } from "../../../packages/backend/test/connect-tls";
import WebSocket from "ws";
import { CHANNELS } from "@mains/contracts/channels";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import type { AtlasPage } from "@mains/contracts/atlas";
import type { ServiceResponse } from "@mains/contracts/service-response";
import { startLocalBackends, waitFor } from "./local-backends";

describe.skipIf(process.env.MAINS_BRIDGE_HOST_TESTS !== "1")("Bridge demo over the actual LAN interface", () => {
  it("uses an origin-bound browser cookie to read A's replica on B and sync browser edits back", async () => {
    const tls = createTestTls();
    vi.stubEnv("MAINS_TLS_CERT", tls.certFile);
    vi.stubEnv("MAINS_TLS_KEY", tls.keyFile);
    let fixture: Awaited<ReturnType<typeof startLocalBackends>> | undefined;
    let browser: WebSocket | undefined;
    try {
      fixture = await startLocalBackends({ lan: true });
      const { a, b } = fixture;
      const [origin] = await b.endpoints(); expect(origin).toBeTruthy(); expect(new URL(origin).hostname).not.toBe("127.0.0.1");
      expect(await a.endpoints()).toEqual([]);
      const link = await b.webLogin(origin), code = new URLSearchParams(new URL(link).hash.slice(1)).get("login");
      expect(new URL(link).origin).toBe(origin);
      const login = await requestTls(`${origin}/__mains/web-session`, tls.cert, { method: "POST", headers: { Authorization: `Bearer ${code}`, Origin: origin } });
      expect(login.status).toBe(204);
      const cookie = login.cookies.map((value) => value.split(";")[0]).join("; ");
      const page = await requestTls(origin, tls.cert); expect(page.status).toBe(200); expect(page.body).toContain('id="root"');
      expect((await requestTls(`${origin}/__mains/web-session`, tls.cert, { method: "POST", headers: { Authorization: `Bearer ${code}`, Origin: origin } })).status).toBe(401);
      browser = new WebSocket(`${origin.replace(/^http/, "ws")}/__mains/ws`, buildSubprotocols(), { ca: tls.cert, headers: { Cookie: cookie, Origin: origin } });
      const socket = browser;
      await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
      let next = 0;
      const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { socket.off("message", receive); reject(new Error("LAN browser RPC timed out")); }, 5000);
        const receive = (data: WebSocket.RawData) => {
          const message = JSON.parse(data.toString()) as { kind: string; id: number; result: ServiceResponse<T> };
          if (message.kind !== "response" || message.id !== id) return;
          clearTimeout(timer); socket.off("message", receive);
          if (message.result.success) resolve(message.result.data); else reject(new Error(message.result.error));
        };
        socket.on("message", receive); socket.send(JSON.stringify({ kind: "invoke", id, channel, args, commandId: randomUUID() }));
      });
      const source = await a.client.call<AtlasPage>(CHANNELS.atlas.createPage, { accountId: "default", title: "Mac source", markdown: "From Computer A" });
      await a.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => b.client.call<AtlasPage | null>(CHANNELS.atlas.get, { accountId: "default", id: source.item.id }), (value) => !!value, "source Page on B");
      expect((await invoke<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: source.item.id })).revision.id).toBe(source.revision.id);
      const edited = await invoke<AtlasPage>(CHANNELS.atlas.savePage, { accountId: "default", id: source.item.id, expectedVersion: source.item.version, title: "Edited from LAN browser", markdown: "From iPad protocol" });
      await b.client.call(CHANNELS.bridge.syncNow);
      await waitFor(() => a.client.call<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: source.item.id }), (value) => value.revision.id === edited.revision.id, "browser edit on A");
      await a.stop();
      expect((await invoke<AtlasPage>(CHANNELS.atlas.get, { accountId: "default", id: source.item.id })).revision.id).toBe(edited.revision.id);
    } finally { browser?.terminate(); try { await fixture?.dispose(); } finally { vi.unstubAllEnvs(); tls.dispose(); } }
  }, 60_000);
});
