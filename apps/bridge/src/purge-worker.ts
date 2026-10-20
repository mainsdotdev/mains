// Operator-only overlay that deletes account hubs no account owns any longer. The normal Worker entry never
// imports this file; scripts/purge-orphan-hubs.ts deploys it for one run and puts src/index.ts back.
import worker, { AccountHub as CoreAccountHub } from "./index";
export { BridgeOperations } from "./index";

type PurgeEnv = Omit<Parameters<typeof worker.fetch>[1], "ACCOUNT_HUB"> & {
  ACCOUNT_HUB: DurableObjectNamespace<AccountHub>;
  BRIDGE_PURGE_TOKEN?: string;
};
const route = "/__maintenance/bridge-purge";
function allowed(env: PurgeEnv, token: string): boolean {
  if (!env.AUTH_DB || !env.BRIDGE_PURGE_TOKEN || env.BRIDGE_PURGE_TOKEN.length < 43) return false;
  const supplied = new TextEncoder().encode(token), expected = new TextEncoder().encode(env.BRIDGE_PURGE_TOKEN);
  return supplied.length === expected.length && crypto.subtle.timingSafeEqual(supplied, expected);
}

export default {
  async fetch(request: Request, env: PurgeEnv): Promise<Response> {
    if (new URL(request.url).pathname !== route) return worker.fetch(request, env);
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
    if (!allowed(env, token)) return new Response("Forbidden", { status: 403 });
    let body: { ids?: unknown; confirm?: unknown };
    try { const text = await request.text(); if (text.length > 16 * 1024) throw new Error(); body = JSON.parse(text); }
    catch { return new Response("Invalid request", { status: 400 }); }
    const ids = body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || typeof body.confirm !== "boolean" ||
        !ids.every((id) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id))) return new Response("Invalid request", { status: 400 });
    let objects: DurableObjectId[];
    try { objects = ids.map((id: string) => env.ACCOUNT_HUB.idFromString(id)); }
    catch { return new Response("Unknown Durable Object", { status: 400 }); }
    // A hub stays while its account's user exists, whatever its Bridge state; every Bridge table references it.
    const named = await env.AUTH_DB!.prepare("SELECT id FROM user").all<{ id: string }>();
    const owned = new Set(named.results.map((row) => env.ACCOUNT_HUB.idFromName(row.id).toString()));
    const result = { purged: [] as string[], owned: [] as string[] };
    for (const id of objects) {
      if (owned.has(id.toString())) { result.owned.push(id.toString()); continue; }
      if (body.confirm) await env.ACCOUNT_HUB.get(id).purgeOrphan(token);
      result.purged.push(id.toString());
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  },
};

export class AccountHub extends CoreAccountHub {
  /** Deletes everything this hub stores, alarm included. Only the overlay calls it, for a hub no account names. */
  async purgeOrphan(token: string) {
    if (!allowed(this.env as PurgeEnv, token)) throw new Error("Purge is not authorized");
    await this.ctx.blockConcurrencyWhile(async () => {
      for (const socket of this.ctx.getWebSockets()) socket.close(1008, "Bridge account removed");
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
    });
  }
}
