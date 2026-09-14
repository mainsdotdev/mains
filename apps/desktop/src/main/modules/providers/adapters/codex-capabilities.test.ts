import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServer } from "./codex-app-server.client";
import { createCodexCapabilities } from "./codex-capabilities";

const fixtureBinary = path.resolve(
  __dirname,
  "../../../../test/fixtures/fake-codex-app-server.mjs",
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

async function startServer(logPath: string): Promise<CodexAppServer> {
  const server = new CodexAppServer();
  servers.push(server);
  await server.start(fixtureBinary, process.cwd(), {
    MAINS_CODEX_FIXTURE_LOG: logPath,
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
  it("maps model, account, rate-limit, and skill RPCs through the real transport", async () => {
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
        capabilities: { vision: true },
      }),
    ]);
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
      limitId: "codex",
      planType: "pro",
      primary: { usedPercent: 10 },
      rateLimitsByLimitId: {
        codex: { limitId: "codex" },
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
        version: "0.147.0",
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
