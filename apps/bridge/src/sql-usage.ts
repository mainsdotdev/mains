import { AsyncLocalStorage } from "node:async_hooks";
import type { BridgeDiagnosticsEnv } from "./observability";

export interface SqlUsageEnv extends BridgeDiagnosticsEnv { BRIDGE_SQL_USAGE_SAMPLE_RATE?: string }
export type SqlUsageOperation = "initialize" | "connect" | "disconnect" | "hello" | "push" | "pull" | "subscribe" | "compact" |
  "quota" | "reserve" | "put" | "protectRead" | "snapshot" | "checkpoint" | "membership";
export interface SqlUsageEvent {
  event: "bridge.sql_usage"; hubId: string; environment: string; operation: SqlUsageOperation;
  rowsRead: number; rowsWritten: number; queries: number; durationMs: number;
  limitsCacheHits: number; limitsCacheMisses: number; failed: boolean; sampleRate: number;
}
type Span = { cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[]; hits: number; misses: number };

/** Sample complete operations, not individual queries. Keep native cursors so
 * lazy iteration/early breaks are counted at completion without changing their
 * semantics. No SQL/bindings/identities are logged and no counters are stored. */
export function createSqlUsage(storage: DurableObjectStorage, env: SqlUsageEnv, hubId: string,
  emit: (event: SqlUsageEvent) => void = (event) => console.info(JSON.stringify(event))) {
  const context = new AsyncLocalStorage<Span>();
  const configured = env.BRIDGE_SQL_USAGE_SAMPLE_RATE === undefined ? NaN : Number(env.BRIDGE_SQL_USAGE_SAMPLE_RATE);
  const sampleRate = Number.isFinite(configured) && configured >= 0 && configured <= 1 ? configured :
    env.BRIDGE_ENV === "staging" || env.BRIDGE_ENV === "production" ? 0.1 : 0;
  function exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) {
    const cursor = storage.sql.exec<T>(query, ...bindings);
    context.getStore()?.cursors.push(cursor);
    return cursor;
  }
  const sql = new Proxy(storage.sql, { get(target, key) {
    if (key === "exec") return exec;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const measured = new Proxy(storage, { get(target, key) {
    if (key === "sql") return sql;
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return {
    storage: measured,
    limitsCache(hit: boolean) { const span = context.getStore(); if (span) { if (hit) span.hits++; else span.misses++; } },
    run<T>(operation: SqlUsageOperation, handle: () => T): T {
      const rate = sampleRate > 0 && operation === "compact" ? 1 : sampleRate;
      if (rate === 0 || Math.random() >= rate) return handle();
      const span: Span = { cursors: [], hits: 0, misses: 0 }, started = performance.now();
      const finish = (failed: boolean) => {
        try {
          emit({ event: "bridge.sql_usage", hubId: /^[a-f0-9]{64}$/i.test(hubId) ? hubId : "unavailable",
            environment: env.BRIDGE_ENV === "production" || env.BRIDGE_ENV === "staging" ? env.BRIDGE_ENV : "local", operation, rowsRead: span.cursors.reduce((sum, cursor) => sum + cursor.rowsRead, 0),
            rowsWritten: span.cursors.reduce((sum, cursor) => sum + cursor.rowsWritten, 0), queries: span.cursors.length,
            durationMs: Math.round((performance.now() - started) * 100) / 100, limitsCacheHits: span.hits,
            limitsCacheMisses: span.misses, failed, sampleRate: rate });
        } catch { /* Metrics must never affect publication, authentication or quota decisions. */ }
        finally { span.cursors.length = 0; }
      };
      return context.run(span, () => {
        try {
          const value = handle();
          if (value && typeof (value as { then?: unknown }).then === "function") {
            return Promise.resolve(value).then((result) => { finish(false); return result; }, (error) => { finish(true); throw error; }) as T;
          }
          finish(false); return value;
        } catch (error) { finish(true); throw error; }
      });
    },
  };
}
