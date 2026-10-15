import { eq, sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getLocalBackendId } from "../../db/backend-identity";
import { getDb } from "../../db/client";
import type { BackendOwnership } from "@mains/contracts/bridge";
export type { BackendOwnership } from "@mains/contracts/bridge";

/** Operational queries use this predicate; listing queries deliberately do not. */
export function ownedHere(column: AnySQLiteColumn): SQL {
  return eq(column, getLocalBackendId());
}

export function ownershipOf(ownerBackendId: string): BackendOwnership {
  return { ownerBackendId, isReplica: ownerBackendId !== getLocalBackendId() };
}

export function assertOwnedHere(row: { ownerBackendId: string }, label = "This item"): void {
  if (row.ownerBackendId !== getLocalBackendId()) {
    throw new Error(`${label} belongs to another backend and is read-only here`);
  }
}

const OWNER_QUERIES = {
  runs: "SELECT owner_backend_id AS ownerBackendId FROM runs WHERE id = ?",
  workspaces: "SELECT owner_backend_id AS ownerBackendId FROM workspaces WHERE id = ?",
  projects: "SELECT owner_backend_id AS ownerBackendId FROM projects WHERE id = ?",
  pulses: "SELECT owner_backend_id AS ownerBackendId FROM pulses WHERE id = ?",
  automations: "SELECT owner_backend_id AS ownerBackendId FROM automations WHERE id = ?",
  run_context: "SELECT r.owner_backend_id AS ownerBackendId FROM run_context c JOIN runs r ON r.id = c.run_id WHERE c.id = ?",
  run_artifacts: "SELECT r.owner_backend_id AS ownerBackendId FROM run_artifacts c JOIN runs r ON r.id = c.run_id WHERE c.id = ?",
  tool_calls: "SELECT r.owner_backend_id AS ownerBackendId FROM tool_calls c JOIN runs r ON r.id = c.run_id WHERE c.id = ?",
  workspace_activity: "SELECT w.owner_backend_id AS ownerBackendId FROM workspace_activity c JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = ?",
  reviews: "SELECT coalesce(w.owner_backend_id, r.owner_backend_id) AS ownerBackendId FROM reviews c LEFT JOIN workspaces w ON w.id = c.workspace_id LEFT JOIN runs r ON r.id = c.run_id WHERE c.id = ?",
  review_findings: "SELECT coalesce(w.owner_backend_id, r.owner_backend_id) AS ownerBackendId FROM review_findings f JOIN reviews c ON c.id = f.review_id LEFT JOIN workspaces w ON w.id = c.workspace_id LEFT JOIN runs r ON r.id = c.run_id WHERE f.id = ?",
} as const;

/** Guards inherited ownership too. The service retains its existing absence rules. */
export function assertOwnedRecord(table: keyof typeof OWNER_QUERIES, id: string | number): void {
  const [before, after] = OWNER_QUERIES[table].split("?");
  const row = getDb().get<{ ownerBackendId: string | null }>(sql`${sql.raw(before)}${id}${sql.raw(after)}`);
  if (row && row.ownerBackendId !== null) assertOwnedHere({ ownerBackendId: row.ownerBackendId });
}
