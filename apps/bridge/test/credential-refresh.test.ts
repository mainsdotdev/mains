import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("commits first use despite a DO reset without leaking credentials to diagnostics", async () => {
  // Real handleDevices and D1, with a fault only at the socket-control boundary.
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: "refresh-probe.ts", contents: `
    import { handleDevices } from './src/devices.ts';
    const diagnostics = [];
    console.error = console.warn = value => { diagnostics.push(value); };
    export default { fetch(request, env) {
      if (new URL(request.url).pathname === '/diagnostics') return Response.json(diagnostics);
      return handleDevices(request, env, { approval: async () => {}, revoked: async () => {}, rotated: async () => { throw new Error('Injected DO reset'); } });
    } };
  ` }, bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd"], external: ["cloudflare:workers", "node:*"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"], d1Databases: { AUTH_DB: "refresh-probe" },
    host: "127.0.0.1", port: 0 }));
  try {
    const url = await mf.ready, db = await mf.getD1Database("AUTH_DB");
    await db.prepare("CREATE TABLE user(id TEXT PRIMARY KEY)").run();
    await db.prepare(await readFile(new URL("../migrations/0002_bridge_identity.sql", import.meta.url), "utf8")).run();
    await db.prepare("INSERT INTO user VALUES('test-account')").run();
    const old = `b7_${randomBytes(32).toString("hex")}`, expires = Date.now() + 86400_000;
    await db.prepare(`INSERT INTO bridge_backends(account_id,backend_id,public_key,label,platform,status,token_hash,token_expires_at,created_at)
      VALUES('test-account','B',?,'Test','test','approved',?,?,?)`)
      .bind(randomBytes(32).toString("base64url"), createHash("sha256").update(old).digest("hex"), expires, Date.now()).run();
    const before = await db.prepare("SELECT * FROM bridge_backends").first();
    await db.prepare(await readFile(new URL("../migrations/0006_backend_token_handover.sql", import.meta.url), "utf8")).run();
    expect(await db.prepare("SELECT * FROM bridge_backends").first()).toEqual({ ...before, next_token_hash: null, next_token_expires_at: null });
    const hash = createHash("sha256").update(old).digest("hex");
    const plan = await db.prepare("EXPLAIN QUERY PLAN SELECT * FROM bridge_backends WHERE (token_hash=? AND token_expires_at>?) OR (next_token_hash=? AND next_token_expires_at>?)")
      .bind(hash, Date.now(), hash, Date.now()).all<{ detail: string }>();
    expect(plan.results.map((row) => row.detail).join(" ")).toContain("bridge_backends_next_token_hash");
    expect(plan.results.map((row) => row.detail).join(" ")).not.toContain("SCAN bridge_backends");
    const call = (path: string, token: string, method = "GET", body?: unknown) => fetch(new URL(path, url), { method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const successor = `b7_${randomBytes(32).toString("hex")}`, nextTokenHash = createHash("sha256").update(successor).digest("hex");
    const response = await call("/v1/backends/refresh", old, "POST", { nextTokenHash });
    expect(response.status).toBe(200);
    const next = await response.json() as { expiresAt: number };
    expect(Object.keys(next)).toEqual(["nextTokenHash", "expiresAt"]); expect(next.expiresAt).toBeGreaterThan(expires);
    expect(await db.prepare("SELECT next_token_hash FROM bridge_backends").first()).toEqual({ next_token_hash: nextTokenHash });
    // Possession of the predecessor cannot reveal the client's chosen token.
    expect(await (await call("/v1/backends/refresh", old, "POST", { nextTokenHash })).json()).toEqual(next);
    const conflictingHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    expect((await call("/v1/backends/refresh", old, "POST", { nextTokenHash: conflictingHash })).status).toBe(409);
    expect((await call("/v1/keys/mine", old)).status).toBe(200);
    expect(await (await fetch(new URL("/diagnostics", url))).json()).toEqual([]);
    expect((await call("/v1/keys/mine", successor)).status).toBe(200);
    expect((await call("/v1/keys/mine", old)).status).toBe(401);
    const logs = await (await fetch(new URL("/diagnostics", url))).json() as string[];
    expect(logs.join("")).toContain('"operation":"identity"');
    expect(logs.join("")).not.toContain(successor); expect(logs.join("")).not.toContain(old);
  } finally { await mf.dispose(); }
});
