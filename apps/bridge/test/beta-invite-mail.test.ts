import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { BRIDGE_MAIL_PER_ADDRESS_DAILY } from "../src/auth-mail";
import { bridgeBetaInvite } from "../src/beta-admin";

it("emails an invitation once through the private operations binding, never from public HTTP", async () => {
  const bundle = await build({ entryPoints: ["src/index.ts"], bundle: true, write: false, format: "esm", platform: "browser", conditions: ["workerd"], target: "es2022", external: ["cloudflare:workers", "node:*"] });
  const mail: { to: string; kind: string; subject: string }[] = [];
  const mf = new Miniflare(convertV4MiniflareOptions({ host: "127.0.0.1", port: 0, workers: [
    { name: "hub", modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-07-30", compatibilityFlags: ["nodejs_compat"],
      d1Databases: { AUTH_DB: "invite-auth" }, r2Buckets: { BLOBS: "invite-blobs" }, durableObjects: { ACCOUNT_HUB: { className: "AccountHub", useSQLite: true } },
      // The hub's configured daily total; one address's own allowance is reached first.
      bindings: { BRIDGE_MAIL_DAILY_LIMIT: "20" },
      serviceBindings: { AUTH_MAILER: async (request) => { mail.push(await request.json() as typeof mail[number]); return Response.json({ ok: true }); } } },
    { name: "operator", modules: true, compatibilityDate: "2026-07-30", serviceBindings: { OPS: { name: "hub", entrypoint: "BridgeOperations" } },
      script: `export default {async fetch(request,env){
        const value=await request.json();
        try {return Response.json(await env.OPS.sendBetaInvite(value.email,value.resend));}
        catch {return new Response('Rejected',{status:400});}
      }}` },
  ] }));
  try {
    await mf.ready;
    const db = await mf.getD1Database("AUTH_DB", "hub");
    for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = await readFile(`migrations/${file}`, "utf8");
      await db.batch(sql.split(";").filter((part) => part.trim()).map((part) => db.prepare(part)));
    }
    const invite = async (email: string) => { const statement = bridgeBetaInvite(email); await db.prepare(statement.sql).bind(...statement.params).run(); };
    const mailedAt = async (email: string) => (await db.prepare("SELECT mailed_at FROM bridge_beta_invites WHERE email=?").bind(email).first<{ mailed_at: number | null }>())?.mailed_at;
    const operator = await mf.getWorker("operator"), hub = await mf.getWorker("hub");
    const call = (email: unknown, resend?: unknown) => operator.fetch("https://local.test", { method: "POST", body: JSON.stringify({ email, resend }) });
    const send = async (email: unknown, resend?: unknown) => (await call(email, resend)).json();

    expect(await send("nobody@example.test")).toEqual({ sent: false, reason: "not-invited" });
    await invite("Invited@Example.test");
    expect(await send(" INVITED@example.test ")).toEqual({ sent: true });
    expect(mail).toMatchObject([{ to: "invited@example.test", kind: "beta-invite", subject: "You're invited to the Mains Bridge beta" }]);
    expect(await mailedAt("invited@example.test")).toBeGreaterThan(0);
    expect(await send("invited@example.test")).toEqual({ sent: false, reason: "already-sent" });
    for (let i = 1; i < BRIDGE_MAIL_PER_ADDRESS_DAILY; i++) expect(await send("invited@example.test", true)).toEqual({ sent: true });
    // One more than an address may receive in a day is skipped like any other email would be.
    expect(await send("invited@example.test", true)).toEqual({ sent: false, reason: "skipped" });
    expect(mail).toHaveLength(BRIDGE_MAIL_PER_ADDRESS_DAILY);
    await db.prepare("UPDATE bridge_beta_invites SET status='revoked' WHERE email='invited@example.test'").run();
    expect(await send("invited@example.test", true)).toEqual({ sent: false, reason: "not-invited" });
    for (const [email, resend] of [["not an email", false], [null, false], ["invited@example.test", "yes"]]) expect((await call(email, resend)).status).toBe(400);

    await invite("late@example.test");
    await db.prepare("UPDATE bridge_limits SET count=20 WHERE id LIKE 'mail:day:%'").run();
    expect(await send("late@example.test")).toEqual({ sent: false, reason: "daily-limit" });
    expect(await mailedAt("late@example.test")).toBeNull();
    expect(mail).toHaveLength(BRIDGE_MAIL_PER_ADDRESS_DAILY);
    for (const path of ["/v1/beta/invite", "/__operations/invite", "/sendBetaInvite"]) expect((await hub.fetch(`https://local.test${path}`, { method: "POST" })).status).toBe(404);
  } finally { await mf.dispose(); }
});
