import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableName, is, Table } from "drizzle-orm";
import * as schema from "../../db/schema";

export type BridgeReferenceClass = "required" | "optional" | "seeded" | "local";
export type BridgeNaturalKeyRule = "atlas-source" | "local-ordinal" | "content-hash" | "owner-scoped" | "immutable-identity" | "single-writer";
export interface BridgeTableDefinition {
  class: "local" | "account" | "append-only" | "backend-owned";
  primaryKey: readonly string[];
  idKind: "text" | "run-integer" | "composite";
  stream: "account" | "run" | "run-attachment";
  ownerRoot: string | null;
  primaryRegister: string | null;
  registers: Readonly<Record<string, readonly string[]>>;
  localColumns: readonly string[];
  references: Readonly<Record<string, { table: string; class: BridgeReferenceClass }>>;
  uniqueIndexes: Readonly<Record<string, BridgeNaturalKeyRule>>;
  blobColumns: readonly string[];
  retention?: "30d-idle";
}

/** Explicit column lists make schema changes fail the audit until classified.
 * Atlas's revision pointer and graph are added in B6 before its replication is enabled.
 * Attachment ownership/stream is resolved through run_attachment_refs; unreferenced
 * attachments and tool_calls with no run are not eligible for transfer.
 */
export const BRIDGE_TABLES: Readonly<Record<string, BridgeTableDefinition>> = {
  provider_session_entries: {
    class: "append-only", primaryKey: ["id"], idKind: "text", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: { row: ["id", "run_id", "session_id", "subpath", "seq", "uuid", "entry", "byte_size", "content_hash"] },
    localColumns: [], references: { run_id: { table: "runs", class: "required" } },
    uniqueIndexes: {}, blobColumns: ["entry"], retention: "30d-idle",
  },
  ...Object.fromEntries(Object.entries({
    bridge_atlas_recoveries: ["revision_id"], bridge_config: ["id"], bridge_peers: ["backend_id"], bridge_clock: ["id"], bridge_outbox: ["table_name", "pk", "register"],
    bridge_publications: ["table_name", "pk", "register", "stream"],
    bridge_row_clock: ["table_name", "pk", "register"], bridge_cursors: ["stream"],
    bridge_parked: ["stream", "seq"], bridge_pending_links: ["table_name", "pk", "register", "column_name"],
    bridge_id_map: ["owner_backend_id", "table_name", "remote_id"], bridge_aliases: ["table_name", "alias_pk"],
    bridge_tombstones: ["table_name", "pk"], bridge_exclusions: ["table_name", "pk"],
  }).map(([name, primaryKey]): [string, BridgeTableDefinition] => [name, {
    class: "local", primaryKey, idKind: primaryKey.length === 1 ? "text" : "composite", stream: "account",
    ownerRoot: null, primaryRegister: null, registers: {}, localColumns: [], references: {}, uniqueIndexes: {}, blobColumns: [],
  }])),
  "accounts": {
    class: "account", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["id", "display_name", "email", "company", "job_title", "timezone", "locale", "website", "avatar_url", "bio", "created_at", "updated_at"]},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "app_settings": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "atlas_items": {
    class: "account", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "content",
    registers: {"content": ["id", "account_id", "kind", "title", "current_revision_id", "source_run_id", "source_key", "storage_key", "file_name", "mime_type", "byte_size", "content_hash", "created_at"], "metadata": ["metadata", "is_favorite", "collection_id", "trashed_at"]},
    localColumns: ["version", "updated_at"], references: {"current_revision_id": {"table": "atlas_page_revisions", "class": "optional"}, "account_id": {"table": "accounts", "class": "required"}, "collection_id": {"table": "collections", "class": "required"}, "source_run_id": {"table": "runs", "class": "optional"}},
    uniqueIndexes: {"uniq_atlas_items_source": "atlas-source"}, blobColumns: ["storage_key"],
  },
  "atlas_page_file_refs": {
    class: "append-only", primaryKey: ["revision_id", "file_id"], idKind: "composite", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["revision_id", "file_id"]},
    localColumns: [], references: {"revision_id": {"table": "atlas_page_revisions", "class": "required"}, "file_id": {"table": "atlas_items", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "atlas_page_revisions": {
    class: "append-only", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["id", "item_id", "parent_revision_id", "merged_revision_id", "schema_version", "title", "blocks_json", "markdown", "actor", "source_run_id", "created_at"]},
    localColumns: ["version"], references: {"parent_revision_id": {"table": "atlas_page_revisions", "class": "required"}, "merged_revision_id": {"table": "atlas_page_revisions", "class": "required"}, "item_id": {"table": "atlas_items", "class": "required"}, "source_run_id": {"table": "runs", "class": "optional"}},
    uniqueIndexes: {"uniq_atlas_page_revisions_version": "local-ordinal"}, blobColumns: [],
  },
  "automation_runs": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "automations", primaryRegister: "row",
    registers: {"row": ["id", "automation_id", "status", "result", "error", "started_at", "completed_at", "duration_ms"]},
    localColumns: [], references: {"automation_id": {"table": "automations", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "automations": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "automations", primaryRegister: "row",
    registers: {"row": ["id", "owner_backend_id", "account_id", "name", "kind", "action", "interval_minutes", "is_active", "config", "last_run_at", "next_run_at", "last_error", "consecutive_errors", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "collection_sources": {
    class: "account", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["id", "collection_id", "kind", "name", "mime_type", "byte_size", "content_hash", "storage_key", "created_at", "updated_at"]},
    localColumns: [], references: {"collection_id": {"table": "collections", "class": "required"}},
    uniqueIndexes: {"uniq_collection_sources_content": "content-hash"}, blobColumns: ["storage_key"],
  },
  "collections": {
    class: "account", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["id", "account_id", "name", "icon", "is_archived", "sort_order", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "command_receipts": {
    class: "local", primaryKey: ["device_id", "command_id"], idKind: "composite", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "connection_resources": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "connection_states": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "connection_tokens": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "connections": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "entities": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "issues": {
    class: "local", primaryKey: ["entity_id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "paired_devices": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "project_resources": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "projects": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "projects", primaryRegister: "row",
    registers: {"row": ["id", "owner_backend_id", "account_id", "name", "root_path", "workspaces_path", "branches", "remote_origin", "default_branch", "setup_script", "run_script", "archive_script", "icon", "sort_order", "commit_instructions", "pr_instructions", "is_archived", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}},
    uniqueIndexes: {"uniq_projects_account_origin": "owner-scoped", "uniq_projects_account_root": "owner-scoped"}, blobColumns: [],
  },
  "providers": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "pulses": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "pulses", primaryRegister: "row",
    registers: {"row": ["id", "owner_backend_id", "account_id", "workspace_id", "collection_id", "mode", "provider_id", "model", "title", "prompt", "frequency", "day_of_week", "hour", "minute", "timezone", "thinking_mode", "effort_level", "is_active", "last_run_at", "next_run_at", "last_run_id", "last_error", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}, "workspace_id": {"table": "workspaces", "class": "required"}, "collection_id": {"table": "collections", "class": "required"}, "provider_id": {"table": "providers", "class": "seeded"}, "last_run_id": {"table": "runs", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "review_findings": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "workspaces", primaryRegister: "row",
    registers: {"row": ["id", "review_id", "severity", "file", "line_start", "line_end", "message", "reason", "suggestion", "validated", "is_approved", "metadata", "created_at"]},
    localColumns: [], references: {"review_id": {"table": "reviews", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "reviews": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "workspaces", primaryRegister: "row",
    registers: {"row": ["id", "workspace_id", "title", "summary", "status", "run_id", "metadata", "created_at", "updated_at"]},
    localColumns: [], references: {"workspace_id": {"table": "workspaces", "class": "required"}, "run_id": {"table": "runs", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "run_artifacts": {
    class: "backend-owned", primaryKey: ["id"], idKind: "run-integer", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "run_id", "kind", "path", "content", "blob_data", "entity_id", "content_hash", "metadata", "created_at"]},
    localColumns: [], references: {"run_id": {"table": "runs", "class": "required"}, "entity_id": {"table": "entities", "class": "local"}},
    uniqueIndexes: {}, blobColumns: ["blob_data", "path", "metadata"],
  },
  "run_attachment_refs": {
    class: "backend-owned", primaryKey: ["run_id", "attachment_id"], idKind: "composite", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["run_id", "attachment_id", "input_key", "ordinal"]},
    localColumns: [], references: {"run_id": {"table": "runs", "class": "required"}, "attachment_id": {"table": "run_attachments", "class": "required"}},
    uniqueIndexes: {"uniq_run_attachment_refs_input": "single-writer"}, blobColumns: [],
  },
  "run_attachments": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "run-attachment",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "name", "type", "mime_type", "storage_key", "byte_size", "content_hash", "created_at"]},
    localColumns: [], references: {},
    uniqueIndexes: {"uniq_run_attachments_storage_key": "immutable-identity"}, blobColumns: ["storage_key"],
  },
  "run_context": {
    class: "backend-owned", primaryKey: ["id"], idKind: "run-integer", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "run_id", "kind", "ref", "content", "entity_id", "content_hash", "metadata", "created_at"]},
    localColumns: [], references: {"run_id": {"table": "runs", "class": "required"}, "entity_id": {"table": "entities", "class": "local"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "run_turn_changes": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "run_id", "turn_id", "diff_text", "files_json", "additions", "deletions", "truncated", "undone_at", "created_at"]},
    localColumns: [], references: {"run_id": {"table": "runs", "class": "required"}, "turn_id": {"table": "run_turns", "class": "required"}},
    uniqueIndexes: {"uniq_run_turn_changes_turn": "single-writer"}, blobColumns: [],
  },
  "run_turns": {
    class: "backend-owned", primaryKey: ["id"], idKind: "run-integer", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "run_id", "turn_index", "prompt_content", "response_content", "started_at", "ended_at", "elapsed_ms", "status", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_micros", "model", "model_usage", "metadata", "created_at"]},
    localColumns: [], references: {"run_id": {"table": "runs", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "runs": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "owner_backend_id", "account_id", "workspace_id", "collection_id", "space_id", "provider_id", "mode", "model", "title", "goal", "status", "system_prompt", "config_snapshot", "tool_policy_snapshot", "started_at", "ended_at", "last_error", "stop_reason", "session_id", "is_archived", "pinned_at", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}, "workspace_id": {"table": "workspaces", "class": "required"}, "collection_id": {"table": "collections", "class": "required"}, "space_id": {"table": "spaces", "class": "required"}, "provider_id": {"table": "providers", "class": "seeded"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "signals": {
    class: "local", primaryKey: ["entity_id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "spaces": {
    class: "account", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: "row",
    registers: {"row": ["id", "account_id", "name", "slug", "description", "system_prompt", "model", "icon", "theme_config", "provider_id", "mode", "is_archived", "sort_order", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "tasks": {
    class: "local", primaryKey: ["entity_id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
  "tool_calls": {
    class: "backend-owned", primaryKey: ["id"], idKind: "run-integer", stream: "run",
    ownerRoot: "runs", primaryRegister: "row",
    registers: {"row": ["id", "account_id", "run_id", "provider_id", "tool_call_id", "parent_tool_call_id", "tool_name", "status", "input", "output", "error", "started_at", "ended_at", "latency_ms", "cost_micros", "metadata", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}, "run_id": {"table": "runs", "class": "required"}, "provider_id": {"table": "providers", "class": "seeded"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "workspace_activity": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "workspaces", primaryRegister: "row",
    registers: {"row": ["id", "workspace_id", "type", "title", "summary", "metadata", "ref_id", "created_at"]},
    localColumns: [], references: {"workspace_id": {"table": "workspaces", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "workspace_diffs": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "workspaces", primaryRegister: "row",
    registers: {"row": ["id", "workspace_id", "run_id", "base_ref", "diff_text", "files_json", "stats_json", "untracked_json", "created_at"]},
    localColumns: [], references: {"workspace_id": {"table": "workspaces", "class": "required"}, "run_id": {"table": "runs", "class": "required"}},
    uniqueIndexes: {}, blobColumns: [],
  },
  "workspaces": {
    class: "backend-owned", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: "workspaces", primaryRegister: "row",
    registers: {"row": ["id", "owner_backend_id", "account_id", "project_id", "name", "root_path", "repo_url", "base_branch", "metadata", "status", "is_archived", "sort_order", "pinned_at", "created_at", "updated_at"]},
    localColumns: [], references: {"account_id": {"table": "accounts", "class": "required"}, "project_id": {"table": "projects", "class": "required"}},
    uniqueIndexes: {"uniq_workspaces_account_root": "owner-scoped"}, blobColumns: [],
  },
  "bridge_state": {
    class: "local", primaryKey: ["id"], idKind: "text", stream: "account",
    ownerRoot: null, primaryRegister: null,
    registers: {},
    localColumns: [], references: {},
    uniqueIndexes: {}, blobColumns: [],
  },
};

export function bridgePortablePk(table: string, row: Record<string, unknown>): string {
  const definition = BRIDGE_TABLES[table];
  if (!definition || definition.class === "local") throw new Error(`Table does not sync: ${table}`);
  const values = definition.primaryKey.map((column) => {
    const value = row[column];
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`Missing primary key: ${table}.${column}`);
    return value;
  });
  if (definition.idKind === "run-integer") {
    if (typeof row.run_id !== "string" || !row.run_id) throw new Error(`${table} needs a run before it can sync`);
    return `${row.run_id}:${values[0]}`;
  }
  return values.length === 1 ? String(values[0]) : JSON.stringify(values);
}

export function auditBridgeSchema(tables: readonly SQLiteTable[] = Object.values(schema).filter((value) => is(value, Table)) as SQLiteTable[], registry = BRIDGE_TABLES): void {
  for (const table of tables) {
    const name = getTableName(table);
    const definition = registry[name];
    if (!definition) throw new Error(`Unclassified Bridge table: ${name}`);
    if (definition.class === "local") continue;
    const config = getTableConfig(table);
    const columns = new Set(config.columns.map((column) => column.name));
    const covered = [...Object.values(definition.registers).flat(), ...definition.localColumns];
    if (!definition.primaryRegister || !definition.registers[definition.primaryRegister]) throw new Error(`Missing primary register: ${name}`);
    if (covered.length !== new Set(covered).size || covered.length !== columns.size || covered.some((column) => !columns.has(column)))
      throw new Error(`Unclassified or duplicated Bridge columns: ${name}`);
    const actualPrimaryKey = [...config.columns.filter((column) => column.primary), ...config.primaryKeys.flatMap((key) => key.columns)].map((column) => column.name);
    if (definition.primaryKey.length !== actualPrimaryKey.length || definition.primaryKey.some((column, index) => column !== actualPrimaryKey[index]))
      throw new Error(`Invalid Bridge primary key: ${name}`);
    const primaryColumns = definition.registers[definition.primaryRegister];
    for (const column of config.columns) {
      if (column.notNull && !column.hasDefault && !definition.localColumns.includes(column.name) && !primaryColumns.includes(column.name))
        throw new Error(`Primary register cannot create ${name}: missing ${column.name}`);
    }
    const foreignColumns = new Set<string>();
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      for (const column of reference.columns) {
        foreignColumns.add(column.name);
        const policy = definition.references[column.name];
        if (!policy || policy.table !== getTableName(reference.foreignTable)) throw new Error(`Unclassified Bridge foreign key: ${name}.${column.name}`);
        if ((policy.class === "optional" || policy.class === "local") && column.notNull) throw new Error(`Nullable Bridge reference is not nullable: ${name}.${column.name}`);
        if (policy.class === "required" && registry[policy.table]?.class === "local") throw new Error(`Required Bridge parent is local: ${name}.${column.name}`);
      }
    }
    if (Object.keys(definition.references).some((column) => !foreignColumns.has(column))) throw new Error(`Stale Bridge reference policy: ${name}`);
    const uniqueIndexes = [
      ...config.indexes.filter((index) => index.config.unique).map((index) => index.config.name),
      ...config.uniqueConstraints.map((constraint) => constraint.getName()),
      ...config.columns.filter((column) => column.isUnique).map((column) => column.uniqueName),
    ].filter((name): name is string => typeof name === "string");
    if (uniqueIndexes.some((name) => !definition.uniqueIndexes[name]) || Object.keys(definition.uniqueIndexes).some((name) => !uniqueIndexes.includes(name)))
      throw new Error(`Unclassified Bridge unique index: ${name}`);
  }
}
