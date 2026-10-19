import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { createPrivateDirectory, loadOperationsTarget, OperationsError } from "./operations-lib";

type RunWrangler = (args: string[]) => Promise<string>;
const execute = promisify(execFile);
const runWrangler: RunWrangler = async (args) => {
  try {
    const { stdout } = await execute(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
      { env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
    return stdout;
  } catch { throw new OperationsError("A Wrangler step failed; the reset stopped there. The local export, if written, is unchanged."); }
};
const TABLES = "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,7)<>'sqlite_' AND substr(name,1,4)<>'_cf_' ORDER BY name";
const noPending = (output: string) => !output.includes("Migrations to be applied:") &&
  output.split(/\r?\n/).some((line) => /^(?:✅\s*)?No migrations to apply!$/.test(line.trim()));

/** Wrangler's JSON result for one query; anything else stops the reset before it drops a table. */
function tableNames(output: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(output); } catch { throw new OperationsError("Could not read the remote table list; nothing was dropped."); }
  const rows = Array.isArray(parsed) && parsed.length === 1 && Array.isArray(parsed[0]?.results) ? parsed[0].results as unknown[] : null;
  if (!rows || rows.some((row: any) => typeof row?.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.name)))
    throw new OperationsError("Could not read the remote table list; nothing was dropped.");
  return rows.map((row: any) => row.name as string);
}

/** Pre-release only: empties an environment completely by replacing its D1 schema with a freshly migrated,
 * empty one. Account ids come from D1, so every later sign-in gets a new account id and with it a new
 * Durable Object and R2 prefix; the old ones become unreachable. A full SQL export is written locally
 * first. Requires repeating the Worker's name. */
export async function resetAuthDatabase(environment: string, confirmation: string | undefined, run: RunWrangler = runWrangler, now = new Date()) {
  const target = await loadOperationsTarget(environment);
  if (confirmation !== target.worker) throw new OperationsError(`This erases every account in ${target.worker}. Repeat its name: --confirm ${target.worker}`);
  const flags = ["--config", `wrangler.${target.environment}.jsonc`, ...(!process.env.CLOUDFLARE_API_TOKEN ? ["--profile", target.profile] : [])];
  await mkdir(".wrangler", { recursive: true, mode: 0o700 });
  const dir = await createPrivateDirectory(join(".wrangler", `reset-${target.environment}-${now.toISOString().replace(/[:.]/g, "-")}`));
  const exported = join(dir, "auth-before-reset.sql");
  await run(["d1", "export", "AUTH_DB", "--remote", "--output", exported, ...flags]);
  const tables = tableNames(stripVTControlCharacters(await run(["d1", "execute", "AUTH_DB", "--remote", "--json", "--command", TABLES, ...flags])));
  // Wrangler's own migration table goes too, so every migration applies again from the first.
  if (tables.length) await run(["d1", "execute", "AUTH_DB", "--remote", "--command",
    ["PRAGMA defer_foreign_keys = on", ...tables.map((table) => `DROP TABLE IF EXISTS "${table}"`)].join("; "), ...flags]);
  await run(["d1", "migrations", "apply", "AUTH_DB", "--remote", ...flags]);
  if (!noPending(stripVTControlCharacters(await run(["d1", "migrations", "list", "AUTH_DB", "--remote", ...flags]))))
    throw new OperationsError("The tables were dropped but migrations are still pending; run the reset's migrate step again before deploying.");
  return { exported, dropped: tables };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [environment, flag, confirmation] = process.argv.slice(2);
    if (!environment || flag !== "--confirm" || process.argv.length !== 5) throw new OperationsError("Usage: reset-auth-db.ts staging|production --confirm <worker name>");
    const result = await resetAuthDatabase(environment, confirmation);
    console.log(`Reset complete. Dropped ${result.dropped.length} tables; the previous contents are in ${result.exported}.`);
  } catch (error) {
    console.error(error instanceof OperationsError ? error.message : "Bridge reset stopped.");
    process.exitCode = 1;
  }
}
