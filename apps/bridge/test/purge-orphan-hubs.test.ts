import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { purgeOrphanHubs } from "../scripts/purge-orphan-hubs";

const cwd = process.cwd(), dirs: string[] = [], secret = "s".repeat(43), namespace = "a".repeat(32);
const hex = (n: number) => n.toString(16).padStart(64, "0");
beforeEach(async () => {
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
  const dir = await mkdtemp(join(tmpdir(), "mains-bridge-purge-test-")); dirs.push(dir);
  for (const file of ["wrangler.staging.jsonc", "wrangler.production.jsonc"]) await copyFile(join(cwd, file), join(dir, file));
  process.chdir(dir);
});
afterEach(async () => { process.chdir(cwd); vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

/** A fake Cloudflare: `stored` hubs hold data, `owned` ones belong to a D1 user, and the route answers only while the overlay is deployed. */
function cloudflare(environment: string, stored: string[], owned: string[], options: { failBatch?: boolean; neverServes?: boolean } = {}) {
  const worker = `mains-bridge-${environment}`, origin = environment === "production" ? "https://bridge.mains.dev" : "https://mains-bridge-staging.team-68e.workers.dev";
  let overlay = false, remaining = [...stored];
  const secrets: string[] = [], batches: { ids: string[]; confirm: boolean }[] = [];
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === "auth") return 'Some notice\n{"type":"oauth","token":"cf-credential"}';
    if (args[0] === "d1") return "✅ No migrations to apply!\n";
    if (args[0] === "deploy") {
      overlay = args[1] === "src/purge-worker.ts";
      if (overlay) secrets.push(await readFile(args[args.indexOf("--secrets-file") + 1], "utf8"));
    }
    return "";
  });
  const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "api.cloudflare.com") {
      expect(init?.headers).toEqual({ Authorization: "Bearer cf-credential" });
      expect(url.pathname.startsWith("/client/v4/accounts/")).toBe(true);
      if (url.pathname.endsWith("/namespaces")) return Response.json({ success: true, result: [{ id: "b".repeat(32), script: "other", class: "AccountHub" }, { id: namespace, script: worker, class: "AccountHub" }] });
      expect(url.pathname.endsWith(`/namespaces/${namespace}/objects`)).toBe(true);
      return Response.json({ success: true, result: [...remaining.map((id) => ({ id, hasStoredData: true })), { id: hex(999), hasStoredData: false }], result_info: {} });
    }
    expect(`${url.origin}${url.pathname}`).toBe(`${origin}/__maintenance/bridge-purge`);
    if (!overlay || options.neverServes) return new Response("Not found", { status: 404 });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
    const body = JSON.parse(String(init?.body)) as { ids: string[]; confirm: boolean };
    batches.push(body);
    if (body.confirm && options.failBatch && batches.filter((batch) => batch.confirm).length === 2) return new Response("Reset blocked", { status: 409 });
    if (body.confirm) remaining = remaining.filter((id) => owned.includes(id) || !body.ids.includes(id));
    return Response.json({ purged: body.ids.filter((id) => !owned.includes(id)), owned: body.ids.filter((id) => owned.includes(id)) });
  });
  return { run, request: request as unknown as typeof fetch, secrets, batches, get overlay() { return overlay; } };
}
const commands = (run: ReturnType<typeof vi.fn>) => run.mock.calls.map(([args]) => (args as string[]).slice(0, 2).join(" "));

describe("Bridge orphan hub purge", () => {
  it.each(["staging", "production"])("deletes %s's ownerless hubs in batches through a temporary overlay, then restores the normal Worker", async (environment) => {
    const stored = Array.from({ length: 150 }, (_, index) => hex(index)), owned = [hex(7), hex(120)];
    const fake = cloudflare(environment, stored, owned);
    const result = await purgeOrphanHubs(environment, `mains-bridge-${environment}`, { run: fake.run, request: fake.request, secret, wait: async () => {} });
    expect(commands(fake.run)).toEqual(["auth token", "deploy src/purge-worker.ts", "d1 migrations", "deploy --config", "secret delete"]);
    const flags = ["--config", `wrangler.${environment}.jsonc`, "--profile", environment === "production" ? "mains-production" : "default"];
    for (const [args] of fake.run.mock.calls) expect(args.slice(-flags.length)).toEqual(flags);
    expect(fake.run.mock.calls[4][0]).toContain("BRIDGE_PURGE_TOKEN");
    // The secret went up with the overlay and never stayed on disk.
    expect(fake.secrets).toEqual([JSON.stringify({ BRIDGE_PURGE_TOKEN: secret })]);
    const file = fake.run.mock.calls[1][0][fake.run.mock.calls[1][0].indexOf("--secrets-file") + 1];
    await expect(stat(file)).rejects.toThrow();
    expect(fake.batches.map((batch) => [batch.ids.length, batch.confirm])).toEqual([[100, false], [100, true], [50, true]]);
    expect(result.owned).toEqual(owned);
    expect(result.purged).toEqual(stored.filter((id) => !owned.includes(id)));
    expect(result.remaining).toEqual([]);
    expect(fake.overlay).toBe(false);
  });
  it.each([undefined, "", "mains-bridge-production", "staging"])("does nothing without the exact Worker name (%s)", async (confirmation) => {
    const fake = cloudflare("staging", [hex(1)], []);
    await expect(purgeOrphanHubs("staging", confirmation, { run: fake.run, request: fake.request, secret })).rejects.toThrow(/--confirm mains-bridge-staging/);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it("deploys nothing when no hub holds data", async () => {
    const fake = cloudflare("staging", [], []);
    expect(await purgeOrphanHubs("staging", "mains-bridge-staging", { run: fake.run, request: fake.request, secret })).toEqual({ purged: [], owned: [], remaining: [] });
    expect(commands(fake.run)).toEqual(["auth token"]);
  });
  it("restores the normal Worker after a failed batch and reports what stays deleted", async () => {
    const fake = cloudflare("staging", Array.from({ length: 150 }, (_, index) => hex(index)), [], { failBatch: true });
    await expect(purgeOrphanHubs("staging", "mains-bridge-staging", { run: fake.run, request: fake.request, secret, wait: async () => {} }))
      .rejects.toThrow(/batch failed \(409\).*running the purge again continues/);
    expect(commands(fake.run).slice(-3)).toEqual(["d1 migrations", "deploy --config", "secret delete"]);
    expect(fake.overlay).toBe(false);
  });
  it("deletes nothing when the overlay never answers, and still restores the normal Worker", async () => {
    const fake = cloudflare("staging", [hex(1)], [], { neverServes: true }), wait = vi.fn(async () => {});
    await expect(purgeOrphanHubs("staging", "mains-bridge-staging", { run: fake.run, request: fake.request, secret, wait })).rejects.toThrow(/never answered; nothing was deleted/);
    expect(fake.batches).toEqual([]);
    expect(wait).toHaveBeenCalledTimes(30);
    expect(commands(fake.run).slice(-2)).toEqual(["deploy --config", "secret delete"]);
  });
});
