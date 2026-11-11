import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServer } from "./codex-app-server.client";

const fixtureBinary = path.resolve(
  __dirname,
  "../../../../../test/fixtures/fake-codex-app-server.mjs",
);

const servers: CodexAppServer[] = [];

async function startServer(): Promise<CodexAppServer> {
  const server = new CodexAppServer();
  servers.push(server);
  await server.start(fixtureBinary, process.cwd());
  return server;
}

async function initialize(server: CodexAppServer): Promise<void> {
  await server.sendRequest("initialize", {
    clientInfo: {
      name: "mains-client-test",
      title: "Mains Client Test",
      version: "1.0.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
  });
  server.sendNotification("initialized");
}

afterEach(async () => {
  delete process.env.MAINS_CODEX_FIXTURE_HANG_METHOD;
  delete process.env.MAINS_CODEX_FIXTURE_RPC_ERROR;
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("CodexAppServer", () => {
  it.each([
    { code: -32600, data: { type: "modelProviderMismatch", savedProvider: "original" } },
    { code: -32600, data: { reason: "serverShuttingDown" } },
    { code: -32001, data: null },
    { code: -32602, data: undefined },
  ])("preserves native RPC error code and data: %j", async ({ code, data }) => {
    process.env.MAINS_CODEX_FIXTURE_RPC_ERROR = JSON.stringify({ method: "thread/resume", code, data, message: "Native request rejected" });
    const server = await startServer();
    await initialize(server);
    const error = await server.sendRequest("thread/resume", { threadId: "thread" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code, nativeMessage: "Native request rejected", message: `Native request rejected (code: ${code})` });
    expect((error as { data?: unknown }).data).toEqual(data);
    await expect(server.sendRequest("account/read", {})).resolves.toMatchObject({ requiresOpenaiAuth: false });
  });

  it("rejects a failed spawn and can retry with a working binary", async () => {
    const server = new CodexAppServer();
    servers.push(server);

    await expect(server.start(`${fixtureBinary}.missing`, process.cwd()))
      .rejects.toThrow(/ENOENT/);
    expect(server.isRunning).toBe(false);
    await server.start(fixtureBinary, process.cwd());
    await initialize(server);
    expect(server.isRunning).toBe(true);
  });

  it("correlates typed requests with their responses", async () => {
    const server = await startServer();

    const response = await server.sendRequest("initialize", {
      clientInfo: {
        name: "mains-client-test",
        title: "Mains Client Test",
        version: "1.0.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    });

    expect(response).toMatchObject({
      userAgent: "mains-test-codex-app-server",
      codexHome: "/tmp/mains-test-codex-home",
      platformFamily: "unix",
      platformOs: "macos",
    });
  });

  it("routes notifications and server requests through separate handlers", async () => {
    const server = await startServer();
    await initialize(server);

    const foregroundNotifications: string[] = [];
    const backgroundNotifications: string[] = [];
    server.setNotificationHandler((method) => {
      foregroundNotifications.push(method);
    });
    server.setBackgroundHandler((method) => {
      backgroundNotifications.push(method);
    });

    let resolveServerRequest: (() => void) | undefined;
    const serverRequestSeen = new Promise<void>((resolve) => {
      resolveServerRequest = resolve;
    });
    server.setServerRequestHandler((id, method) => {
      expect(method).toBe("currentTime/read");
      server.respondToRequest(id, { currentTime: "2026-07-29T12:00:00Z" });
      resolveServerRequest?.();
    });

    const threadResponse = await server.sendRequest("thread/start", {
      cwd: process.cwd(),
    });
    const threadId = threadResponse.thread.id;

    let resolveTurnCompleted: (() => void) | undefined;
    const turnCompleted = new Promise<void>((resolve) => {
      resolveTurnCompleted = resolve;
    });
    server.setNotificationHandler((method) => {
      foregroundNotifications.push(method);
      if (method === "turn/completed") resolveTurnCompleted?.();
    });

    await server.sendRequest("turn/start", {
      threadId,
      input: [{ type: "text", text: "current time", text_elements: [] }],
    });
    await Promise.all([serverRequestSeen, turnCompleted]);

    expect(foregroundNotifications).toContain("turn/completed");
    expect(backgroundNotifications).toContain("turn/completed");
  });

  it("rejects all pending requests on process exit and can restart cleanly", async () => {
    process.env.MAINS_CODEX_FIXTURE_HANG_METHOD = "model/list";
    const server = await startServer();
    await initialize(server);
    const threadResponse = await server.sendRequest("thread/start", {
      cwd: process.cwd(),
    });
    const threadId = threadResponse.thread.id;

    const pending = expect(server.sendRequest("model/list", {}))
      .rejects.toThrow("Codex app-server exited with code 17");

    await expect(
      server.sendRequest("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text: "crash before response",
            text_elements: [],
          },
        ],
      }),
    ).rejects.toThrow("Codex app-server exited with code 17");
    await pending;
    // exit can precede close; stop joins the remaining process cleanup.
    await server.stop();
    delete process.env.MAINS_CODEX_FIXTURE_HANG_METHOD;
    await server.start(fixtureBinary, process.cwd());
    await initialize(server);
    await expect(server.sendRequest("account/read", {})).resolves.toMatchObject({ requiresOpenaiAuth: false });
  });

  it("times out a request without poisoning later request correlation", async () => {
    process.env.MAINS_CODEX_FIXTURE_HANG_METHOD = "model/list";
    const server = await startServer();
    await initialize(server);

    await expect(
      server.sendRequest("model/list", {}, 20),
    ).rejects.toThrow("RPC timeout: model/list (20ms)");

    delete process.env.MAINS_CODEX_FIXTURE_HANG_METHOD;
    const account = await server.sendRequest("account/read", {});
    expect(account.requiresOpenaiAuth).toBe(false);
  });
});
