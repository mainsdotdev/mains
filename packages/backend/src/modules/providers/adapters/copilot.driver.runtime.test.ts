import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestBackendRuntime } from "../../../../test/backend-runtime";
import { copilotAuthLoginCommand, detectInstalledClis, resolveCopilotRuntime } from "../providers.utils";
import { createCopilotDriver } from "./copilot.driver";
import type { CopilotAdapterConfig } from "../../../../shared/adapter.types";

const sdk = vi.hoisted(() => ({
  authenticated: true,
  login: "mains-user",
  failStart: false,
  clients: [] as any[],
}));

vi.mock("@github/copilot-sdk", () => ({
  RuntimeConnection: {
    forStdio: (options: object) => ({ kind: "stdio", ...options }),
    forTcp: (options: object) => ({ kind: "tcp", ...options }),
    forUri: (url: string) => ({ kind: "uri", url }),
  },
  CopilotClient: class {
    // Model the runtime reading saved credentials when it starts. A client
    // created before login keeps its old snapshot until it is replaced.
    getAuthStatus = vi.fn().mockResolvedValue({
      isAuthenticated: sdk.authenticated, login: sdk.login,
    });
    start = vi.fn(async () => {
      if (sdk.failStart) throw new Error("Runtime failed to start");
    });
    stop = vi.fn().mockResolvedValue([]);
    forceStop = vi.fn().mockResolvedValue(undefined);
    getStatus = vi.fn().mockResolvedValue({ version: "1.0.90", protocolVersion: 3 });
    ping = vi.fn().mockResolvedValue({ message: "ok" });
    createSession = vi.fn();
    rpc = { models: { list: vi.fn().mockResolvedValue({
      models: [{ id: "live-model", name: "Live Copilot model" }],
    }) } };
    constructor(public options: any) {
      sdk.clients.push(this);
    }
  },
}));

describe("Copilot runtime without a system CLI", () => {
  let fixture: string;
  let appPath: string;
  let bundled: string;
  let loginCli: string;
  let configured: string;
  let callsFile: string;
  let restoreRuntime: () => void;
  const drivers: ReturnType<typeof createCopilotDriver>[] = [];

  function driver(binary?: string) {
    return configuredDriver(binary ? { binary } : {});
  }

  function configuredDriver(config: CopilotAdapterConfig) {
    const result = createCopilotDriver(config);
    drivers.push(result);
    return result;
  }

  function cliCalls() {
    return fs.existsSync(callsFile) ? fs.readFileSync(callsFile, "utf8") : "";
  }

  beforeEach(() => {
    sdk.authenticated = true;
    sdk.login = "mains-user";
    sdk.failStart = false;
    sdk.clients.length = 0;
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mains-copilot-runtime-"));
    appPath = path.join(fixture, "Okan's Mains.app", "app.asar");
    bundled = path.join(
      appPath + ".unpacked", ".vite", "build", "node_modules",
      `@github/copilot-sdk-${process.platform}-${process.arch}`,
      "prebuilds", `${process.platform}-${process.arch}`, "copilot-runtime",
    );
    loginCli = path.join(
      appPath + ".unpacked", ".vite", "build", "node_modules",
      `@github/copilot-${process.platform}-${process.arch}`, "copilot",
    );
    configured = path.join(fixture, "custom", "copilot");
    callsFile = path.join(fixture, "calls.txt");
    const script = `#!/bin/sh
printf '%s\\n' "$*" >> '${callsFile}'
printf 'ok\\n'
`;
    for (const binary of [bundled, loginCli, configured]) {
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.writeFileSync(binary, script, { mode: 0o755 });
    }
    fs.writeFileSync(path.join(path.dirname(bundled), "runtime.node"), "native runtime fixture");
    restoreRuntime = installTestBackendRuntime({
      isPackaged: () => true, getAppPath: () => appPath, getPath: () => fixture,
    });
    vi.stubEnv("PATH", "/missing-system-tools");
  });

  afterEach(async () => {
    for (const current of drivers.splice(0)) await current.shutdown?.();
    restoreRuntime();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("detects the bundled runtime and probes auth without copilot or gh on PATH", async () => {
    expect(detectInstalledClis()).toMatchObject({ copilot: true, copilotSource: "bundled" });
    const info = await driver().getAccountInfo!();
    expect(info.account).toEqual({ type: "copilot", login: "mains-user" });
    expect(info.cli).toMatchObject({ version: "1.0.90", source: "bundled", updateMethod: "app" });
    expect(sdk.clients[0].options.connection).toEqual({
      kind: "stdio", path: bundled, args: ["--no-auto-update"],
    });
    expect(sdk.clients[0].createSession).not.toHaveBeenCalled();
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.clients[0].options).not.toHaveProperty("gitHubToken");
    expect(sdk.clients[0].options).not.toHaveProperty("useLoggedInUser");
  });

  it.each([undefined, false, true])("forwards the provider token and preserves explicit login choice (%s)", async (useLoggedInUser) => {
    await configuredDriver({ githubToken: "test-provider-token", useLoggedInUser }).getAccountInfo!();
    expect(sdk.clients[0].options.gitHubToken).toBe("test-provider-token");
    expect(sdk.clients[0].options).not.toHaveProperty("githubToken");
    if (useLoggedInUser === undefined) expect(sdk.clients[0].options).not.toHaveProperty("useLoggedInUser");
    else expect(sdk.clients[0].options.useLoggedInUser).toBe(useLoggedInUser);
  });

  it("forwards a disabled saved-account login without requiring a token", async () => {
    await configuredDriver({ useLoggedInUser: false }).getAccountInfo!();
    expect(sdk.clients[0].options).toMatchObject({ useLoggedInUser: false });
    expect(sdk.clients[0].options).not.toHaveProperty("gitHubToken");
  });

  it("renews the run client and live catalogue after token rotation or token removal", async () => {
    const current = configuredDriver({ githubToken: "test-old-token" });
    await current.listModels!();
    const oldClient = sdk.clients[0];
    current.updateConfig!({ githubToken: "test-new-token", useLoggedInUser: false });
    await current.listModels!();
    expect(oldClient.stop).toHaveBeenCalledOnce();
    expect(sdk.clients[1].options).toMatchObject({ gitHubToken: "test-new-token", useLoggedInUser: false });
    expect(sdk.clients[1].rpc.models.list).toHaveBeenCalledOnce();
    current.updateConfig!({});
    await current.listModels!();
    expect(sdk.clients[1].stop).toHaveBeenCalledOnce();
    expect(sdk.clients[2].options).not.toHaveProperty("gitHubToken");
    expect(sdk.clients[2].options).not.toHaveProperty("useLoggedInUser");
  });

  it("renews the run client when only saved-account login changes", async () => {
    const current = configuredDriver({ useLoggedInUser: true });
    await current.listModels!();
    current.updateConfig!({ useLoggedInUser: false });
    await current.listModels!();
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
    expect(sdk.clients[1].options.useLoggedInUser).toBe(false);
  });

  it("uses fresh auth settings for account probes while leaving the old run client alive", async () => {
    const current = configuredDriver({ githubToken: "test-old-token" });
    await current.listModels!();
    current.updateConfig!({ githubToken: "test-new-token", useLoggedInUser: false });
    await current.getAccountInfo!();
    expect(sdk.clients[1].options).toMatchObject({ gitHubToken: "test-new-token", useLoggedInUser: false });
    expect(sdk.clients[0].stop).not.toHaveBeenCalled();
    expect(sdk.clients[1].stop).toHaveBeenCalledOnce();
  });

  it("passes auth to spawned TCP runtimes and leaves an external server's auth to its host", async () => {
    await configuredDriver({ useStdio: false, port: 9234, githubToken: "test-tcp-token", useLoggedInUser: false }).getAccountInfo!();
    expect(sdk.clients[0].options).toMatchObject({ gitHubToken: "test-tcp-token", useLoggedInUser: false,
      connection: { kind: "tcp", port: 9234 } });
    await configuredDriver({ cliUrl: "localhost:9234", githubToken: "test-local-token", useLoggedInUser: false }).getAccountInfo!();
    expect(sdk.clients[1].options.connection).toEqual({ kind: "uri", url: "localhost:9234" });
    expect(sdk.clients[1].options).not.toHaveProperty("gitHubToken");
    expect(sdk.clients[1].options).not.toHaveProperty("useLoggedInUser");
  });

  it("reads newly saved login state while preserving the run client's lifetime", async () => {
    sdk.authenticated = false;
    const current = driver();
    expect((await current.getAccountInfo!()).account).toBeNull();
    await current.listModels!();
    const runClient = sdk.clients[1];
    sdk.authenticated = true;
    expect((await current.getAccountInfo!()).account).toEqual({ type: "copilot", login: "mains-user" });
    expect(runClient.stop).not.toHaveBeenCalled();
    expect(sdk.clients[2].stop).toHaveBeenCalledOnce();

    // Discovery after login gets a fresh client and catalogue, rather than
    // continuing with the signed-out client's cached authentication/models.
    await current.listModels!();
    expect(runClient.stop).toHaveBeenCalledOnce();
    expect(sdk.clients[3].options.connection.path).toBe(bundled);
  });

  it("runs shell-quoted login through the full CLI rather than the headless runtime", () => {
    const command = copilotAuthLoginCommand(resolveCopilotRuntime()!);
    expect(command).toContain(`@github/copilot-${process.platform}-${process.arch}`);
    fs.unlinkSync(bundled);
    execFileSync("/bin/sh", ["-c", command!]);
    expect(cliCalls()).toBe("--no-auto-update login\n");
  });

  it("keeps runtime availability when the login CLI is missing and omits its command", async () => {
    fs.unlinkSync(loginCli);
    expect(detectInstalledClis()).toMatchObject({ copilot: true });
    expect((await driver().getAccountInfo!()).cli?.authLoginCommand).toBeUndefined();
    expect(sdk.clients[0].options.connection.path).toBe(bundled);
  });

  it("uses the same SDK runtime over TCP", async () => {
    const current = createCopilotDriver({ useStdio: false, port: 9234 });
    drivers.push(current);
    await current.getAccountInfo!();
    expect(sdk.clients[0].options.connection).toEqual({
      kind: "tcp", path: bundled, args: ["--no-auto-update"], port: 9234,
    });
  });

  it("preserves external server connections when the local runtime is missing", async () => {
    fs.unlinkSync(bundled);
    const current = createCopilotDriver({ cliUrl: "localhost:9234" });
    drivers.push(current);
    const info = await current.getAccountInfo!();
    expect(sdk.clients[0].options.connection).toEqual({ kind: "uri", url: "localhost:9234" });
    expect(info.cli?.authLoginCommand).toBeUndefined();
  });

  it("declines self-updates for the bundled runtime without executing an update", async () => {
    const result = await driver().updateCli!();
    expect(result.success).toBe(false);
    expect(result.output).toContain("updates with the app");
    expect(cliCalls()).toBe("");
  });

  it("honours explicit overrides for detection, account checks, login and updates", async () => {
    const current = driver(configured);
    expect(detectInstalledClis(undefined, configured)).toMatchObject({ copilot: true, copilotSource: "configured" });
    const info = await current.getAccountInfo!();
    expect(info.cli).toMatchObject({ source: "configured", updateMethod: "cli" });
    expect(sdk.clients[0].options.connection).toEqual({ kind: "stdio", path: configured, args: [] });
    execFileSync("/bin/sh", ["-c", info.cli!.authLoginCommand!]);
    expect(await current.updateCli!()).toMatchObject({ success: true });
    expect(cliCalls()).toBe("login\nupdate\n");
  });

  it("falls back to the bundle when an override is missing or is a directory", () => {
    expect(resolveCopilotRuntime(path.join(fixture, "missing"))).toEqual({ path: bundled, source: "bundled" });
    expect(resolveCopilotRuntime(fixture)).toEqual({ path: bundled, source: "bundled" });
  });

  it("rejects an executable inside ASAR and never falls back to a system CLI", () => {
    const virtualBinary = bundled.replace("app.asar.unpacked", "app.asar");
    fs.mkdirSync(path.dirname(virtualBinary), { recursive: true });
    fs.renameSync(bundled, virtualBinary);
    vi.stubEnv("PATH", path.dirname(configured));
    expect(resolveCopilotRuntime()).toBeNull();
    expect(detectInstalledClis()).toMatchObject({ copilot: false });
  });

  it("reports missing or non-executable bundled runtimes as unavailable", async () => {
    fs.chmodSync(bundled, 0o644);
    expect(resolveCopilotRuntime()).toBeNull();
    expect(detectInstalledClis()).toMatchObject({ copilot: false });
    const info = await driver().getAccountInfo!();
    expect(info.account).toBeNull();
    expect(info.cli?.authLoginCommand).toBeUndefined();
    expect(sdk.clients).toHaveLength(0);
  });

  it.each(["missing", "empty", "directory"])("rejects a %s runtime.node library", (state) => {
    const library = path.join(path.dirname(bundled), "runtime.node");
    fs.unlinkSync(library);
    if (state === "empty") fs.writeFileSync(library, "");
    if (state === "directory") fs.mkdirSync(library);
    expect(resolveCopilotRuntime()).toBeNull();
    expect(detectInstalledClis()).toMatchObject({ copilot: false });
  });

  it("resolves a packaged directory without ASAR", () => {
    const directory = path.join(fixture, "app");
    fs.renameSync(appPath + ".unpacked", directory);
    bundled = bundled.replace(appPath + ".unpacked", directory);
    appPath = directory;
    expect(resolveCopilotRuntime()).toEqual({ path: bundled, source: "bundled" });
  });

  it.each([
    ["linux", { glibcVersionRuntime: "2.39" }],
    ["linuxmusl", {}],
  ])("selects the %s runtime on Linux", (platform, header) => {
    const linuxBinary = path.join(
      appPath + ".unpacked", ".vite", "build", "node_modules",
      `@github/copilot-sdk-${platform}-${process.arch}`,
      "prebuilds", `${platform}-${process.arch}`, "copilot-runtime",
    );
    fs.mkdirSync(path.dirname(linuxBinary), { recursive: true });
    fs.copyFileSync(bundled, linuxBinary);
    fs.writeFileSync(path.join(path.dirname(linuxBinary), "runtime.node"), "native runtime fixture");
    vi.stubGlobal("process", { ...process, platform: "linux", report: { getReport: () => ({ header }) } });
    expect(resolveCopilotRuntime()).toEqual({ path: linuxBinary, source: "bundled" });
  });

  it("releases the metadata client when its runtime cannot start", async () => {
    sdk.failStart = true;
    expect((await driver().getAccountInfo!()).account).toBeNull();
    expect(sdk.clients[0].stop).toHaveBeenCalledOnce();
  });
});
