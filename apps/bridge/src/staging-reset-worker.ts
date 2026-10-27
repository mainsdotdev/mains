// Operator-only staging overlay. The normal Worker entry never imports this file.
import worker, { AccountHub as CoreAccountHub } from "./index";
import { bridgeAccountPrefix } from "./quota";

type ResetEnv = Omit<Parameters<typeof worker.fetch>[1], "ACCOUNT_HUB"> & {
  ACCOUNT_HUB: DurableObjectNamespace<AccountHub>;
  BRIDGE_RESET_ACCOUNT?: string;
  BRIDGE_RESET_TOKEN?: string;
};
const route = "/__maintenance/bridge-reset";
const tables = ["log", "latest", "deleted", "row_owners", "runs", "streams", "presence", "backend_metadata", "write_rate", "stream_activity", "quota_chunks", "quota_state", "blob_links", "blob_objects", "blob_deletions", "compaction_jobs", "blob_uploads", "write_budget", "publications", "membership", "membership_fences", "membership_revocations"];
function allowed(env: ResetEnv, account: unknown, token: string): account is string {
  if (env.BRIDGE_AUTH_URL !== "https://mains-bridge-staging.team-68e.workers.dev" || env.BRIDGE_DEV_AUTH === "true" ||
      !env.AUTH_DB || !env.BRIDGE_RESET_ACCOUNT || !env.BRIDGE_RESET_TOKEN || env.BRIDGE_RESET_TOKEN.length < 43 ||
      typeof account !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(account) || account !== env.BRIDGE_RESET_ACCOUNT) return false;
  const supplied = new TextEncoder().encode(token), expected = new TextEncoder().encode(env.BRIDGE_RESET_TOKEN);
  return supplied.length === expected.length && crypto.subtle.timingSafeEqual(supplied, expected);
}

export default {
  async fetch(request: Request, env: ResetEnv): Promise<Response> {
    if (new URL(request.url).pathname !== route) return worker.fetch(request, env);
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    let body: { accountId?: unknown; confirm?: unknown };
    try { const text = await request.text(); if (text.length > 1024) throw new Error(); body = JSON.parse(text); }
    catch { return new Response("Invalid request", { status: 400 }); }
    const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    if (!body || !allowed(env, body.accountId, token) || typeof body.confirm !== "boolean") return new Response("Forbidden", { status: 403 });
    try {
      const hub = env.ACCOUNT_HUB.get(env.ACCOUNT_HUB.idFromName(body.accountId));
      return Response.json(await hub.resetForKeyLoss(body.accountId, token, body.confirm), { headers: { "Cache-Control": "no-store" } });
    } catch { return new Response("Reset blocked or incomplete; inspect and retry", { status: 409 }); }
  },
};

export class AccountHub extends CoreAccountHub {
  async resetForKeyLoss(account: string, token: string, confirmed: boolean) {
    const env = this.env as ResetEnv;
    if (!allowed(env, account, token) || this.ctx.id.toString() !== env.ACCOUNT_HUB.idFromName(account).toString()) throw new Error("Reset scope mismatch");
    return this.ctx.blockConcurrencyWhile(async () => {
      const db = env.AUTH_DB!, prefix = await bridgeAccountPrefix(account);
      const active = await db.prepare("SELECT count(*) n FROM bridge_backends WHERE account_id=? AND status='approved' AND (token_expires_at>? OR next_token_expires_at>?)").bind(account, Date.now(), Date.now()).first<{ n: number }>();
      if (confirmed && active!.n) throw new Error("An approved backend still exists; use approval instead");
      if (confirmed && this.ctx.storage.sql.exec("SELECT 1 FROM blob_uploads LIMIT 1").toArray().length)
        throw new Error("An upload is still in flight or awaiting reconciliation; retry after maintenance");
      const records = this.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) n FROM log").toArray()[0].n;
      const initialized = !!await db.prepare("SELECT 1 FROM bridge_accounts WHERE account_id=?").bind(account).first();
      let blobs = 0, bytes = 0, cursor: string | undefined;
      if (!confirmed) {
        do {
          const page = await env.BLOBS.list({ prefix, cursor });
          blobs += page.objects.length; bytes += page.objects.reduce((sum, object) => sum + object.size, 0);
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor);
        return { records, blobs, bytes, initialized, activeBackends: active!.n };
      }
      // Revoke first, retaining the old account row until every destructive step
      // succeeds. A failed reset remains locked and can be retried safely.
      await db.prepare("UPDATE bridge_backends SET status='revoked',token_expires_at=0,next_token_hash=NULL,next_token_expires_at=NULL WHERE account_id=?").bind(account).run();
      for (const socket of this.ctx.getWebSockets()) socket.close(1008, "Bridge account reset");
      for (;;) {
        const page = await env.BLOBS.list({ prefix, limit: 500 });
        if (!page.objects.length) break;
        blobs += page.objects.length; bytes += page.objects.reduce((sum, object) => sum + object.size, 0);
        await env.BLOBS.delete(page.objects.map((object) => object.key));
      }
      await this.ctx.storage.deleteAlarm();
      // Usage triggers zero the persistent counters as their source rows are
      // removed; keep their singleton rows available to this live DO instance.
      this.ctx.storage.transactionSync(() => { for (const table of tables) this.ctx.storage.sql.exec(`DELETE FROM ${table}`); });
      await db.batch([
        db.prepare("DELETE FROM bridge_backends WHERE account_id=?").bind(account),
        db.prepare("DELETE FROM bridge_login_codes WHERE user_id=?").bind(account),
        db.prepare("DELETE FROM bridge_accounts WHERE account_id=?").bind(account),
      ]);
      return { records, blobs, bytes, initialized: false, activeBackends: 0 };
    });
  }
}
