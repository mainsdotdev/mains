import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthDatabase } from "../scripts/reset-auth-db";

const tables = JSON.stringify([{ results: [{ name: "account" }, { name: "bridge_backends" }, { name: "d1_migrations" }, { name: "user" }], success: true }]);
const cwd = process.cwd(), dirs: string[] = [];
beforeEach(async () => {
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
  // The reset writes its export under .wrangler; keep test runs out of the checkout's own copy.
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-reset-")); dirs.push(dir);
  for (const file of ["wrangler.staging.jsonc", "wrangler.production.jsonc"]) await copyFile(join(cwd, file), join(dir, file));
  process.chdir(dir);
});
afterEach(async () => { process.chdir(cwd); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
function wrangler(overrides: { list?: string; migrations?: string } = {}) {
  return vi.fn(async (args: string[]) => {
    if (args[1] === "execute" && args.includes("--json")) return overrides.list ?? tables;
    if (args[1] === "migrations" && args[2] === "list") return overrides.migrations ?? "✅ No migrations to apply!\n";
    return "";
  });
}

describe("Bridge pre-release environment reset", () => {
  it.each(["staging", "production"])("exports %s's D1, then drops every table and migrates it from the first migration", async (environment) => {
    const run = wrangler(), worker = `mains-bridge-${environment}`;
    const result = await resetAuthDatabase(environment, worker, run, new Date("2026-10-19T12:00:00.000Z"));
    const flags = ["--config", `wrangler.${environment}.jsonc`, "--profile", environment === "production" ? "mains-production" : "default"];
    expect(run.mock.calls.map(([args]) => args.slice(0, 3))).toEqual([["d1", "export", "AUTH_DB"], ["d1", "execute", "AUTH_DB"], ["d1", "execute", "AUTH_DB"], ["d1", "migrations", "apply"], ["d1", "migrations", "list"]]);
    for (const [args] of run.mock.calls) expect(args.slice(-flags.length)).toEqual(flags);
    expect(result.exported.endsWith(join(".wrangler", `reset-${environment}-2026-10-19T12-00-00-000Z`, "auth-before-reset.sql"))).toBe(true);
    expect(run.mock.calls[0][0]).toContain(result.exported);
    expect(run.mock.calls[2][0]).toContain('PRAGMA defer_foreign_keys = on; DROP TABLE IF EXISTS "account"; DROP TABLE IF EXISTS "bridge_backends"; DROP TABLE IF EXISTS "d1_migrations"; DROP TABLE IF EXISTS "user"');
    expect(result.dropped).toEqual(["account", "bridge_backends", "d1_migrations", "user"]);
    expect((await stat(join(".wrangler", `reset-${environment}-2026-10-19T12-00-00-000Z`))).mode & 0o777).toBe(0o700);
  });
  it.each([undefined, "", "mains-bridge-production", "staging"])("does nothing without the exact Worker name (%s)", async (confirmation) => {
    const run = wrangler();
    await expect(resetAuthDatabase("staging", confirmation, run)).rejects.toThrow(/--confirm mains-bridge-staging/);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(["", "not json", JSON.stringify([{ results: [{ name: "user; DROP" }] }]), JSON.stringify([])])("never drops a table when the table list is unreadable (%s)", async (list) => {
    const run = wrangler({ list });
    await expect(resetAuthDatabase("staging", "mains-bridge-staging", run)).rejects.toThrow(/nothing was dropped/);
    expect(run.mock.calls.some(([args]) => args.join(" ").includes("DROP TABLE"))).toBe(false);
  });
  it("reports migrations still pending after the drop instead of claiming success", async () => {
    const run = wrangler({ migrations: "Migrations to be applied:\n0001_auth.sql" });
    await expect(resetAuthDatabase("staging", "mains-bridge-staging", run)).rejects.toThrow(/still pending/);
  });
  it("routes the production reset through the production isolation check", async () => {
    const { scripts } = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    expect(scripts["staging:reset"]).toBe("tsx scripts/reset-auth-db.ts staging");
    expect(scripts["production:reset"]).toBe("npm run production:check && tsx scripts/reset-auth-db.ts production");
  });
});
