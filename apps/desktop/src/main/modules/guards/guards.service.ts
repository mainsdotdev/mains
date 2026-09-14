// ─────────────────────────────────────────────────────────────
// Guards Service
// Business logic for dependency security checks and hook building
// ─────────────────────────────────────────────────────────────

import type {
  PackageIdentifier,
  PackageCheckResult,
  PackageScore,
  ManifestScanResult,
} from "./adapters/adapter.types";
import { getActiveGuard, getActiveGuardInfo } from "./adapters/adapter.factory";
import { parseInstallCommand } from "./guards.utils";
import { logWorkspaceActivity } from "../workspace";

// Throw-style: methods return plain values and throw on failure; the
// ServiceResponse envelope is applied by handle() at the IPC seam.
export const guardsService = {
  /**
   * Get info about the active guard provider
   */
  getActiveGuard(): { id: string; displayName: string } | null {
    return getActiveGuardInfo();
  },

  /**
   * Check a single package
   */
  async checkPackage(pkg: PackageIdentifier): Promise<PackageCheckResult> {
    const adapter = await getActiveGuard();
    if (!adapter) {
      throw new Error("No guard service is connected");
    }

    return adapter.checkPackage(pkg);
  },

  /**
   * Batch check multiple packages
   */
  async checkPackages(pkgs: PackageIdentifier[]): Promise<PackageCheckResult[]> {
    const adapter = await getActiveGuard();
    if (!adapter) {
      throw new Error("No guard service is connected");
    }

    return adapter.checkPackages(pkgs);
  },

  /**
   * Get detailed score for a package
   */
  async getPackageScore(pkg: PackageIdentifier): Promise<PackageScore> {
    const adapter = await getActiveGuard();
    if (!adapter) {
      throw new Error("No guard service is connected");
    }

    return adapter.getPackageScore(pkg);
  },

  /**
   * Check a raw command string for explicit package additions.
   * Used by Codex adapter which has no hook system — called inline.
   */
  async checkCommand(command: string): Promise<{ blocked: boolean; reason?: string }> {
    const parsed = parseInstallCommand(command);
    if (!parsed) return { blocked: false };

    try {
      const adapter = await getActiveGuard();
      if (!adapter) return { blocked: false };

      const guardInfo = getActiveGuardInfo();
      const results = await adapter.checkPackages(parsed.packages);
      const blocked = results.filter((r) => !r.allowed);

      if (blocked.length === 0) return { blocked: false };

      const details = blocked
        .map((b) => {
          const score = b.score ? ` (score: ${(b.score.overallScore * 100).toFixed(0)})` : "";
          return `${b.package.name}${score}: ${b.reason || "blocked"}`;
        })
        .join(", ");

      return {
        blocked: true,
        reason: `[Guard: ${guardInfo?.displayName}] Blocked: ${details}`,
      };
    } catch (error: any) {
      console.error("[Guards] checkCommand failed:", error);
      return { blocked: false };
    }
  },

  /**
   * Full scan of a workspace's dependencies
   */
  async scanWorkspace(
    workspaceId: string,
    rootPath: string,
  ): Promise<ManifestScanResult[]> {
    const adapter = await getActiveGuard();
    if (!adapter) {
      throw new Error("No guard service is connected");
    }

    const results = await adapter.scanProject(rootPath);

    // Log to workspace activity
    if (results.length > 0) {
      const totalSummary = results.reduce(
        (acc, r) => ({
          total: acc.total + r.summary.total,
          critical: acc.critical + r.summary.critical,
          high: acc.high + r.summary.high,
          medium: acc.medium + r.summary.medium,
          low: acc.low + r.summary.low,
          safe: acc.safe + r.summary.safe,
        }),
        { total: 0, critical: 0, high: 0, medium: 0, low: 0, safe: 0 },
      );

      logWorkspaceActivity({
        workspaceId,
        type: "finding",
        title: `Dependency scan: ${totalSummary.total} packages`,
        summary: `${totalSummary.critical} critical, ${totalSummary.high} high, ${totalSummary.medium} medium risk`,
        metadata: {
          guard: adapter.id,
          summary: totalSummary,
          ecosystems: results.map((r) => r.ecosystem),
        },
      });
    }

    return results;
  },

  /**
   * Build a PreToolUse hook for the Claude Agent SDK that intercepts
   * explicit package additions and checks them against the active guard.
   *
   * Returns null if no guard is connected.
   */
  async buildClaudeGuardHook(): Promise<{
    matcher?: string;
    hooks: Array<(
      input: Record<string, unknown>,
      toolUseId: string | null,
      context: { signal: AbortSignal },
    ) => Promise<Record<string, unknown>>>;
    timeout?: number;
  } | null> {
    const guardInfo = getActiveGuardInfo();
    if (!guardInfo) return null;

    return {
      matcher: "Bash",
      timeout: 30,
      hooks: [
        async (
          input: Record<string, unknown>,
          _toolUseId: string | null,
          _context: { signal: AbortSignal },
        ): Promise<Record<string, unknown>> => {
          const toolInput = (input.tool_input as Record<string, unknown>) || {};
          const command = (toolInput.command as string) || "";

          const parsed = parseInstallCommand(command);
          if (!parsed) {
            return {};
          }

          try {
            const adapter = await getActiveGuard();
            if (!adapter) return {};

            const results = await adapter.checkPackages(parsed.packages);
            const blocked = results.filter((r) => !r.allowed);

            if (blocked.length === 0) {
              // All packages pass
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  additionalContext: `[Guard: ${guardInfo.displayName}] All ${results.length} package(s) passed security check.`,
                },
              };
            }

            // Block the command
            const blockedDetails = blocked
              .map((b) => {
                const score = b.score ? ` (score: ${(b.score.overallScore * 100).toFixed(0)})` : "";
                const alerts = b.alerts.length > 0
                  ? ` — ${b.alerts.map((a) => `${a.severity}: ${a.title}`).join(", ")}`
                  : "";
                return `  - ${b.package.name}${score}: ${b.reason || "blocked"}${alerts}`;
              })
              .join("\n");

            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason:
                  `[Guard: ${guardInfo.displayName}] Blocked ${blocked.length} package(s):\n${blockedDetails}\n\n` +
                  "Use a safer alternative or ask the user to override.",
              },
            };
          } catch (error: any) {
            console.error("[Guards] Hook check failed:", error);
            // On error, allow the command but warn
            return {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext: `[Guard: ${guardInfo.displayName}] Warning: security check failed (${error?.message}). Proceeding without check.`,
              },
            };
          }
        },
      ],
    };
  },

  /**
   * Build a pre-tool-use hook for the Copilot SDK.
   * Copilot uses a different hook signature than Claude.
   *
   * Returns null if no guard is connected.
   */
  async buildCopilotGuardHook(): Promise<((
    input: { toolName: string; toolArgs: unknown; timestamp: number; cwd: string },
  ) => Promise<{ permissionDecision?: "allow" | "deny"; permissionDecisionReason?: string } | void>) | null> {
    const guardInfo = getActiveGuardInfo();
    if (!guardInfo) return null;

    return async (input) => {
      // Only intercept Bash/shell tools
      const toolName = input.toolName.toLowerCase();
      if (toolName !== "bash" && toolName !== "shell" && toolName !== "run_command") {
        return;
      }

      let args = input.toolArgs as Record<string, unknown> | string | null;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { return; }
      }
      const argsObj = args as Record<string, unknown> | null;
      const command = (argsObj?.command as string) || (argsObj?.input as string) || "";
      if (!command) return;

      const parsed = parseInstallCommand(command);
      if (!parsed) return;

      try {
        const adapter = await getActiveGuard();
        if (!adapter) return;

        const results = await adapter.checkPackages(parsed.packages);
        const blocked = results.filter((r) => !r.allowed);

        if (blocked.length === 0) return;

        const names = blocked.map((b) => b.package.name).join(", ");
        return {
          permissionDecision: "deny" as const,
          permissionDecisionReason: `[${guardInfo.displayName}] Blocked: ${names}`,
        };
      } catch (error: any) {
        console.error("[Guards] Copilot hook check failed:", error);
        return;
      }
    };
  },
};
