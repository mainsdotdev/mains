/** Disposable LOCAL restore drill only. Never a production entrypoint. */
import { DurableObject } from "cloudflare:workers";
import { BRIDGE_PUBLICATION_RECEIPT_BYTES, createHubStore } from "./store";
import type { HubSnapshot, HubPage } from "./hub-backup";

export class RecoveryHub extends DurableObject {
  initialize(snapshot: HubSnapshot) {
    const sql = this.ctx.storage.sql;
    if (sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__cf_%'").toArray().length) throw new Error("Restore target is not empty");
    this.ctx.storage.transactionSync(() => {
      for (const entry of snapshot.schema.filter((entry) => entry.type === "table")) sql.exec(entry.sql);
    });
  }
  page(table: string, page: HubPage) {
    if (!/^[a-z_]+$/.test(table) || page.changed) throw new Error("Invalid recovery page");
    const sql = this.ctx.storage.sql, columns = sql.exec(`PRAGMA table_info("${table}")`).toArray().map((row) => `"${row.name}"`);
    if (!columns.length) throw new Error("Unknown recovery table");
    this.ctx.storage.transactionSync(() => {
      for (const row of page.rows) sql.exec(`INSERT INTO "${table}"(rowid,${columns.join(",")}) VALUES(${Array(columns.length + 1).fill("?").join(",")})`, row.rowid, ...row.values);
    });
  }
  finish(snapshot: HubSnapshot) {
    this.ctx.storage.transactionSync(() => {
      for (const entry of snapshot.schema.filter((entry) => entry.type !== "table")) this.ctx.storage.sql.exec(entry.sql);
    });
    // Re-open through the real store's normal initialization/upgrade path.
    createHubStore(this.ctx.storage);
    const sql = this.ctx.storage.sql;
    const recordBytes = Number(sql.exec("SELECT coalesce(sum(length(CAST(envelope AS BLOB))),0) AS n FROM (SELECT envelope FROM latest UNION ALL SELECT envelope FROM deleted)").one().n)
      + Number(sql.exec("SELECT count(*) n FROM publications").one().n) * BRIDGE_PUBLICATION_RECEIPT_BYTES;
    if (recordBytes !== sql.exec("SELECT bytes FROM record_usage WHERE id=1").one().bytes) throw new Error("Restored record usage mismatch");
    const chunks = sql.exec("SELECT coalesce(sum(CASE WHEN stored=1 THEN bytes ELSE 0 END),0) AS b,coalesce(sum(CASE WHEN stored=0 THEN bytes ELSE 0 END),0) AS r FROM quota_chunks").one();
    const usage = sql.exec("SELECT * FROM quota_usage WHERE id=1").one();
    if (chunks.b !== usage.blob_bytes || chunks.r !== usage.reserved_bytes) throw new Error("Restored blob usage mismatch");
    if (sql.exec("SELECT 1 FROM blob_objects o WHERE o.refs<>(SELECT count(*) FROM blob_links l WHERE l.blob_id=o.blob_id) LIMIT 1").toArray().length) throw new Error("Restored blob references mismatch");
    return { tables: snapshot.tables.length, rows: snapshot.tables.reduce((sum, table) => sum + Number(this.ctx.storage.sql.exec(`SELECT count(*) AS n FROM "${table}"`).one().n), 0) };
  }
  pull(stream: string, after: number) { return createHubStore(this.ctx.storage).pull(stream as any, after, 200); }
  push(backend: string, stream: string, records: any[]) { return createHubStore(this.ctx.storage).push(backend, stream as any, records); }
}
export default {
  async fetch(request: Request, env: { RESTORE: DurableObjectNamespace<RecoveryHub> }) {
    // Invoked in-process by Miniflare only. This module is not bound to any
    // deployed Worker and cannot access a remote namespace or bucket.
    const value = await request.json() as { account: string; action: string; args: any[] };
    const stub = env.RESTORE.get(env.RESTORE.idFromName(value.account));
    switch (value.action) {
      case "initialize": await stub.initialize(value.args[0]); return Response.json({ ok: true });
      case "page": await stub.page(value.args[0], value.args[1]); return Response.json({ ok: true });
      case "finish": return Response.json(await stub.finish(value.args[0]));
      case "pull": return Response.json(await stub.pull(value.args[0], value.args[1]));
      case "push": return Response.json(await stub.push(value.args[0], value.args[1], value.args[2]));
      default: return new Response("Local restore only", { status: 404 });
    }
  },
};
