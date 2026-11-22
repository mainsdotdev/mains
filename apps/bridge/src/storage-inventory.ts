import type { BridgeStorageInventory } from "@mains/contracts/bridge";
import type { SqlStorage } from "@cloudflare/workers-types";

const pageSize = 100;

/** Inventory reads current ciphertext sizes and signed blob indexes. Historical
 * log references continue protecting R2 and cannot inflate the user's estimate. */
export function bridgeStorageInventory(sql: SqlStorage): BridgeStorageInventory {
  const rows = sql.exec<{
    id: string; kind: "run" | "account"; owner: string | null; records: number; blobs: number; reclaimable: number;
  }>(`WITH registered AS (
    SELECT CASE WHEN l.stream<>'account' OR r.run_id IS NOT NULL THEN 'run' ELSE 'account' END kind,
      coalesce(r.run_id,CASE WHEN l.stream<>'account' THEN substr(l.stream,5)
        ELSE json_extract(l.envelope,'$.header.rowKey') END) id, l.stream, l.seq,
      length(CAST(l.envelope AS BLOB)) bytes
    FROM latest l LEFT JOIN runs r ON l.stream='account' AND r.root_key=json_extract(l.envelope,'$.header.rowKey')
  ), record_sizes AS (
    SELECT kind,id,sum(bytes) records FROM registered GROUP BY kind,id
  ), item_refs AS (
    SELECT r.kind,r.id,b.blob_id,count(*) refs
    FROM registered r JOIN blob_links b ON b.stream=r.stream AND b.seq=r.seq GROUP BY r.kind,r.id,b.blob_id
  ), file_sizes AS (
    SELECT i.kind,i.id,sum(q.bytes) blobs,
      sum(CASE WHEN i.refs=q.refs THEN q.bytes ELSE 0 END) reclaimable
    FROM item_refs i JOIN blob_quota_refs q USING(blob_id) GROUP BY i.kind,i.id
  )
  SELECT s.kind,s.id,r.owner,s.records,coalesce(f.blobs,0) blobs,
    CASE WHEN (SELECT legacy_records FROM blob_gc_state WHERE id=1)=0 THEN coalesce(f.reclaimable,0) ELSE 0 END reclaimable
  FROM record_sizes s LEFT JOIN file_sizes f USING(kind,id)
    LEFT JOIN runs r ON s.kind='run' AND r.run_id=s.id AND r.tombstone IS NULL
  WHERE (s.kind='run' AND r.owner IS NOT NULL) OR (s.kind='account' AND f.blobs>0)
  ORDER BY s.records+coalesce(f.blobs,0) DESC,s.kind,s.id LIMIT ?`, pageSize + 1).toArray();
  return { items: rows.slice(0, pageSize).map(row => ({
    kind: row.kind, id: row.id, recordBytes: row.records, blobBytes: row.blobs, reclaimableBlobBytes: row.reclaimable,
    ...(row.owner ? { ownerBackendId: row.owner } : {}),
  })), hasMore: rows.length > pageSize };
}
