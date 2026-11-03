import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { OpenCodeAcpServer } from "./opencode-acp";

describe("OpenCode ACP client", () => {
  it("writes a request and resolves the matching response", async () => {
    const fromAgent = new PassThrough();
    const toAgent = new PassThrough();
    const server = new OpenCodeAcpServer();
    server.attach(fromAgent, toAgent);
    const lines: string[] = [];
    toAgent.on("data", (chunk: Buffer) => lines.push(chunk.toString()));

    const pending = server.sendRequest("initialize", { protocolVersion: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    const request = JSON.parse(lines.join("").trim()) as { id: number; method: string };
    expect(request.method).toBe("initialize");
    fromAgent.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { authMethods: [] } })}\n`);
    await expect(pending).resolves.toEqual({ authMethods: [] });
    await server.stop();
  });

  it("routes a server request to the handler", async () => {
    const fromAgent = new PassThrough();
    const toAgent = new PassThrough();
    const server = new OpenCodeAcpServer();
    server.attach(fromAgent, toAgent);
    const seen: Array<{ id: number | string; method: string }> = [];
    server.setRequestHandler((id, method) => {
      seen.push({ id, method });
      server.respond(id, { outcome: { outcome: "selected", optionId: "once" } });
    });
    fromAgent.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: { sessionId: "ses_1" },
    })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual([{ id: 7, method: "session/request_permission" }]);
    await server.stop();
  });
});
