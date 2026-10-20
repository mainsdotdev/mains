/** The part of D1 these counters use. Structural, so operator tools type-check its callers without Workers types. */
export interface CountingDatabase {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
}
/** Counts one more use of `key` in its window, which starts at the first use and ends at `expiresAt`. */
export async function countUse(db: CountingDatabase, key: string, expiresAt: number, now = Date.now()): Promise<number> {
  const row = await db.prepare(`INSERT INTO bridge_limits(id,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,
    expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count`)
    .bind(key, expiresAt, now, now).first<{ count: number }>();
  return row?.count ?? Infinity;
}
