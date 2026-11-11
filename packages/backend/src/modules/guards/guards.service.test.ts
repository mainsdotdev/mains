import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardsService } from "./guards.service";

const guard = vi.hoisted(() => ({ info: vi.fn(), active: vi.fn(), checkPackages: vi.fn() }));
vi.mock("./adapters/adapter.factory", () => ({ getActiveGuardInfo: guard.info, getActiveGuard: guard.active }));
vi.mock("../workspace", () => ({ logWorkspaceActivity: vi.fn() }));

describe("Claude package guard hook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    guard.info.mockReturnValue({ id: "socketdev", displayName: "Socket" });
    guard.active.mockResolvedValue({ checkPackages: guard.checkPackages });
  });

  async function check(command: string) {
    const hook = await guardsService.buildClaudeGuardHook();
    expect(hook).toMatchObject({ matcher: "Bash", onFailure: "block" });
    return hook!.hooks[0]({ tool_input: { command } }, "tool-call", { signal: new AbortController().signal });
  }

  it("does not install a hook when no guard is configured", async () => {
    guard.info.mockReturnValue(null);
    expect(await guardsService.buildClaudeGuardHook()).toBeNull();
  });

  it("leaves commands without package additions alone", async () => {
    await expect(check("npm test")).resolves.toEqual({});
    expect(guard.active).not.toHaveBeenCalled();
  });

  it("allows a checked package and denies a package the guard rejects", async () => {
    guard.checkPackages.mockResolvedValueOnce([{ allowed: true }]);
    await expect(check("npm install safe-package")).resolves.toMatchObject({
      hookSpecificOutput: { additionalContext: expect.stringContaining("passed security check") },
    });
    guard.checkPackages.mockResolvedValueOnce([{ allowed: false, package: { name: "unsafe-package" }, alerts: [], reason: "malware" }]);
    await expect(check("npm install unsafe-package")).resolves.toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: expect.stringContaining("malware") },
    });
  });

  it.each(["unavailable", "disconnected"])("blocks an installation when the configured guard is %s", async (reason) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    if (reason === "unavailable") guard.checkPackages.mockRejectedValue(new Error("Service unavailable"));
    else guard.active.mockResolvedValue(null);
    try { await expect(check("npm install example-package")).rejects.toThrow("installation was blocked"); }
    finally { log.mockRestore(); }
  });
});
