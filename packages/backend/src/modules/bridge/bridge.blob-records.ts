import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { BRIDGE_BLOB_MAX_BYTES, validateBridgeBlobIdentity, type BridgeBlobRef } from "@mains/contracts/bridge-blobs";
import type { SQLiteInstance } from "../../db/types";
import { BRIDGE_TABLES } from "./bridge.records";
import { aliasSet, clockOf, compareClock, deleted, getClock, quote, rowWhere, type RowClock } from "./bridge.sql";
import { readRow, type BridgeStore, type OutboxEntry } from "./bridge.store";
import type { BridgeBlobs } from "./bridge.blobs";

export type BridgeFileTable = "run_attachments" | "run_artifacts" | "collection_sources" | "atlas_items";
const fileTables: readonly string[] = ["run_attachments", "run_artifacts", "collection_sources", "atlas_items"];
const sameClock = (a: RowClock, b: RowClock | undefined) => !!b && compareClock(clockOf(a), clockOf(b)) === 0;
const within = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative); };

async function snapshotFile(file: string, roots: string[]): Promise<Buffer | undefined> {
  if (!path.isAbsolute(file)) return undefined;
  const resolved = path.resolve(file);
  const root = roots.map((entry) => path.resolve(entry)).find((entry) => within(entry, resolved));
  if (!root) return undefined;
  try {
    // A selected file may not traverse a symlink below its trusted execution/storage root.
    let dir = root;
    for (const part of path.relative(root, resolved).split(path.sep).slice(0, -1)) {
      dir = path.join(dir, part); if ((await fs.lstat(dir)).isSymbolicLink()) return undefined;
    }
    const entry = await fs.lstat(resolved);
    if (!entry.isFile() || entry.isSymbolicLink()) return undefined;
    const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (before.ino !== entry.ino || before.dev !== entry.dev) return undefined;
      if (!before.isFile() || before.size > BRIDGE_BLOB_MAX_BYTES) return undefined;
      const bytes = await handle.readFile(), after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) throw new Error("Bridge source file changed during snapshot");
      return bytes;
    } finally { await handle.close(); }
  } catch (error) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
    throw error;
  }
}

/** Manifests live with register clocks, so aliases, retries and rebuilds retain the
 * exact file version. A replica's source storage key is never opened locally. */
export function createBridgeBlobRecords(options: { sqlite: SQLiteInstance; backendId: string; dataDir: string; blobs: BridgeBlobs }) {
  const { sqlite, backendId, blobs, dataDir } = options;
  function needsFiles(entry: OutboxEntry) {
    return entry.op === "upsert" && BRIDGE_TABLES[entry.table_name].blobColumns.some((column) => BRIDGE_TABLES[entry.table_name].registers[entry.register].includes(column));
  }
  return {
    async captureOutput(file: string, roots: string[], mime: string | null): Promise<BridgeBlobRef | undefined> {
      const bytes = await snapshotFile(file, roots);
      return bytes ? blobs.capture(bytes, { column: "metadata", sourcePath: file, name: path.basename(file), mime }) : undefined;
    },
    ready(store: BridgeStore, entry: OutboxEntry) { return !needsFiles(entry) || getClock(store.sqlite, entry.table_name, entry.pk, entry.register)?.blob_refs_json != null; },
    async acknowledged(clock: RowClock) { await blobs.releaseCaptured(JSON.parse(clock.blob_refs_json ?? "[]")); },
    async prepare(store: BridgeStore, entry: OutboxEntry) {
      if (!needsFiles(entry)) return;
      const clock = getClock(sqlite, entry.table_name, entry.pk, entry.register);
      if (!clock || clock.blob_refs_json !== null) return;
      if (entry.owner && entry.owner !== backendId) throw new Error("Only the source backend may publish file bytes");
      const row = readRow(store, entry.table_name, entry.pk);
      if (!row) return;
      const refs: BridgeBlobRef[] = [];
      const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : {};
      const name = String(row.name ?? row.file_name ?? metadata.fileName ?? (typeof metadata.path === "string" ? path.basename(metadata.path) : null) ?? row.title ?? "file.bin");
      const mime = typeof row.mime_type === "string" ? row.mime_type : typeof metadata.mimeType === "string" ? metadata.mimeType : null;
      const publish = async (column: string, file: string | Buffer, roots: string[], expectedHash?: string) => {
        const bytes = Buffer.isBuffer(file) ? file : await snapshotFile(file, roots);
        if (!bytes || bytes.length > BRIDGE_BLOB_MAX_BYTES) return;
        if (expectedHash && createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("Bridge source file integrity check failed");
        refs.push(await blobs.publish(bytes, { column, name: typeof file === "string" ? path.basename(file) : name, mime,
          ...(typeof file === "string" ? { sourcePath: file } : {}) }));
      };
      if (entry.table_name === "run_attachments") {
        const expected = `attachments/${row.id}/${row.name}`;
        if (/^[a-f0-9]{64}$/.test(String(row.id)) && path.basename(String(row.name)) === row.name && row.storage_key === expected)
          await publish("storage_key", path.join(dataDir, expected), [path.join(dataDir, "attachments")], String(row.content_hash));
      } else if (entry.table_name === "collection_sources") {
        const key = String(row.storage_key);
        const parts = key.split("/");
        if (parts.length === 5 && parts[0] === "collections" && parts[1] === row.collection_id && parts[2] === "sources" &&
            aliasSet(sqlite, "collection_sources", String(row.id)).includes(parts[3]) && /^content(?:\.[a-z0-9]{1,16})?$/.test(parts[4]))
          await publish("storage_key", path.join(dataDir, key), [path.join(dataDir, "collections")], String(row.content_hash));
      } else if (entry.table_name === "atlas_items") {
        const key = String(row.storage_key ?? "");
        if (/^[\w-]+\/[^/\\]+$/.test(key) && ![".", ".."].includes(path.basename(key)))
          await publish("storage_key", path.join(dataDir, "atlas", "files", key), [path.join(dataDir, "atlas", "files")], String(row.content_hash));
      } else if (entry.table_name === "run_artifacts") {
        if (Buffer.isBuffer(row.blob_data)) await publish("blob_data", row.blob_data, []);
        else if (["image", "document", "visualization"].includes(String(row.kind)) || row.kind === "file" && (metadata.outputSelected === true || metadata.outputRole === "deliverable")) {
          const file = row.path ?? metadata.path;
          const run = sqlite.prepare("SELECT r.mode,r.provider_id,r.session_id,w.root_path FROM runs r LEFT JOIN workspaces w ON w.id=r.workspace_id WHERE r.id=? AND r.owner_backend_id=?").get(row.run_id, backendId) as { mode: string; provider_id: string; session_id: string | null; root_path: string | null } | undefined;
          const runId = String(row.run_id);
          if (run && /^[\w-]+$/.test(runId)) {
            const roots = [path.join(dataDir, "generated-images", runId)];
            if (run.root_path) roots.push(run.root_path);
            else if (["work", "chat"].includes(run.mode)) roots.push(path.join(dataDir, "runs", runId, run.mode));
            if (run.provider_id === "codex" && run.session_id && /^[\w-]+$/.test(run.session_id)) roots.push(path.join(homedir(), ".codex", "generated_images", run.session_id));
            if (typeof file === "string") await publish("path", file, roots);
          }
        }
        if (Array.isArray(metadata.bridgeOutputs)) for (const output of metadata.bridgeOutputs) {
          const ref = output?.blobRef as BridgeBlobRef | undefined;
          if (!ref) continue; // Missing/oversized outputs retain source availability information.
          validateBridgeBlobIdentity(ref);
          if (ref.column !== "metadata" || ref.sourcePath !== output.path) throw new Error("Invalid Bridge output snapshot");
          await blobs.publishCaptured(ref); refs.push(ref);
        }
      }
      // No await between checking the generation and binding its already uploaded blobs.
      if (sameClock(clock, getClock(sqlite, entry.table_name, entry.pk, entry.register)))
        sqlite.prepare("UPDATE bridge_row_clock SET blob_refs_json=? WHERE table_name=? AND pk=? AND register=?").run(JSON.stringify(refs), entry.table_name, entry.pk, entry.register);
    },
    async resolve(table: BridgeFileTable, localId: string | number, column?: string, sourcePath?: string): Promise<string> {
      if (!fileTables.includes(table)) throw new Error("Invalid Bridge file table");
      const def = BRIDGE_TABLES[table];
      const where = rowWhere(def, String(localId));
      const row = sqlite.prepare(`SELECT * FROM ${quote(table)} WHERE ${where.sql}`).get(...where.args) as { run_id?: string } | undefined;
      if (!row) throw new Error("Bridge file record no longer exists");
      let pk = String(localId);
      if (def.idKind === "run-integer") {
        const mapped = sqlite.prepare("SELECT remote_id FROM bridge_id_map WHERE table_name=? AND local_id=?").get(table, localId) as { remote_id: string } | undefined;
        if (!mapped || !mapped.remote_id.startsWith(`${row.run_id}:`)) throw new Error("Bridge file identity is missing");
        pk = mapped.remote_id;
      }
      if (deleted(sqlite, table, pk)) throw new Error("Bridge file was deleted");
      const clocks = aliasSet(sqlite, table, pk).map((id) => getClock(sqlite, table, id, def.primaryRegister!)).filter((clock): clock is RowClock => !!clock)
        .sort((a, b) => compareClock(clockOf(b), clockOf(a)));
      const refs: BridgeBlobRef[] = JSON.parse(clocks[0]?.blob_refs_json ?? "[]");
      const ref = refs.find((candidate) => (!column || candidate.column === column) && (!sourcePath || candidate.sourcePath === sourcePath));
      if (!ref) throw new Error("File is available only on its source device (missing or above 50 MiB)");
      return blobs.resolve(ref);
    },
  };
}
export type BridgeBlobRecords = ReturnType<typeof createBridgeBlobRecords>;
