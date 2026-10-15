import { randomUUID } from "node:crypto";
import type { BridgeRecoveryContext } from "./bridge.store";
import { aliasSet, canonicalPk, clockOf, compareClock, quote, type RowClock, type SqlRow } from "./bridge.sql";

/** Runs inside the applier's delete transaction, before any CASCADE. No file IO:
 * immutable blob manifests survive under the new file identities. */
export function recoverAtlasPage({ sqlite, table, row, captureAfterDelete }: BridgeRecoveryContext): void {
  if (table === "atlas_page_revisions") {
    const parent = sqlite.prepare("SELECT * FROM atlas_items WHERE id=?").get(row.item_id) as SqlRow | undefined;
    if (parent) recoverAtlasPage({ sqlite, table: "atlas_items", pk: String(parent.id), row: parent, captureAfterDelete });
    return;
  }
  if (table !== "atlas_items" || row.kind !== "page") return;
  const pending = sqlite.prepare(`SELECT r.* FROM atlas_page_revisions r
    LEFT JOIN bridge_row_clock c ON c.table_name='atlas_page_revisions' AND c.pk=r.id AND c.register='row'
    WHERE r.item_id=? AND NOT EXISTS (SELECT 1 FROM bridge_atlas_recoveries saved WHERE saved.revision_id=r.id)
      AND (c.synced_seq IS NULL OR EXISTS
      (SELECT 1 FROM bridge_outbox o WHERE o.table_name='atlas_page_revisions' AND o.pk=r.id AND o.op='upsert'))
    ORDER BY r.version`).all(row.id) as SqlRow[];
  if (!pending.length) return;
  const itemId = randomUUID(), revisions = new Map(pending.map((r) => [String(r.id), randomUUID()]));
  const current = pending.find((r) => r.id === row.current_revision_id) ?? pending[pending.length - 1];
  const suffix = " (recovered)", name = `${String(current.title).slice(0, 240 - suffix.length)}${suffix}`;
  const insert = (name: string, values: SqlRow) => {
    const columns = Object.keys(values);
    sqlite.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
      .run(...Object.values(values));
  };
  const fileIds = new Set<string>();
  for (const r of pending) for (const ref of sqlite.prepare("SELECT file_id FROM atlas_page_file_refs WHERE revision_id=?").all(r.id) as { file_id: string }[]) fileIds.add(ref.file_id);
  const metadata = row.metadata ? JSON.parse(String(row.metadata)) : null;
  if (metadata?.coverFileId) fileIds.add(metadata.coverFileId);
  const files = new Map<string, string>();
  for (const oldId of fileIds) {
    const canonical = canonicalPk(sqlite, "atlas_items", oldId);
    if (files.has(canonical)) { files.set(oldId, files.get(canonical)!); continue; }
    const file = sqlite.prepare("SELECT * FROM atlas_items WHERE id=? AND account_id=? AND kind<>'page'").get(canonical, row.account_id) as SqlRow | undefined;
    if (!file) continue;
    const newId = randomUUID();
    for (const id of aliasSet(sqlite, "atlas_items", canonical)) files.set(id, newId);
    // Do not reuse source_key: natural-key aliasing would merge the recovered
    // identity back into the permanently deleted original.
    insert("atlas_items", { ...file, id: newId, source_key: null, trashed_at: null });
    const manifest = aliasSet(sqlite, "atlas_items", oldId)
      .map((id) => sqlite.prepare("SELECT * FROM bridge_row_clock WHERE table_name='atlas_items' AND pk=? AND register='content'").get(id) as RowClock | undefined)
      .filter((clock): clock is RowClock => !!clock).sort((a, b) => compareClock(clockOf(b), clockOf(a)))[0];
    captureAfterDelete("atlas_items", newId, manifest?.blob_refs_json ?? undefined);
  }
  const rewrite = (text: string) => text.replace(/atlas-file:\/\/([\w-]+)/g, (url, id: string) => files.has(id) ? `atlas-file://${files.get(id)}` : url);
  if (metadata?.coverFileId && files.has(metadata.coverFileId)) metadata.coverFileId = files.get(metadata.coverFileId);
  insert("atlas_items", { ...row, id: itemId, title: name, current_revision_id: null,
    source_key: null, version: 0, trashed_at: null, metadata: metadata ? JSON.stringify(metadata) : null });
  for (const [index, r] of pending.entries()) {
    const revisionId = revisions.get(String(r.id))!;
    insert("atlas_page_revisions", { ...r, id: revisionId, item_id: itemId, version: index + 1,
      title: r.id === current.id ? name : r.title,
      parent_revision_id: revisions.get(String(r.parent_revision_id)) ?? null,
      merged_revision_id: revisions.get(String(r.merged_revision_id)) ?? null,
      blocks_json: rewrite(String(r.blocks_json)), markdown: rewrite(String(r.markdown)) });
    captureAfterDelete("atlas_page_revisions", revisionId);
    sqlite.prepare("INSERT INTO bridge_atlas_recoveries(revision_id,recovered_item_id) VALUES(?,?)").run(r.id, itemId);
    for (const ref of sqlite.prepare("SELECT file_id FROM atlas_page_file_refs WHERE revision_id=?").all(r.id) as { file_id: string }[]) {
      const fileId = files.get(ref.file_id) ?? ref.file_id;
      insert("atlas_page_file_refs", { revision_id: revisionId, file_id: fileId });
      captureAfterDelete("atlas_page_file_refs", JSON.stringify([revisionId, fileId]));
    }
  }
  sqlite.prepare("UPDATE atlas_items SET current_revision_id=?,version=? WHERE id=?")
    .run(revisions.get(String(current.id)), pending.indexOf(current) + 1, itemId);
  captureAfterDelete("atlas_items", itemId);
}
