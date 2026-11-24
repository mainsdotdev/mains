import { expect, it, vi } from "vitest";
import WebSocket from "ws";
import { buildSubprotocols } from "@mains/contracts/ws-protocol";
import { createTestTls, requestTls } from "../../test/connect-tls";
import { startWsHost } from "./ws-server-host";

it("requires a certificate and key before binding a network listener", async () => {
  vi.stubEnv("MAINS_TLS_CERT", "");
  vi.stubEnv("MAINS_TLS_KEY", "");
  try {
    await expect(startWsHost({ host: "192.0.2.1", port: 0, token: "test" })).rejects.toThrow(/TLS/);
  } finally { vi.unstubAllEnvs(); }
});

it("serves authenticated WSS and HTTPS while keeping the local control socket available", async () => {
  const tls = createTestTls(), token = "disposable-owner";
  // Use the expanded IPv6 address as an explicit TLS bind on this machine.
  // The ordinary local control server occupies 127.0.0.1 on the same port.
  try {
    const host = await startWsHost({ host: "0:0:0:0:0:0:0:1", port: 0, tls, token });
    try {
      const address = "[::1]:" + host.port;
      expect((await requestTls("https://" + address, tls.cert)).status).toBe(426);
      await expect(fetch("https://" + address)).rejects.toThrow();
      await expect(fetch("http://" + address)).rejects.toThrow();
      expect((await fetch("http://127.0.0.1:" + host.port)).status).toBe(426);
      const ws = new WebSocket("wss://" + address, buildSubprotocols(token), { ca: tls.cert });
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      ws.terminate();
    } finally { await host.close(); }
  } finally { tls.dispose(); }
});
