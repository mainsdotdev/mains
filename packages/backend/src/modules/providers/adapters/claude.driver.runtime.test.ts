import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestBackendRuntime } from "../../../../test/backend-runtime";
import {
  clearClaudeCliCache,
  detectInstalledClis,
  resolveClaudeRuntime,
} from "../providers.utils";
import { createClaudeDriver } from "./claude.driver";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
  supportedModels: vi.fn(),
  initializationResult: vi.fn(),
  accountInfo: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: sdk.query,
  createSdkMcpServer: undefined,
  tool: undefined,
  getSessionInfo: undefined,
  deleteSession: undefined,
}));
vi.mock("../../guards/guards.service", () => ({
  guardsService: { buildClaudeGuardHook: vi.fn().mockResolvedValue(null) },
}));

describe("Claude runtime without a system CLI", () => {
  let fixture: string;
  let bundled: string;
  let configured: string;
  let statusFile: string;
  let callsFile: string;
  let restoreRuntime: () => void;

  function cliCalls(): string {
    return fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8") : "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearClaudeCliCache();
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mains-claude-runtime-"));
    const appPath = path.join(fixture, "Okan's Mains.app", "app.asar");
    bundled = path.join(
      appPath + ".unpacked", ".vite", "build", "node_modules",
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`, "claude",
    );
    configured = path.join(fixture, "custom", "claude");
    statusFile = path.join(fixture, "status.json");
    callsFile = path.join(fixture, "calls.txt");
    fs.writeFileSync(statusFile, JSON.stringify({
      loggedIn: true,
      email: "account@example.test",
      subscriptionType: "Pro",
    }));
    const script = `#!/bin/sh
if [ -n "$ANTHROPIC_API_KEY$ANTHROPIC_AUTH_TOKEN" ]; then exit 2; fi
printf '%s\\n' "$*" >> '${callsFile}'
case "$1" in
  --version) printf '2.1.283 (Claude Code)\\n';;
  auth)
    if [ "$2" = status ]; then /bin/cat '${statusFile}';
    else printf 'login started\\n'; fi;;
  update) printf 'updated\\n';;
esac
`;
    for (const binary of [bundled, configured]) {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, script, { mode: 0o755 });
    }
    restoreRuntime = installTestBackendRuntime({
      isPackaged: () => true,
      getAppPath: () => appPath,
      getPath: () => fixture,
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "unused-api-key");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unused-auth-token");
    sdk.supportedModels.mockResolvedValue([
      { value: "default", description: "Use the default model (currently Claude Sonnet)" },
      { value: "sonnet", displayName: "Claude Sonnet", description: "Claude Sonnet 5 · Live catalogue" },
    ]);
    sdk.initializationResult.mockResolvedValue({
      commands: [{ name: "help", description: "Live command", argumentHint: "" }],
    });
    sdk.accountInfo.mockResolvedValue({ email: "legacy@example.test", subscriptionType: "Pro" });
    sdk.query.mockImplementation(() => ({
      supportedModels: sdk.supportedModels,
      initializationResult: sdk.initializationResult,
      accountInfo: sdk.accountInfo,
      close: sdk.close,
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { content: [{ type: "text", text: "ok" }] } };
      },
    }));
  });

  afterEach(() => {
    restoreRuntime();
    clearClaudeCliCache();
    vi.unstubAllEnvs();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("uses the bundled executable for runs, the live catalogue, commands and account probes", async () => {
    const driver = createClaudeDriver({ settingSources: [] });
    expect(resolveClaudeRuntime()).toEqual({ path: bundled, source: "bundled" });
    expect(detectInstalledClis()).toMatchObject({ claude: true, claudeSource: "bundled" });
    const models = await driver.listModels!();
    expect(models).toEqual([expect.objectContaining({
      id: "sonnet", displayName: "Claude Sonnet", description: "Claude Sonnet 5 · Live catalogue",
    })]);
    expect(await driver.listCommands!(fixture)).toEqual([
      expect.objectContaining({ name: "help", description: "Live command" }),
    ]);
    expect(await driver.getAccountInfo!()).toMatchObject({
      account: { type: "claude", email: "account@example.test" },
      cli: { version: "2.1.283", source: "bundled", updateMethod: "app" },
    });
    expect(await driver.generateText!("hello", { model: "sonnet" })).toBe("ok");
    for (const [{ options }] of sdk.query.mock.calls) {
      expect(options.pathToClaudeCodeExecutable).toBe(bundled);
      expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(options.env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    }
    expect(sdk.close).toHaveBeenCalledTimes(2);
    expect(cliCalls()).toContain("auth status --json");
  });

  it("reports a real signed-out state and runs login through a safely quoted bundled path", async () => {
    fs.writeFileSync(statusFile, '{"loggedIn":false}');
    const info = await createClaudeDriver({}).getAccountInfo!();
    expect(info.account).toBeNull();
    expect(sdk.accountInfo).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    expect(execFileSync("/bin/sh", ["-c", info.cli!.authLoginCommand!], { encoding: "utf8" }))
      .toBe("login started\n");
    expect(cliCalls()).toContain("auth login");
  });

  it("uses the bundled process for legacy account queries and closes it", async () => {
    fs.writeFileSync(statusFile, '{}');
    const info = await createClaudeDriver({}).getAccountInfo!();
    expect(info.account).toMatchObject({ email: "legacy@example.test" });
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ pathToClaudeCodeExecutable: bundled }),
    }));
    expect(sdk.close).toHaveBeenCalledOnce();
  });

  it("keeps fallback models only for a failed query and retries the live catalogue", async () => {
    sdk.supportedModels.mockRejectedValueOnce(new Error("Catalogue unavailable"));
    const driver = createClaudeDriver({});
    expect((await driver.listModels!()).map((model) => model.id))
      .toEqual(["fable", "sonnet", "opus[1m]", "haiku"]);
    expect(await driver.listModels!()).toHaveLength(1);
    expect(sdk.close).toHaveBeenCalledTimes(2);
  });

  it("prevents self-updating the SDK-matched bundle", async () => {
    expect(await createClaudeDriver({}).updateCli!()).toMatchObject({
      success: false, output: expect.stringContaining("updates with the app"),
    });
    expect(cliCalls()).toBe("");
  });

  it("honors an explicit executable for detection, queries, auth and self-update", async () => {
    const driver = createClaudeDriver({ binary: configured });
    expect(detectInstalledClis(configured)).toMatchObject({ claude: true, claudeSource: "configured" });
    await driver.listModels!();
    expect(sdk.query).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ pathToClaudeCodeExecutable: configured }),
    }));
    expect(await driver.getAccountInfo!()).toMatchObject({
      cli: { source: "configured", updateMethod: "cli" },
    });
    expect(await driver.updateCli!()).toMatchObject({ success: true });
    expect(cliCalls()).toContain("update");
  });

  it("refreshes the catalogue when the selected executable changes", async () => {
    const driver = createClaudeDriver({});
    await driver.listModels!();
    driver.updateConfig!({ binary: configured });
    await driver.listModels!();
    expect(sdk.query.mock.calls.map(([request]) => request.options.pathToClaudeCodeExecutable))
      .toEqual([bundled, configured]);
  });

  it("falls back from an invalid override to the bundle, but never chooses an unrelated system CLI", () => {
    expect(resolveClaudeRuntime(path.join(fixture, "missing")))
      .toEqual({ path: bundled, source: "bundled" });
    fs.rmSync(bundled);
    clearClaudeCliCache();
    vi.stubEnv("PATH", `${path.dirname(configured)}${path.delimiter}${process.env.PATH}`);
    expect(resolveClaudeRuntime()).toBeNull();
    expect(detectInstalledClis()).toMatchObject({ claude: false });
    expect(resolveClaudeRuntime(configured)).toEqual({ path: configured, source: "configured" });
  });
});
