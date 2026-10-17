import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { loadOperationsTarget, OperationsError } from "./operations-lib";

type RunWrangler = (args: string[]) => Promise<string>;
const execute = promisify(execFile);
const runWrangler: RunWrangler = async (args) => {
  try {
    const { stdout } = await execute(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
      { env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 8 * 1024 * 1024, timeout: 180_000 });
    return stdout;
  } catch { throw new OperationsError("Wrangler check or deployment failed; no automatic migrations or restore were performed."); }
};

export async function deployBridge(environment: string, run: RunWrangler = runWrangler): Promise<string> {
  const target = await loadOperationsTarget(environment);
  const flags = ["--config", `wrangler.${target.environment}.jsonc`, ...(!process.env.CLOUDFLARE_API_TOKEN ? ["--profile", target.profile] : [])];
  const output = stripVTControlCharacters(await run(["d1", "migrations", "list", "AUTH_DB", "--remote", ...flags]));
  // Pinned Wrangler has no JSON mode for migrations list. Accept only its
  // explicit empty-list result; unknown output or a pending table fails closed.
  if (output.includes("Migrations to be applied:") || !output.split(/\r?\n/).some((line) => /^(?:✅\s*)?No migrations to apply!$/.test(line.trim())))
    throw new OperationsError(`Remote D1 migrations are pending or unverified. Back up, review and run npm run ${target.environment}:migrate before deploying.`);
  return run(["deploy", ...flags]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new OperationsError("Usage: deploy.ts staging|production");
    console.log(await deployBridge(process.argv[2]));
  } catch (error) {
    console.error(error instanceof OperationsError ? error.message : "Bridge deployment stopped; migration status could not be verified.");
    process.exitCode = 1;
  }
}
