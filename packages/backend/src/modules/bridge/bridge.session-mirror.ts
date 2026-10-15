import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SessionKey, SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import type { SQLiteInstance } from "../../db/types";
import { BRIDGE_IDLE_RETENTION_MS } from "@mains/contracts/bridge-protocol";

export interface ClaudeMirrorOptions {
  sqlite: SQLiteInstance;
  backendId: string;
  runId: string;
  sessionId: string;
  resolveEntry?: (id: string) => Promise<string>;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** One adapter per full import. Occurrence numbers preserve repeated UUID-less
 * lines, while re-importing the same JSONL does not append them a second time.
 * projectKey is deliberately ignored: the receiving machine has another cwd. */
export function createClaudeSessionMirror(options: ClaudeMirrorOptions): SessionStore {
  const { sqlite, runId, sessionId, backendId } = options;
  const occurrences = new Map<string, number>();
  function subpath(key: SessionKey) {
    if (key.sessionId !== sessionId) throw new Error("Claude mirror session mismatch");
    const value = key.subpath ?? "";
    if (key.subpath !== undefined && (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")))
      throw new Error("Invalid Claude mirror subpath");
    return value;
  }
  function assertOwner() {
    const run = sqlite.prepare("SELECT owner_backend_id,provider_id,session_id FROM runs WHERE id=?").get(runId) as { owner_backend_id: string; provider_id: string; session_id: string | null } | undefined;
    if (!run || run.owner_backend_id !== backendId || run.provider_id !== "claude_code" || run.session_id !== sessionId)
      throw new Error("Only the Claude session's owner may mirror entries");
  }
  return {
    async append(key, entries) {
      const suffix = subpath(key);
      // Validate the entire batch before mutating either SQL or occurrence state.
      const batch = entries.map((entry) => {
        if (!entry || typeof entry.type !== "string" || entry.uuid !== undefined && typeof entry.uuid !== "string") throw new Error("Invalid Claude session entry");
        const json = JSON.stringify(entry);
        return { entry, json, canonicalHash: hash(JSON.stringify(canonical(entry))) };
      });
      const nextOccurrences = new Map(occurrences);
      sqlite.transaction(() => {
        assertOwner();
        let seq = (sqlite.prepare("SELECT coalesce(max(seq),-1)+1 n FROM provider_session_entries WHERE run_id=? AND session_id=? AND subpath=?").get(runId, sessionId, suffix) as { n: number }).n;
        for (const { entry, json, canonicalHash } of batch) {
          const occurrenceKey = `${suffix}:${canonicalHash}`;
          const occurrence = nextOccurrences.get(occurrenceKey) ?? 0;
          if (!entry.uuid) nextOccurrences.set(occurrenceKey, occurrence + 1);
          const id = hash(JSON.stringify([runId, sessionId, suffix, entry.uuid ? ["uuid", entry.uuid] : ["entry", canonicalHash, occurrence]]));
          const existing = sqlite.prepare("SELECT entry FROM provider_session_entries WHERE id=?").get(id) as { entry: string | null } | undefined;
          if (existing?.entry && hash(JSON.stringify(canonical(JSON.parse(existing.entry)))) === canonicalHash) continue;
          if (existing) sqlite.prepare("UPDATE provider_session_entries SET entry=?,byte_size=?,content_hash=? WHERE id=?").run(json, Buffer.byteLength(json), hash(json), id);
          else sqlite.prepare("INSERT INTO provider_session_entries(id,run_id,session_id,subpath,seq,uuid,entry,byte_size,content_hash) VALUES(?,?,?,?,?,?,?,?,?)")
            .run(id, runId, sessionId, suffix, seq++, entry.uuid ?? null, json, Buffer.byteLength(json), hash(json));
        }
      })();
      occurrences.clear(); for (const [key, count] of nextOccurrences) occurrences.set(key, count);
    },
    async load(key) {
      const suffix = subpath(key);
      const rows = sqlite.prepare("SELECT id,entry,byte_size,content_hash FROM provider_session_entries WHERE run_id=? AND session_id=? AND subpath=? ORDER BY seq,id")
        .all(runId, sessionId, suffix) as { id: string; entry: string | null; byte_size: number; content_hash: string }[];
      if (!rows.length) return null;
      const entries: SessionStoreEntry[] = [];
      for (const row of rows) {
        if (row.entry === null && !options.resolveEntry) throw new Error("Claude session entry requires its encrypted blob");
        const bytes = row.entry === null ? await readFile(await options.resolveEntry!(row.id)) : Buffer.from(row.entry);
        if (bytes.length !== row.byte_size || hash(bytes) !== row.content_hash) throw new Error("Claude session entry integrity check failed");
        const entry = JSON.parse(bytes.toString("utf8")) as SessionStoreEntry;
        if (typeof entry.type !== "string") throw new Error("Invalid stored Claude session entry");
        entries.push(entry);
      }
      return entries;
    },
    async listSubkeys(key) {
      subpath(key);
      return (sqlite.prepare("SELECT DISTINCT subpath FROM provider_session_entries WHERE run_id=? AND session_id=? AND subpath<>'' ORDER BY subpath").all(runId, sessionId) as { subpath: string }[]).map((row) => row.subpath);
    },
  };
}

export async function importClaudeSessionMirror(options: ClaudeMirrorOptions & { dir: string }): Promise<void> {
  const { importSessionToStore } = await import("@anthropic-ai/claude-agent-sdk");
  await importSessionToStore(options.sessionId, createClaudeSessionMirror(options), { dir: options.dir, includeSubagents: true, batchSize: 100 });
}

/** A locally active session can have lost its old mirror while disconnected.
 * Queue the original clocks again; idle sessions must not defeat hub expiry. */
export function refreshClaudeSessionMirrors(sqlite: SQLiteInstance, backendId: string, now = Date.now()): number {
  return sqlite.transaction(() => {
    const cutoff = now - BRIDGE_IDLE_RETENTION_MS;
    const result = sqlite.prepare(`UPDATE bridge_row_clock SET dirty=1 WHERE table_name='provider_session_entries' AND origin=? AND dirty=0
      AND synced_seq IS NOT NULL AND coalesce(last_ack_ms,0)<=? AND EXISTS(
        SELECT 1 FROM provider_session_entries e JOIN runs r ON r.id=e.run_id
        WHERE e.id=bridge_row_clock.pk AND r.owner_backend_id=? AND r.updated_at>=?)`).run(backendId, cutoff, backendId, Math.floor(cutoff / 1000));
    if (result.changes) sqlite.exec("UPDATE bridge_config SET backfill_done=0,backfill_table=NULL,backfill_pk=NULL WHERE id=1");
    return result.changes;
  })();
}
