import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServer } from "./codex-app-server.client";

const fixtureBinary = path.resolve(
  __dirname,
  "../../../../test/fixtures/fake-codex-app-server.mjs",
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
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("CodexAppServer", () => {
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

  it("rejects pending requests when the app-server process exits", async () => {
    const server = await startServer();
    await initialize(server);
    const threadResponse = await server.sendRequest("thread/start", {
      cwd: process.cwd(),
    });
    const threadId = threadResponse.thread.id;

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
