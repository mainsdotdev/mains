import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectInstalledClis, findCursorBinaryPath, mergePathDirs, providerProcessPath, resolveClaudeRuntime, resolveCopilotRuntime, providerLoginCommand } from "./providers.utils";

describe("providers.utils / development Claude runtime", () => {
  it("resolves the SDK's native dependency without a system installation", () => {
    const runtime = resolveClaudeRuntime();
    expect(runtime?.source).toBe("bundled");
    expect(runtime?.path).toContain(`claude-agent-sdk-${process.platform}-${process.arch}`);
    expect(path.basename(runtime!.path)).toBe(process.platform === "win32" ? "claude.exe" : "claude");
    expect(fs.statSync(runtime!.path).isFile()).toBe(true);
  });
});

describe("providers.utils / development Copilot runtime", () => {
  it("resolves the host SDK's runtime wrapper and native library without a system installation", () => {
    const runtime = resolveCopilotRuntime();
    expect(runtime?.source).toBe("bundled");
    expect(runtime?.path).toContain(path.join("@github", "copilot-sdk-"));
    expect(path.basename(runtime!.path)).toBe(process.platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime");
    expect(fs.statSync(runtime!.path).isFile()).toBe(true);
    expect(fs.statSync(path.join(path.dirname(runtime!.path), "runtime.node")).isFile()).toBe(true);
  });

  it("starts the resolved runtime and reports the SDK-matched version without a model session", async () => {
    const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
    const runtime = resolveCopilotRuntime()!;
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: runtime.path }),
      logLevel: "error",
    });
    try {
      await client.start();
      const sdk = JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules/@github/copilot-sdk/package.json"), "utf8"));
      const status = await client.getStatus();
      expect(status.version).toBe(sdk.copilotCliVersion);
      expect((await client.ping("runtime-smoke")).protocolVersion).toBe(status.protocolVersion);
      expect(typeof (await client.getAuthStatus()).isAuthenticated).toBe("boolean");
    } finally {
      await client.forceStop();
    }
  }, 20_000);

  it("accepts the Auto Fast preset and its default-routing reset without sending a model prompt", async () => {
    const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
    const runtime = resolveCopilotRuntime()!;
    const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-copilot-fast-control-"));
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: runtime.path }),
      baseDirectory, useLoggedInUser: false, logLevel: "none",
    });
    try {
      await client.start();
      const session = await client.createSession({
        model: "auto", capi: { autoTier: "fast" }, workingDirectory: baseDirectory,
        availableTools: [],
        onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }),
      });
      expect(await session.rpc.model.getCurrent()).toMatchObject({ modelId: "auto", autoTier: "fast" });
      expect(await session.setAutoTier(null)).toMatchObject({ status: "pending", pendingAutoTier: null });
      expect(await session.rpc.model.getCurrent()).toMatchObject({ pendingAutoTier: null });
    } finally {
      await client.forceStop();
      fs.rmSync(baseDirectory, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("providers.utils / detectInstalledClis", () => {
  it("judges a configured Codex or Cursor binary itself, since their drivers spawn it with no fallback", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mains-detect-"));
    const binary = path.join(directory, process.platform === "win32" ? "agent.exe" : "agent");
    fs.writeFileSync(binary, "fixture");
    fs.chmodSync(binary, 0o755);
    try {
      expect(detectInstalledClis({ codex: binary, cursor: binary })).toMatchObject({ codex: true, cursor: true });
      const missing = path.join(directory, "missing");
      expect(detectInstalledClis({ codex: missing, cursor: missing })).toMatchObject({ codex: false, cursor: false });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("providers.utils / mergePathDirs", () => {
  it("puts login-shell dirs first, then the inherited PATH, then extras", () => {
    const merged = mergePathDirs(
      "/Users/me/.nvm/versions/node/v22.1.0/bin:/opt/homebrew/bin",
      "/usr/bin:/bin",
      ["/usr/local/bin"],
      "darwin",
    );
    expect(merged).toBe(
      "/Users/me/.nvm/versions/node/v22.1.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin",
    );
  });

  it("dedupes while keeping the first occurrence's position", () => {
    const merged = mergePathDirs(
      "/opt/homebrew/bin:/usr/bin",
      "/usr/bin:/bin:/opt/homebrew/bin",
      ["/opt/homebrew/bin", "/bin"],
      "darwin",
    );
    expect(merged).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("falls back to inherited PATH plus extras when the shell read failed", () => {
    const merged = mergePathDirs(null, "/usr/bin:/bin", ["/usr/local/bin"], "darwin");
    expect(merged).toBe("/usr/bin:/bin:/usr/local/bin");
  });

  it("drops empty segments from a malformed PATH", () => {
    const merged = mergePathDirs("", "/usr/bin::/bin:", [], "darwin");
    expect(merged).toBe("/usr/bin:/bin");
  });
});

describe("Windows provider environment", () => {
  it.runIf(process.platform === "win32").each(["agent.exe", "agent.cmd"])(
    "finds Cursor's native %s installation when the inherited PATH is stale", (binaryName) => {
    const localData = fs.mkdtempSync(path.join(os.tmpdir(), "Mains Türkçe Cursor "));
    const agentDirectory = path.join(localData, "cursor-agent");
    fs.mkdirSync(agentDirectory);
    const binaryPath = path.join(agentDirectory, binaryName);
    fs.writeFileSync(binaryPath, "fixture");
    vi.stubEnv("LOCALAPPDATA", localData);
    vi.stubEnv("PATH", "");
    try {
      expect(findCursorBinaryPath()).toBe(binaryPath);
      expect(providerProcessPath().split(";")).toContain(agentDirectory);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(localData, { recursive: true, force: true });
    }
  });
  it("uses semicolons and deduplicates PATH case-insensitively", () => {
    expect(mergePathDirs(null, "C:\\Program Files\\nodejs;C:\\Windows", ["c:\\windows", "C:\\Users\\Test User\\npm"], "win32"))
      .toBe("C:\\Program Files\\nodejs;C:\\Windows;C:\\Users\\Test User\\npm");
  });
  it("quotes PowerShell login paths and invokes them with the call operator", () => {
    expect(providerLoginCommand("C:\\Test User's Folder\\claude.exe", ["auth", "login"], "win32"))
      .toBe("& 'C:\\Test User''s Folder\\claude.exe' 'auth' 'login'");
  });
});
