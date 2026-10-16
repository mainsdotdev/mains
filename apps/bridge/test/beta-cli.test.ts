import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { bridgeBetaEmail, bridgeBetaExtend } from "../src/beta-admin";

const execute = promisify(execFile);
it("manages invitations in disposable local D1, preserves paid grants and rejects ambiguous remote targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mains-beta-cli-")), config = join(dir, "wrangler.jsonc"), state = join(dir, "state"), address = "operator'test@example.test";
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: "invalid-no-network-access", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
  const run = (args: string[]) => execute(process.execPath, args, { env, timeout: 30_000, maxBuffer: 1024 ** 2 });
  const wrangler = resolve("node_modules/wrangler/bin/wrangler.js"), tsx = resolve("node_modules/tsx/dist/cli.mjs");
  const admin = (args: string[]) => run([tsx, "scripts/beta.ts", ...args, "--config", config, "--persist-to", state]);
  const query = async (sql: string) => JSON.parse((await run([wrangler, "d1", "execute", "AUTH_DB", "--config", config, "--local", "--persist-to", state, "--json", "--command", sql])).stdout)[0].results;
  try {
    await writeFile(config, JSON.stringify({ name: "mains-beta-cli-test", compatibility_date: "2026-07-30", vars: { BRIDGE_ENV: "local" },
      d1_databases: [{ binding: "AUTH_DB", database_name: "beta-cli-test", database_id: randomUUID() }] }));
    const schema = join(dir, "schema.sql");
    await writeFile(schema, `CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('paid-user');\n${await readFile("migrations/0004_account_entitlements.sql", "utf8")}\nINSERT INTO account_entitlements VALUES('paid-user','bridge','standard','yearly','active',1,9999999999999,1);\n${await readFile("migrations/0005_closed_beta.sql", "utf8")}`);
    await run([wrangler, "d1", "execute", "AUTH_DB", "--config", config, "--local", "--persist-to", state, "--file", schema]);
    const paid = await query("SELECT * FROM account_entitlements"), get = async () => (await query("SELECT * FROM bridge_beta_invites"))[0];
    await admin(["invite", "--email", `  ${address.toUpperCase()}  `]); const invited = await get();
    expect(invited).toMatchObject({ email: address, account_id: null, status: "invited", activated_at: null, expires_at: null });
    await admin(["invite", "--email", address]); expect(await get()).toEqual(invited);
    expect((await admin(["list"])).stdout).toContain(address);
    expect((await admin(["show", "--email", address])).stdout).toContain(address);
    // Seed activation only in this disposable store; activation itself is tested
    // through the real Worker and verified-session HTTP flow.
    const start = Date.now(), end = start + 30 * 86_400_000;
    await query(`UPDATE bridge_beta_invites SET account_id='paid-user',status='active',activated_at=${start},expires_at=${end}`);
    const expiry = new Date(end + 86_400_000).toISOString();
    await admin(["extend", "--email", address, "--expires-at", expiry]); const extended = await get();
    expect(extended).toMatchObject({ activated_at: start, expires_at: Date.parse(expiry), status: "active" });
    await admin(["extend", "--email", address, "--expires-at", expiry]); expect(await get()).toEqual(extended);
    await admin(["revoke", "--email", address]); const revoked = await get();
    expect(revoked).toMatchObject({ status: "revoked", activated_at: start, expires_at: Date.parse(expiry) });
    await admin(["invite", "--email", address]); expect(await get()).toEqual(revoked);
    expect(await query("SELECT * FROM account_entitlements")).toEqual(paid);
    for (const args of [["--remote"], ["--environment", "production"], ["--remote", "--environment", "production", "--config", config]]) {
      await expect(run([tsx, "scripts/beta.ts", "list", ...args])).rejects.toMatchObject({ stderr: expect.stringContaining("Remote commands") });
    }
    const liveConfig = join(dir, "forbidden.jsonc");
    await writeFile(liveConfig, JSON.stringify({ account_id: "a".repeat(32) }));
    await expect(run([tsx, "scripts/beta.ts", "list", "--config", liveConfig])).rejects.toMatchObject({ stderr: expect.stringContaining("local config") });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 90_000);

it("validates operator mailboxes and explicit future expiry without alias collapsing", () => {
  expect(bridgeBetaEmail(" User+Test@Example.com ")).toBe("user+test@example.com");
  expect(bridgeBetaEmail("first.last@example.com")).toBe("first.last@example.com");
  for (const invalid of ["", "a@", "name\n@example.com", "a@example.com\u0000", "x".repeat(255) + "@example.com"]) expect(() => bridgeBetaEmail(invalid)).toThrow();
  for (const expiry of [NaN, Infinity, 999, 8_640_000_000_000_001]) expect(() => bridgeBetaExtend("user@example.com", expiry, 1000)).toThrow();
});
