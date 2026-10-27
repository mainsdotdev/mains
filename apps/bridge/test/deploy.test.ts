import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deployBridge } from "../scripts/deploy";
beforeEach(() => { vi.stubEnv("CLOUDFLARE_API_TOKEN", ""); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("Bridge deploy migration gate", () => {
  it.each(["staging", "production"])("checks %s's remote D1 before deploying with the same config and profile", async (environment) => {
    const run = vi.fn(async () => "✅ No migrations to apply!\n");
    await deployBridge(environment, run);
    const flags = ["--config", `wrangler.${environment}.jsonc`, "--profile", environment === "production" ? "mains-production" : "default"];
    expect(run.mock.calls).toEqual([
      [["d1", "migrations", "list", "AUTH_DB", "--remote", ...flags]],
      [["deploy", ...flags]],
    ]);
  });
  it.each(["Migrations to be applied:\n│ 0006_backend_token_handover.sql │", "", "Unknown response", "No migrations to apply!\nMigrations to be applied:\n0006.sql"])("never deploys when migrations are pending or their state is unknown (%s)", async (output) => {
    const run = vi.fn(async () => output);
    await expect(deployBridge("staging", run)).rejects.toThrow(/migration/i);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("never deploys after a failed remote check", async () => {
    const run = vi.fn(async () => { throw new Error("Injected authorization failure"); });
    await expect(deployBridge("production", run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit environment and routes both npm deploy commands through the gate", async () => {
    const run = vi.fn(async () => "✅ No migrations to apply!");
    await expect(deployBridge("", run)).rejects.toThrow(); expect(run).not.toHaveBeenCalled();
    const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(scripts["staging:deploy"]).toBe("tsx scripts/deploy.ts staging");
    expect(scripts["production:deploy"]).toBe("npm run production:check && tsx scripts/deploy.ts production");
  });
  it("uses API-token authentication consistently when CI has an account-scoped token", async () => {
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "synthetic-test-token");
    const run = vi.fn(async () => "\u001b[32m✅ No migrations to apply!\u001b[0m\r\n");
    await deployBridge("production", run);
    expect(run.mock.calls).toEqual([
      [["d1", "migrations", "list", "AUTH_DB", "--remote", "--config", "wrangler.production.jsonc"]],
      [["deploy", "--config", "wrangler.production.jsonc"]],
    ]);
  });
  it("blocks on real Wrangler's pending-0006 output and passes after applying it only to a disposable local D1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mains-deploy-gate-")), execute = promisify(execFile);
    try {
      const migrations = join(dir, "migrations"), config = join(dir, "wrangler.jsonc"); await mkdir(migrations);
      const source = new URL("../migrations/", import.meta.url);
      for (const name of await readdir(source)) if (name.endsWith(".sql") && !name.startsWith("0006_")) await cp(new URL(name, source), join(migrations, name));
      await writeFile(config, JSON.stringify({ name: "local-deploy-gate", compatibility_date: "2026-07-30",
        d1_databases: [{ binding: "AUTH_DB", database_name: "local-deploy-gate", database_id: "00000000-0000-4000-8000-000000000001", migrations_dir: "migrations" }] }));
      const local = async (operation: "list" | "apply") => (await execute(process.execPath,
        [resolve("node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", operation, "AUTH_DB", "--local", "--config", config, "--persist-to", join(dir, "state")],
        { env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
      await local("apply");
      await cp(new URL("0006_backend_token_handover.sql", source), join(migrations, "0006_backend_token_handover.sql"));
      const deployed: string[][] = [];
      const run = async (args: string[]) => {
        if (args[0] === "deploy") { deployed.push(args); return "simulated deploy only"; }
        expect(args.slice(0, 5)).toEqual(["d1", "migrations", "list", "AUTH_DB", "--remote"]);
        return local("list");
      };
      await expect(deployBridge("staging", run)).rejects.toThrow(/migrations are pending/); expect(deployed).toEqual([]);
      await local("apply");
      await expect(deployBridge("staging", run)).resolves.toBe("simulated deploy only"); expect(deployed).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 60_000);
});
