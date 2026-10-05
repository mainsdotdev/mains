import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergePathDirs, resolveClaudeRuntime, resolveCopilotRuntime } from "./providers.utils";

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
    expect(runtime?.path).toContain("@github/copilot-sdk-");
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

describe("providers.utils / mergePathDirs", () => {
  it("puts login-shell dirs first, then the inherited PATH, then extras", () => {
    const merged = mergePathDirs(
      "/Users/me/.nvm/versions/node/v22.1.0/bin:/opt/homebrew/bin",
      "/usr/bin:/bin",
      ["/usr/local/bin"],
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
    );
    expect(merged).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });

  it("falls back to inherited PATH plus extras when the shell read failed", () => {
    const merged = mergePathDirs(null, "/usr/bin:/bin", ["/usr/local/bin"]);
    expect(merged).toBe("/usr/bin:/bin:/usr/local/bin");
  });

  it("drops empty segments from a malformed PATH", () => {
    const merged = mergePathDirs("", "/usr/bin::/bin:", []);
    expect(merged).toBe("/usr/bin:/bin");
  });
});
