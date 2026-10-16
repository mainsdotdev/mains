import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { CHANNELS } from "@mains/contracts/channels";
import { decodeWsMessage, encodeWsMessage } from "@mains/contracts/ws-protocol";
import { parseBridgeArguments, runBridgeCommand } from "./bridge-cli";

afterEach(() => vi.restoreAllMocks());
describe("Bridge CLI", () => {
  it("validates explicit sign-in/approval choices and keeps recovery secrets out of command-line arguments", () => {
    expect(parseBridgeArguments(["login", "--hub", "https://bridge.example", "--label", "Work", "--local-history", "--data-dir", "/tmp/profile"]))
      .toMatchObject({ hubUrl: "https://bridge.example", label: "Work", includeExisting: false, adminArgs: ["--data-dir", "/tmp/profile"] });
    expect(() => parseBridgeArguments(["login"])).toThrow("--hub");
    expect(() => parseBridgeArguments(["approve", "B"])).toThrow("Compare");
    expect(() => parseBridgeArguments(["confirm"])).toThrow("Compare");
    expect(() => parseBridgeArguments(["approve", "B", "--code", "ABC234"])).toThrow("12-character");
    expect(() => parseBridgeArguments(["confirm", "--code", "ABC234"])).toThrow("12-character");
    expect(() => parseBridgeArguments(["confirm", "--code", "ABCD-EFGH-JKLMA"])).toThrow("12-character");
    expect(() => parseBridgeArguments(["confirm", "--code", "ABCD-EFGH-JKLO"])).toThrow("12-character");
    expect(parseBridgeArguments(["confirm", "--code", "abcd efgh jklm"])).toMatchObject({ action: "confirm", code: "ABCD-EFGH-JKLM" });
    expect(() => parseBridgeArguments(["recover", "secret"])).toThrow("stdin");
    expect(() => parseBridgeArguments(["recovery"])).toThrow("--replace");
    expect(parseBridgeArguments(["local-only", "project", "--on"])).toMatchObject({ localOnly: true, positional: ["project"] });
    expect(parseBridgeArguments(["local-only", "project", "--off"])).toMatchObject({ localOnly: false });
    expect(() => parseBridgeArguments(["local-only", "project"])).toThrow("--on|--off");
    expect(() => parseBridgeArguments(["local-only", "project", "--on", "--off"])).toThrow("once");
  });
  it("uses the running backend’s owner WebSocket and returns public status without opening SQLite", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const channels: string[] = [], protocols: string[] = [];
    server.on("connection", (socket, request) => {
      protocols.push(request.headers["sec-websocket-protocol"] ?? "");
      socket.on("message", (data) => {
        const message = decodeWsMessage(data.toString()); if (message.kind !== "invoke") return;
        channels.push(message.channel);
        socket.send(encodeWsMessage({ kind: "response", id: message.id, result: { success: true, data: { state: "ready", backendId: "B" } } }));
      });
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runBridgeCommand(parseBridgeArguments(["status"]), { controlUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "owner-token" });
      expect(channels).toEqual([CHANNELS.bridge.refreshAuth, CHANNELS.bridge.getStatus]); expect(protocols[0]).toContain("mains");
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"state": "ready"'));
    } finally { for (const socket of server.clients) socket.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("sends explicit key confirmation to the backend instead of starting sync from server approval", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const calls: { channel: string; args: unknown[] }[] = [];
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = decodeWsMessage(data.toString()); if (message.kind !== "invoke") return;
      calls.push({ channel: message.channel, args: message.args });
      socket.send(encodeWsMessage({ kind: "response", id: message.id, result: { success: true, data: undefined } }));
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runBridgeCommand(parseBridgeArguments(["confirm", "--code", "ABCD-EFGH-JKLM"]),
        { controlUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "owner-token" });
      expect(calls).toEqual([{ channel: CHANNELS.bridge.confirmAccountKey, args: ["ABCD-EFGH-JKLM"] }]);
    } finally { for (const socket of server.clients) socket.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it("asks for the approved device's fingerprint without printing the new device's own answer", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    server.on("connection", (socket) => socket.on("message", (data) => {
      const message = decodeWsMessage(data.toString()); if (message.kind !== "invoke") return;
      socket.send(encodeWsMessage({ kind: "response", id: message.id, result: { success: true,
        data: { state: "needs-verification", backendId: "B", accountFingerprint: "ABCD-EFGH-JKLM", login: null } } }));
    }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runBridgeCommand(parseBridgeArguments(["login", "--hub", "https://bridge.example"]),
        { controlUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: "owner-token" });
      const output = log.mock.calls.flat().join("\n");
      expect(output).toContain("on an approved device");
      expect(output).toContain("mains bridge confirm --code <fingerprint-from-approved-device>");
      expect(output).not.toContain("ABCD-EFGH-JKLM");
    } finally { for (const socket of server.clients) socket.terminate(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
