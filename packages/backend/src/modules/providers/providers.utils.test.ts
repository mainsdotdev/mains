import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { mergePathDirs, resolveClaudeRuntime } from "./providers.utils";

describe("providers.utils / development Claude runtime", () => {
  it("resolves the SDK's native dependency without a system installation", () => {
    const runtime = resolveClaudeRuntime();
    expect(runtime?.source).toBe("bundled");
    expect(runtime?.path).toContain(`claude-agent-sdk-${process.platform}-${process.arch}`);
    expect(path.basename(runtime!.path)).toBe(process.platform === "win32" ? "claude.exe" : "claude");
    expect(fs.statSync(runtime!.path).isFile()).toBe(true);
  });
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
