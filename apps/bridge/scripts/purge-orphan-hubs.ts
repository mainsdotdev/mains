import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";
import { deployBridge } from "./deploy";
import { loadOperationsTarget, OperationsError } from "./operations-lib";
import { parseBridgeConfig } from "./production-config";

type RunWrangler = (args: string[]) => Promise<string>;
export interface PurgeDependencies { run: RunWrangler; request: typeof fetch; secret: string; wait(ms: number): Promise<void> }
const execute = promisify(execFile);
const runWrangler: RunWrangler = async (args) => {
  try {
    const { stdout } = await execute(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), ...args],
      { env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" }, maxBuffer: 8 * 1024 * 1024, timeout: 180_000 });
    return stdout;
  } catch { throw new OperationsError("A Wrangler step failed."); }
};
const ROUTE = "/__maintenance/bridge-purge", SECRET = "BRIDGE_PURGE_TOKEN", BATCH = 100;

/** Pre-release only: deletes every account hub (Durable Object) whose account no longer exists in D1, such as
 * those an environment reset leaves behind. src/purge-worker.ts is deployed for this run alone; the normal
 * Worker goes back even when a step fails. Requires repeating the Worker's name. */
export async function purgeOrphanHubs(environment: string, confirmation: string | undefined, dependencies: Partial<PurgeDependencies> = {}) {
  const { run = runWrangler, request = fetch, secret = randomBytes(32).toString("base64url"),
    wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) } = dependencies;
  const target = await loadOperationsTarget(environment);
  if (confirmation !== target.worker) throw new OperationsError(`This permanently deletes every account hub no account in ${target.worker} owns. Repeat its name: --confirm ${target.worker}`);
  const flags = ["--config", `wrangler.${target.environment}.jsonc`, ...(!process.env.CLOUDFLARE_API_TOKEN ? ["--profile", target.profile] : [])];
  const origin = new URL(parseBridgeConfig(await readFile(target.configPath, "utf8")).vars.BRIDGE_AUTH_URL).origin;
  const output = stripVTControlCharacters(await run(["auth", "token", "--json", ...flags]));
  let credential: unknown;
  try { credential = JSON.parse(output.slice(output.indexOf("{"))).token; } catch { /* reported below */ }
  if (typeof credential !== "string" || !credential) throw new OperationsError("Wrangler returned no Cloudflare credential; nothing was deleted.");

  const api = async (path: string) => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/durable_objects/namespaces${path}`,
      { headers: { Authorization: `Bearer ${credential}` } });
    const body: any = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result)) throw new OperationsError("Cloudflare did not list the account hubs.");
    return body;
  };
  // Only objects that hold storage cost anything; Cloudflare drops the rest on its own.
  async function storedHubs(): Promise<string[]> {
    const namespaces = (await api("?per_page=1000")).result.filter((entry: any) => entry?.script === target.worker && entry?.class === "AccountHub");
    if (namespaces.length !== 1 || !/^[0-9a-f]{32}$/.test(namespaces[0].id)) throw new OperationsError(`Could not find ${target.worker}'s AccountHub namespace.`);
    const ids: string[] = [];
    let cursor = "";
    do {
      const page = await api(`/${namespaces[0].id}/objects?limit=10000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      for (const object of page.result) {
        if (typeof object?.id !== "string" || !/^[0-9a-f]{64}$/.test(object.id)) throw new OperationsError("Cloudflare listed an invalid Durable Object id.");
        if (object.hasStoredData === true) ids.push(object.id);
      }
      cursor = typeof page.result_info?.cursor === "string" ? page.result_info.cursor : "";
    } while (cursor);
    return ids;
  }
  async function until(check: () => Promise<boolean>, failure: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await check().catch(() => false)) return;
      await wait(2_000);
    }
    throw new OperationsError(failure);
  }
  const purge = (ids: string[], confirm: boolean) => request(new URL(ROUTE, origin),
    { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ ids, confirm }) });

  const stored = await storedHubs();
  const result = { purged: [] as string[], owned: [] as string[] };
  if (!stored.length) return { ...result, remaining: [] as string[] };
  let failure: unknown = null;
  try {
    const dir = await mkdtemp(join(tmpdir(), "mains-bridge-purge-"));
    try {
      await writeFile(join(dir, "secrets.json"), JSON.stringify({ [SECRET]: secret }), { flag: "wx", mode: 0o600 });
      await run(["deploy", "src/purge-worker.ts", "--secrets-file", join(dir, "secrets.json"), ...flags]);
    } finally { await rm(dir, { recursive: true, force: true }); }
    // A deployment reaches the edge within seconds; a dry run that answers proves the overlay is serving.
    await until(async () => (await purge(stored.slice(0, BATCH), false)).ok, "The maintenance route never answered; nothing was deleted.");
    for (let index = 0; index < stored.length; index += BATCH) {
      const response = await purge(stored.slice(index, index + BATCH), true);
      const body: any = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.purged) || !Array.isArray(body?.owned))
        throw new OperationsError(`A purge batch failed (${response.status}). Purged hubs stay deleted; running the purge again continues.`);
      result.purged.push(...body.purged); result.owned.push(...body.owned);
    }
  } catch (error) { failure = error; }
  // The overlay never outlives this run, whatever failed above; a failed restore is the more urgent report.
  try { await deployBridge(target.environment, run); }
  catch { throw new OperationsError(`The maintenance overlay may still be deployed. Run npm run ${target.environment}:deploy now.`); }
  try { await run(["secret", "delete", SECRET, ...flags]); }
  catch { throw new OperationsError(`The normal Worker is back, but its temporary ${SECRET} secret could not be deleted; delete it with wrangler secret delete.`); }
  if (failure) throw failure;
  await until(async () => (await request(new URL(ROUTE, origin), { method: "POST" })).status === 404,
    `The maintenance route still answers. Run npm run ${target.environment}:deploy now.`);
  return { ...result, remaining: (await storedHubs()).filter((id) => !result.owned.includes(id)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [environment, flag, confirmation] = process.argv.slice(2);
    if (!environment || flag !== "--confirm" || process.argv.length !== 5) throw new OperationsError("Usage: purge-orphan-hubs.ts staging|production --confirm <worker name>");
    const result = await purgeOrphanHubs(environment, confirmation);
    // An emptied hub keeps its listing until it shuts down (about ten minutes on staging); a later run rechecks.
    console.log(`Purged ${result.purged.length} account hubs and kept ${result.owned.length} that belong to accounts. ` +
      `Cloudflare still lists ${result.remaining.length} other hubs with stored data; emptied hubs drop off within minutes, and running the purge again later reports what is left.`);
  } catch (error) {
    console.error(error instanceof OperationsError ? error.message : "Bridge purge stopped.");
    process.exitCode = 1;
  }
}
