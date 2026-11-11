import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexAppServer } from "./codex-app-server.client";
import { createCodexCapabilities } from "./codex-capabilities";

const fixtureBinary = path.resolve(
  __dirname,
  "../../../../../test/fixtures/fake-codex-app-server.mjs",
);

const servers: CodexAppServer[] = [];
const tempDirs: string[] = [];

function readProtocolLog(
  logPath: string,
): Array<Record<string, unknown>> {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function startServer(
  logPath: string,
  extraEnv: Record<string, string> = {},
): Promise<CodexAppServer> {
  const server = new CodexAppServer();
  servers.push(server);
  await server.start(fixtureBinary, process.cwd(), {
    MAINS_CODEX_FIXTURE_LOG: logPath,
    ...extraEnv,
  });
  await server.sendRequest("initialize", {
    clientInfo: {
      name: "mains-capabilities-test",
      title: "Mains Capabilities Test",
      version: "1.0.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
    },
  });
  server.sendNotification("initialized");
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.MAINS_CODEX_FIXTURE_STALE_INSTALLED;
  delete process.env.MAINS_CODEX_FIXTURE_PLUGIN_DISABLED_REASON;
});

describe("Codex capabilities", () => {
  it("retries a failed feature probe instead of retaining its rejected promise", async () => {
    let probes = 0;
    const server = { sendRequest: vi.fn(async (method: string) => {
      if (method !== "experimentalFeature/list") return { marketplaces: [] };
      if (++probes === 1) throw new Error("temporary probe failure");
      return { data: [{ name: "plugins", enabled: true }], nextCursor: null };
    }) } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({ ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn() });
    expect((await capabilities.listPlugins()).remoteSyncError).toContain("temporary probe failure");
    expect((await capabilities.listPlugins()).remoteSyncError).toBeNull();
    expect(probes).toBe(2);
    capabilities.shutdown();
  });

  it("rejects a repeated inventory cursor without publishing its partial result", async () => {
    const sendRequest = vi.fn().mockResolvedValueOnce({ data: [], nextCursor: "same" })
      .mockResolvedValueOnce({ data: [], nextCursor: "same" }).mockRejectedValue(new Error("unexpected next page"));
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({ ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn() });
    await expect(capabilities.readMcpInventory()).rejects.toThrow("repeated MCP inventory cursor");
    expect(sendRequest).toHaveBeenCalledTimes(2);
    sendRequest.mockResolvedValue({ data: [], nextCursor: null });
    await expect(capabilities.readMcpInventory()).resolves.toEqual([]);
    capabilities.shutdown();
  });

  it("does not request the next MCP inventory page after its server owner retires", async () => {
    let finish!: (value: unknown) => void;
    const sendRequest = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ data: [], nextCursor: null });
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({ ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn() });
    const pending = capabilities.readMcpInventory().catch((error: unknown) => error);
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledOnce());
    capabilities.onServerClosed(); finish({ data: [], nextCursor: "obsolete-page" }); await pending;
    await new Promise<void>((resolve) => setImmediate(resolve)); expect(sendRequest).toHaveBeenCalledOnce();
  });

  it("does not read installed-plugin assets from a response delivered after shutdown", async () => {
    let finish!: (value: unknown) => void;
    const sendRequest = vi.fn((method: string) => method === "experimentalFeature/list"
      ? Promise.resolve({ data: [{ name: "plugins", enabled: true }], nextCursor: null })
      : new Promise((resolve) => { finish = resolve; }));
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({ ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn() });
    const read = vi.spyOn(fs.promises, "readFile");
    try {
      const pending = capabilities.listInstalledPlugins();
      await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledWith("plugin/installed", {}, 30000));
      capabilities.shutdown();
      finish({ marketplaces: [{ name: "retired", plugins: [{ id: "late", interface: { logo: "/retired/catalog/logo.svg" } }] }] });
      await pending; await new Promise<void>((resolve) => setImmediate(resolve));
      expect(read.mock.calls.filter(([file]) => file === "/retired/catalog/logo.svg")).toHaveLength(0);
    } finally { read.mockRestore(); }
  });

  it("claims an installed-plugin refresh before reentrant server acquisition", async () => {
    const server = { sendRequest: vi.fn(async (method: string) => method === "experimentalFeature/list"
      ? { data: [{ name: "plugins", enabled: true }], nextCursor: null }
      : { marketplaces: [] }) } as unknown as CodexAppServer;
    let repeated: Promise<unknown> | undefined;
    let first = true;
    const capabilities = createCodexCapabilities({
      ensureServer: async () => { if (first) { first = false; repeated = capabilities.listInstalledPlugins(); } return server; },
      getRunningServer: () => server, getCliHealth: vi.fn(),
    });
    await capabilities.listInstalledPlugins(); await repeated;
    expect(vi.mocked(server.sendRequest).mock.calls.filter(([method]) => method === "plugin/installed")).toHaveLength(1);
  });

  it("abandons an unused catalog before reading its assets and reuses its pending native request on return", async () => {
    let finish!: (result: unknown) => void;
    const sendRequest = vi.fn((method: string) => method === "experimentalFeature/list"
      ? Promise.resolve({ data: [{ name: "plugins", enabled: true }], nextCursor: null })
      : new Promise((resolve) => { finish = resolve; }));
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server,
      getCliHealth: vi.fn(),
    });
    const controller = new AbortController();
    let outcome = "pending";
    const abandoned = capabilities.listPlugins(controller.signal).then(
      () => { outcome = "completed"; },
      () => { outcome = "aborted"; },
    );
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledWith("plugin/list", {}, 30000));
    controller.abort();
    await abandoned;
    expect(outcome).toBe("aborted");
    const returning = capabilities.listPlugins();
    finish({ marketplaces: [{ name: "fixture", plugins: [{ id: "demo", name: "demo" }] }] });
    await abandoned;
    expect((await returning).marketplaces[0].plugins[0].id).toBe("demo");
    expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/list")).toHaveLength(1);
  });

  it("does not synchronously read catalog assets on the backend event loop", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-plugin-assets-"));
    tempDirs.push(dir);
    const logo = path.join(dir, "logo.svg");
    fs.writeFileSync(logo, "<svg/>");
    const read = vi.spyOn(fs, "readFileSync");
    try {
      const server = { sendRequest: vi.fn(async (method: string) => method === "experimentalFeature/list"
        ? { data: [{ name: "plugins", enabled: true }], nextCursor: null }
        : { marketplaces: [{ name: "fixture", plugins: [{ id: "demo", interface: { logo } }] }] }),
      } as unknown as CodexAppServer;
      const capabilities = createCodexCapabilities({
        ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn(),
      });
      const result = await capabilities.listPlugins();
      expect(result.marketplaces[0].plugins[0].interface?.logo).toBe("data:image/svg+xml;base64,PHN2Zy8+");
      expect(read.mock.calls.filter(([file]) => file === logo)).toHaveLength(0);
    } finally { read.mockRestore(); }
  });

  it("does not launch catalog discovery if the page leaves during server startup", async () => {
    let ready!: (server: CodexAppServer) => void;
    const server = { sendRequest: vi.fn() } as unknown as CodexAppServer;
    const ensureServer = vi.fn(() => new Promise<CodexAppServer>((resolve) => { ready = resolve; }));
    const capabilities = createCodexCapabilities({ ensureServer, getRunningServer: () => server, getCliHealth: vi.fn() });
    const controller = new AbortController();
    const request = capabilities.listPlugins(controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(ensureServer).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    ready(server);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(server.sendRequest).not.toHaveBeenCalled();
  });

  it("discards a late native catalog without reading artwork after every consumer has left", async () => {
    let finish!: (result: unknown) => void;
    const sendRequest = vi.fn((method: string) => method === "experimentalFeature/list"
      ? Promise.resolve({ data: [{ name: "plugins", enabled: true }], nextCursor: null })
      : new Promise((resolve) => { finish = resolve; }));
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn(),
    });
    const read = vi.spyOn(fs.promises, "readFile");
    const controller = new AbortController();
    const pending = capabilities.listPlugins(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    try {
      await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledWith("plugin/list", {}, 30000));
      controller.abort();
      await rejected;
      finish({ marketplaces: [{ plugins: [{ interface: { logo: "/catalog/late.svg" } }] }] });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(read.mock.calls.filter(([file]) => file === "/catalog/late.svg")).toHaveLength(0);
      const retry = capabilities.listPlugins();
      await vi.waitFor(() => expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/list")).toHaveLength(2));
      finish({ marketplaces: [] });
      await retry;
    } finally { read.mockRestore(); }
  });

  it("keeps another catalog reader alive when only one consumer cancels", async () => {
    let finish!: (result: unknown) => void;
    const sendRequest = vi.fn((method: string) => method === "experimentalFeature/list"
      ? Promise.resolve({ data: [{ name: "plugins", enabled: true }], nextCursor: null })
      : new Promise((resolve) => { finish = resolve; }));
    const server = { sendRequest } as unknown as CodexAppServer;
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server, getCliHealth: vi.fn(),
    });
    const controller = new AbortController();
    const first = capabilities.listPlugins(controller.signal);
    const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
    const second = capabilities.listPlugins();
    await vi.waitFor(() => expect(sendRequest).toHaveBeenCalledWith("plugin/list", {}, 30000));
    controller.abort();
    await rejected;
    finish({ marketplaces: [] });
    await expect(second).resolves.toMatchObject({ marketplaces: [] });
    await capabilities.listPlugins();
    expect(sendRequest.mock.calls.filter(([method]) => method === "plugin/list")).toHaveLength(1);
  });

  it("collects every model page, including an empty intermediate page, before mapping the catalog", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-model-pages-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "protocol.jsonl");
    const server = await startServer(logPath, {
      MAINS_CODEX_FIXTURE_MODEL_PAGES: JSON.stringify([
        { cursor: null, result: { data: [{ id: "first-model" }], nextCursor: "empty-page" } },
        { cursor: "empty-page", result: { data: [], nextCursor: "last-page" } },
        { cursor: "last-page", result: { data: [
          { id: "hidden-model", hidden: true },
          { id: "last-model", supportedReasoningEfforts: [{ reasoningEffort: "ultra", description: "Thorough" }],
            serviceTiers: [{ id: "ultrafast", name: "Ultrafast", description: "Fastest" }] },
        ], nextCursor: null } },
      ]),
    });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.166.0", channel: null, outdated: false, compatibility: "supported" }),
    });

    const models = await capabilities.listModels();
    expect(models.map((model) => model.id)).toEqual(["first-model", "last-model"]);
    expect(models[1]).toMatchObject({ supportedEffortLevels: ["ultra"], supportsFastMode: true,
      serviceTiers: [{ id: "ultrafast", name: "Ultrafast", description: "Fastest" }] });
    expect(readProtocolLog(logPath).filter((message) => message.method === "model/list")
      .map((message) => message.params)).toEqual([{}, { cursor: "empty-page" }, { cursor: "last-page" }]);
  });

  it.each(["error", "repeated cursor"])("discards a partial model catalog on a later page's %s", async (failure) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-model-page-failure-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "protocol.jsonl");
    const server = await startServer(logPath, {
      MAINS_CODEX_FIXTURE_MODEL_PAGES: JSON.stringify([
        { cursor: null, result: { data: [{ id: "partial-model" }], nextCursor: "next-page" } },
        failure === "error"
          ? { cursor: "next-page", error: { code: -32603, message: "Catalog unavailable" } }
          : { cursor: "next-page", result: { data: [], nextCursor: "next-page" } },
      ]),
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server, logger,
      getCliHealth: async () => ({ version: "0.166.0", channel: null, outdated: false, compatibility: "supported" }),
    });
    await expect(capabilities.listModels()).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalled();
    expect(readProtocolLog(logPath).filter((message) => message.method === "model/list")).toHaveLength(2);
  });

  it.each([
    { kind: "gcp", account: { type: "gcp" } },
    { kind: "chatgpt", account: { type: "chatgpt", email: "codex@example.com", planType: "pro", workspaceName: "Mains team" } },
  ])("retains the current $kind account contract", async ({ kind, account }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-account-"));
    tempDirs.push(dir);
    const server = await startServer(path.join(dir, "protocol.jsonl"), {
      MAINS_CODEX_FIXTURE_ACCOUNT: kind,
      MAINS_CODEX_FIXTURE_WORKSPACE_NAME: "Mains team",
    });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.166.0", channel: null, outdated: false, compatibility: "supported" }),
    });
    await expect(capabilities.getAccountInfo()).resolves.toMatchObject({ account, requiresOpenaiAuth: false });
  });

  it("discovers project plugins and isolates installed-plugin caches across workspaces", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-project-plugins-"));
    tempDirs.push(dir);
    const logPath = path.join(dir, "protocol.jsonl");
    const server = await startServer(logPath, { MAINS_CODEX_FIXTURE_PROJECT_PLUGINS: "1" });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server, getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.162.1", channel: null, outdated: false, compatibility: "supported" }),
    });
    const first = path.join(dir, "first");
    const second = path.join(dir, "second");
    const [a, b, aAgain] = await Promise.all([
      capabilities.listInstalledPlugins(false, first),
      capabilities.listInstalledPlugins(false, second),
      capabilities.listInstalledPlugins(false, first),
    ]);
    expect(a.marketplaces[0]?.path).toBe(first);
    expect(b.marketplaces[0]?.path).toBe(second);
    expect(aAgain).toEqual(a);
    await expect(capabilities.listInstalledPlugins()).resolves.toMatchObject({ marketplaces: [] });
    expect(await capabilities.listInstalledPlugins(false, first)).toEqual(a);
    const requests = readProtocolLog(logPath).filter((message) => message.method === "plugin/installed");
    expect(requests.map((message) => message.params)).toEqual([{ cwds: [first] }, { cwds: [second] }, {}]);
  });

  it("reads current app connection state after authorization completed outside app-server", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-plugin-external-auth-"));
    tempDirs.push(dir);
    const server = await startServer(path.join(dir, "protocol.jsonl"), { MAINS_CODEX_FIXTURE_APP_AUTH_CONNECTED: "1" });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.162.1", channel: null, outdated: false, compatibility: "supported" }),
    });
    await capabilities.listPlugins();
    await expect(server.sendRequest("app/installed", { forceRefresh: false })).resolves.toMatchObject({
      apps: [{ id: "fixture-app", callable: false }],
    });
    const detail = await capabilities.readPlugin("fixture-plugin@fixture-remote", "");
    expect(detail.apps).toMatchObject([{ id: "fixture-app", installed: true, runtimeEnabled: true, callable: true }]);
  });

  it("reads memory values, inverts the tool-assisted setting, and resets through App Server", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-memory-"));
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    const server = await startServer(logPath);
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.161.0", channel: null, outdated: false, compatibility: "supported" }),
    });

    await expect(capabilities.getCodexMemorySettings()).resolves.toEqual({
      supported: true,
      memoriesEnabled: false,
      allowToolAssistedChats: null,
    });
    await capabilities.setCodexMemorySetting("memoriesEnabled", true);
    await capabilities.setCodexMemorySetting("allowToolAssistedChats", false);
    await expect(capabilities.getCodexMemorySettings()).resolves.toEqual({
      supported: true,
      memoriesEnabled: true,
      allowToolAssistedChats: false,
    });
    await capabilities.resetCodexMemories();

    const requests = readProtocolLog(logPath).filter((message) =>
      ["config/read", "config/value/write", "memory/reset"].includes(String(message.method)));
    expect(requests).toMatchObject([
      { method: "config/read" },
      { method: "config/value/write", params: { keyPath: "features.memories", value: true } },
      { method: "config/value/write", params: { keyPath: "memories.disable_on_external_context", value: true } },
      { method: "config/read" },
      { method: "memory/reset" },
    ]);
  });

  it("reports unsupported memory RPCs without inventing configuration values", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-memory-"));
    tempDirs.push(tempDir);
    const server = await startServer(path.join(tempDir, "protocol.jsonl"), {
      MAINS_CODEX_FIXTURE_MEMORY_READ_UNSUPPORTED: "1",
      MAINS_CODEX_FIXTURE_MEMORY_RESET_UNSUPPORTED: "1",
      MAINS_CODEX_FIXTURE_MEMORY_WRITE_UNSUPPORTED: "1",
    });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.161.0", channel: null, outdated: false, compatibility: "supported" }),
    });

    await expect(capabilities.getCodexMemorySettings()).resolves.toEqual({
      supported: false,
      memoriesEnabled: null,
      allowToolAssistedChats: null,
    });
    await expect(capabilities.resetCodexMemories()).rejects.toThrow(
      "cannot delete memories through App Server",
    );
    await expect(capabilities.setCodexMemorySetting("memoriesEnabled", true)).rejects.toThrow(
      "cannot update memory settings",
    );
  });

  it("maps model, account, rate-limit, and skill RPCs through the real transport", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-capabilities-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    const serviceTiers = [{ id: "ultrafast", name: "Ultrafast", description: "Fixture higher usage." },
      { id: "future-speed", name: "Future speed", description: "Fixture future tier." }];
    const server = await startServer(logPath, { MAINS_CODEX_FIXTURE_SERVICE_TIERS: JSON.stringify(serviceTiers) });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({
        version: "0.146.0",
        channel: null,
        outdated: false,
        compatibility: "supported",
      }),
    });

    await expect(capabilities.listModels()).resolves.toEqual([
      expect.objectContaining({
        id: "gpt-fixture-codex",
        displayName: "GPT Fixture Codex",
        isDefault: true,
        supportsEffort: true,
        supportedEffortLevels: ["medium"],
        supportsFastMode: true,
        serviceTiers,
        capabilities: { vision: true },
      }),
    ]);
    await expect(capabilities.listRealtimeVoices()).resolves.toEqual({
      voices: ["cove", "maple", "juniper", "aube", "rio", "viola"], defaultVoice: "cove",
    });
    const voiceRequests = readProtocolLog(logPath).filter(
      (message) => String(message.method).startsWith("thread/realtime/"),
    );
    expect(voiceRequests).toMatchObject([{ method: "thread/realtime/listVoices", params: {} }]);
    await expect(capabilities.getAccountInfo()).resolves.toMatchObject({
      account: {
        type: "chatgpt",
        email: "codex@example.com",
        planType: "pro",
      },
      requiresOpenaiAuth: false,
      cli: {
        version: "0.146.0",
        compatibility: "supported",
      },
    });
    await expect(capabilities.getRateLimits()).resolves.toMatchObject({
      ordinaryUsageAllowed: true,
      limitId: "codex",
      planType: "pro",
      primary: { usedPercent: 10 },
      rateLimitsByLimitId: {
        codex: { limitId: "codex" },
        base_model_inference: {
          limitId: "base_model_inference",
          normalModelSlug: "gpt-5.6-luna",
          primary: { usedPercent: 2 },
        },
      },
      rateLimitResetCredits: { availableCount: 1 },
    });
    await expect(capabilities.listSkills(tempDir)).resolves.toEqual([
      expect.objectContaining({
        name: "fixture-skill",
        displayName: "Fixture Skill",
        source: "project",
        scope: "repo",
        enabled: true,
      }),
    ]);

    const skillsRequest = readProtocolLog(logPath).find(
      (message) => message.method === "skills/list",
    );
    expect(skillsRequest?.params).toEqual({
      cwds: [tempDir],
      forceReload: true,
    });
  });

  it.each([
    {
      name: "v3 voices without merging older families",
      voices: {
        v1: ["cove", "maple"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin",
        v3: ["cove", "aube", "rio", "viola", "rio"],
      },
      expected: { voices: ["cove", "aube", "rio", "viola"], defaultVoice: "cove" },
    },
    {
      name: "v1 voices from older servers without a v3 catalog",
      voices: { v1: ["cove", "maple"], v2: ["marin"], defaultV1: "cove", defaultV2: "marin" },
      expected: { voices: ["cove", "maple"], defaultVoice: "cove" },
    },
    {
      name: "v1 voices when the v3 catalog is empty",
      voices: { v1: ["cove", "maple"], v3: [], defaultV1: "cove" },
      expected: { voices: ["cove", "maple"], defaultVoice: "cove" },
    },
    {
      name: "the first available voice when the default is outside the v3 catalog",
      voices: { v1: ["cove"], v3: ["aube", "rio"], defaultV1: "cove" },
      expected: { voices: ["aube", "rio"], defaultVoice: "aube" },
    },
  ])("selects $name through the real transport", async ({ voices, expected }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-voices-"));
    tempDirs.push(dir);
    const server = await startServer(path.join(dir, "protocol.jsonl"), {
      MAINS_CODEX_FIXTURE_VOICES: JSON.stringify(voices),
    });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.163.0", channel: null, outdated: false, compatibility: "supported" }),
    });

    await expect(capabilities.listRealtimeVoices()).resolves.toEqual(expected);
  });

  it.each([
    { name: "empty catalogs", voices: { v1: [], v3: [], defaultV1: "cove" } },
    { name: "non-string v3 voices", voices: { v1: ["cove"], v3: ["aube", 42], defaultV1: "cove" } },
    { name: "empty v3 voice identifiers", voices: { v1: ["cove"], v3: [""], defaultV1: "cove" } },
  ])("rejects $name through the real transport", async ({ voices }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mains-codex-voices-"));
    tempDirs.push(dir);
    const server = await startServer(path.join(dir, "protocol.jsonl"), {
      MAINS_CODEX_FIXTURE_VOICES: JSON.stringify(voices),
    });
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({ version: "0.163.0", channel: null, outdated: false, compatibility: "supported" }),
    });

    await expect(capabilities.listRealtimeVoices()).rejects.toThrow("Codex returned an invalid voice list.");
  });

  it("deduplicates plugin catalogs, preserves remote references, and invalidates after mutations", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-capabilities-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    const server = await startServer(logPath);
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({
        version: "0.146.0",
        channel: null,
        outdated: false,
      }),
    });

    const [firstCatalog, secondCatalog] = await Promise.all([
      capabilities.listPlugins(),
      capabilities.listPlugins(),
    ]);
    expect(firstCatalog).toEqual(secondCatalog);
    expect(firstCatalog.marketplaces[0]?.plugins[0]).toMatchObject({
      id: "fixture-plugin@fixture-remote",
      name: "fixture-plugin",
      installed: false,
      availability: "AVAILABLE",
      disabledReason: null,
      eligiblePlanTypes: null,
      installedAt: null,
    });
    expect(
      readProtocolLog(logPath).filter(
        (message) => message.method === "plugin/list",
      ),
    ).toHaveLength(1);

    await expect(
      capabilities.readPlugin(
        "fixture-plugin@fixture-remote",
        "",
      ),
    ).resolves.toMatchObject({
      marketplaceName: "fixture-remote",
      description: "Fixture plugin detail.",
      summary: {
        availability: "AVAILABLE",
        disabledReason: null,
        eligiblePlanTypes: null,
        installedAt: null,
      },
      mcpServers: ["fixture-mcp"],
    });
    await capabilities.installPlugin(
      "fixture-plugin@fixture-remote",
    );
    await capabilities.listPlugins();
    await capabilities.uninstallPlugin(
      "fixture-plugin@fixture-remote",
    );

    const messages = readProtocolLog(logPath);
    expect(
      messages.filter((message) => message.method === "plugin/list"),
    ).toHaveLength(2);
    expect(
      messages.find((message) => message.method === "plugin/read")
        ?.params,
    ).toEqual({
      pluginName: "remote-fixture-plugin-id",
      remoteMarketplaceName: "fixture-remote",
    });
    expect(
      messages.find((message) => message.method === "plugin/install")
        ?.params,
    ).toEqual({
      pluginName: "remote-fixture-plugin-id",
      remoteMarketplaceName: "fixture-remote",
    });
    expect(
      messages.find(
        (message) => message.method === "plugin/uninstall",
      )?.params,
    ).toEqual({
      pluginId: "remote-fixture-plugin-id",
    });
  });

  it("blocks installs that are unavailable for the current plan", async () => {
    process.env.MAINS_CODEX_FIXTURE_PLUGIN_DISABLED_REASON =
      "plan_not_eligible";
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-capabilities-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    const server = await startServer(logPath);
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({
        version: "0.153.0",
        channel: null,
        outdated: false,
      }),
    });

    const catalog = await capabilities.listPlugins();
    expect(catalog.marketplaces[0]?.plugins[0]).toMatchObject({
      availability: "AVAILABLE",
      disabledReason: "plan_not_eligible",
      eligiblePlanTypes: ["pro", "business"],
    });
    await expect(
      capabilities.installPlugin("fixture-plugin@fixture-remote"),
    ).rejects.toThrow(
      "This plugin is not available on your current plan. Eligible plans: pro, business.",
    );
    expect(
      readProtocolLog(logPath).some(
        (message) => message.method === "plugin/install",
      ),
    ).toBe(false);
  });

  it("surfaces a mid-session install that plugin/installed still omits", async () => {
    process.env.MAINS_CODEX_FIXTURE_STALE_INSTALLED = "1";
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "mains-codex-capabilities-"),
    );
    tempDirs.push(tempDir);
    const logPath = path.join(tempDir, "protocol.jsonl");
    const server = await startServer(logPath);
    const capabilities = createCodexCapabilities({
      ensureServer: async () => server,
      getRunningServer: () => server,
      getCliHealth: async () => ({
        version: "0.146.0",
        channel: null,
        outdated: false,
      }),
    });

    // Warm the catalog the way the plugin browser does, then install from it.
    await capabilities.listPlugins();
    await expect(capabilities.listInstalledPlugins()).resolves.toMatchObject({
      marketplaces: [],
    });

    await capabilities.installPlugin("fixture-plugin@fixture-remote");

    const installed = await capabilities.listInstalledPlugins();
    expect(installed.marketplaces).toEqual([
      expect.objectContaining({
        name: "fixture-remote",
        plugins: [
          expect.objectContaining({
            id: "fixture-plugin@fixture-remote",
            name: "fixture-plugin",
            installed: true,
            enabled: true,
          }),
        ],
      }),
    ]);

    // Uninstalling has to clear the overlay again.
    await capabilities.uninstallPlugin("fixture-plugin@fixture-remote");
    await expect(capabilities.listInstalledPlugins()).resolves.toMatchObject({
      marketplaces: [],
    });
  });
});
