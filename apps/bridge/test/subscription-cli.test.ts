import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";

const execute = promisify(execFile);
it("runs the operator CLI against isolated local D1, keeps retries idempotent and defaults to local", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mains-subscription-cli-")), config = join(dir, "wrangler.jsonc");
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" };
  const run = (args: string[]) => execute(process.execPath, args, { env, timeout: 30_000, maxBuffer: 1024 ** 2 });
  const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
  const admin = (args: string[]) => run([resolve("node_modules/tsx/dist/cli.mjs"), "scripts/subscription.ts", ...args, "--account", "local-user", "--config", config]);
  const query = async () => {
    const { stdout } = await run([wrangler, "d1", "execute", "AUTH_DB", "--config", config, "--local", "--json", "--command", "SELECT * FROM account_entitlements"]);
    return JSON.parse(stdout)[0].results[0] as { status: string; billing_interval: string; expires_at: number; updated_at: number };
  };
  try {
    await writeFile(config, JSON.stringify({ name: "mains-subscription-cli-test", compatibility_date: "2026-07-30",
      d1_databases: [{ binding: "AUTH_DB", database_name: "subscription-cli-test", database_id: randomUUID() }] }));
    const schema = join(dir, "schema.sql");
    await writeFile(schema, `CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES('local-user');\n${await readFile(new URL("../migrations/0004_account_entitlements.sql", import.meta.url), "utf8")}`);
    await run([wrangler, "d1", "execute", "AUTH_DB", "--config", config, "--local", "--file", schema]);
    const monthly = ["grant", "--interval", "monthly", "--starts-at", "2026-01-31T12:00:00Z"];
    await admin(monthly); const granted = await query();
    expect(granted).toMatchObject({ status: "active", billing_interval: "monthly", expires_at: Date.parse("2026-02-28T12:00:00Z") });
    await admin(monthly); expect(await query()).toEqual(granted);
    expect((await admin(["show"])).stdout).toContain("local-user");
    await admin(["revoke"]); expect((await query()).status).toBe("revoked");
    await admin(["grant", "--interval", "yearly", "--starts-at", "2028-02-29T12:00:00Z"]);
    expect(await query()).toMatchObject({ status: "active", billing_interval: "yearly", expires_at: Date.parse("2029-02-28T12:00:00Z") });
    // This rejects before launching Wrangler; it never attempts a remote request.
    await expect(run([resolve("node_modules/tsx/dist/cli.mjs"), "scripts/subscription.ts", "show", "--account", "local-user", "--remote"])).rejects.toMatchObject({ stderr: expect.stringContaining("explicit --config") });
  } finally { await rm(dir, { recursive: true, force: true }); }
}, 90_000);
