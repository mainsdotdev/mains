#!/usr/bin/env node
/**
 * Build the demo snapshot — the sample Mac the app talks to when someone taps
 * "Try a demo Mac" — out of a real database.
 *
 * Two sources, because the two databases hold different halves of the truth:
 *
 *  - `--desktop [path]` takes the *content* (runs, transcripts, tool calls,
 *    artifacts, workspaces, projects, collections, spaces, provider settings)
 *    from the Mac app's own database. This is where the good runs live.
 *  - the phone's projection (a booted simulator by default, or `--db`) always
 *    supplies the *catalog* the Mac answers live and never stores: the model,
 *    skill and command lists. Without a phone database those come out empty,
 *    which only costs the demo its `$`/`@` picker.
 *
 * Everything is mapped into the wire DTO shapes `demo-backend.ts` serves, so
 * the app cannot tell the snapshot from a Mac. Personal strings are scrubbed,
 * and image artifacts are shrunk with `sips` and embedded as base64.
 *
 * Usage:
 *   node scripts/export-demo-snapshot.mjs --desktop
 *   node scripts/export-demo-snapshot.mjs --desktop --runs 4dee4e31…,55ee81ca…
 *   node scripts/export-demo-snapshot.mjs --desktop --exclude ce17ea0e…   # drop these
 *   node scripts/export-demo-snapshot.mjs --desktop --replay <runId>
 *   node scripts/export-demo-snapshot.mjs                      # phone DB only
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseStoredEffortLevels } from "./demo-snapshot-utils.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "backend", "demo", "demo-snapshot.json");
const DESKTOP_DB = path.join(ROOT, "..", "desktop", ".data", "mains.db");
const APP_ID = "dev.mains.mobile.dev";
/** Enough for the picker to look real without carrying a directory listing. */
const SKILL_LIMIT = 60;
const COMMAND_LIMIT = 60;
/**
 * A real `Grep` can answer with 400 KB of matches. The transcript shows a tool
 * call's output in a scrolling block, so the demo keeps the head of it and says
 * where it stopped — the row reads the same and the binary stays small.
 */
const OUTPUT_LIMIT = 3000;
const INPUT_LIMIT = 2000;
/** The demo's images are shown at most a phone wide; 1000px is already generous. */
const IMAGE_MAX_SIDE = 1000;

/**
 * Cut a tool call's payload down to `limit` characters. A string keeps its head;
 * anything else is pretty-printed first, because the phone renders an
 * unrecognized payload as text anyway (`coerceToolOutput`).
 */
function trim(value, limit) {
  if (value === null || value === undefined) return value;
  const asText = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  if (asText.length <= limit) return value;
  return `${asText.slice(0, limit)}\n\n… truncated for the demo (${asText.length.toLocaleString("en-US")} characters)`;
}

/** Personal strings that must not ship inside the App Store binary. */
const SCRUB = [
  ["/Users/okanbalci", "/Users/demo"],
  ["Okan-Bilals-Macbook-Pro-M4", "Demo Mac"],
  ["Okan Bilal Balcı", "Demo User"],
  ["Okan Bilal", "Demo User"],
  ["OkanBilal", "DemoUser"],
  // Last, so the fuller forms above match first: a bare given name still shows
  // up inside recorded shell commands.
  ["Okan", "Demo"],
  ["okanbalci", "demo"],
  ["obbalci@gmail.com", "demo@example.com"],
  ["mainsdotdev", "demo-org"],
  // A connector's opaque id is unreadable as a prompt chip and says nothing;
  // its display name already carries the meaning.
  ["app-694546cd042881919bb746a8dc300f38", "skyscanner"],
];

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return null;
  const next = argv[i + 1];
  return next && !next.startsWith("--") ? next : null;
};

// ── Reading a database ──────────────────────────────────────────────────────

function reader(dbPath) {
  return (sql) => {
    const out = execFileSync("sqlite3", ["-json", "-readonly", dbPath, sql], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).trim();
    return out ? JSON.parse(out) : [];
  };
}

/**
 * Which runs make the cut: `--runs` names the only ones to keep, `--exclude`
 * the ones to leave behind. Both take id prefixes, since that is what a run
 * listing prints.
 */
function runFilter() {
  const list = (name) => flag(name)?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
  const keep = list("runs");
  const drop = list("exclude") ?? [];
  return (id) =>
    (!keep || keep.some((prefix) => id.startsWith(prefix))) &&
    !drop.some((prefix) => id.startsWith(prefix));
}

/** Seconds or milliseconds depending on which app wrote the row; tell by magnitude. */
const iso = (value) => {
  if (value === null || value === undefined) return null;
  return new Date(value > 1e12 ? value : value * 1000).toISOString();
};
const bool = (value) => value === 1 || value === true;
const parse = (json) => {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};
const group = (rows, key) => {
  const out = {};
  for (const row of rows) (out[row[key]] ??= []).push(row);
  return out;
};

// ── The phone's catalog ─────────────────────────────────────────────────────

function readCatalog() {
  const dbPath =
    flag("db") ??
    (() => {
      try {
        const container = execFileSync(
          "xcrun",
          ["simctl", "get_app_container", "booted", APP_ID, "data"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        return path.join(container, "Documents", "SQLite", "mains.db");
      } catch {
        return null;
      }
    })();
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.warn("No phone database found — the demo will have no models, skills or commands.");
    return { models: {}, skills: {}, commands: {} };
  }
  const query = reader(dbPath);
  const backendId = readSourceBackendId(query);
  if (!backendId) return { models: {}, skills: {}, commands: {} };
  const b = backendId.replaceAll("'", "''");

  const models = group(
    query(`select * from models where backend_id='${b}' order by provider_id, sort_order;`).map((m) => ({
      providerId: m.provider_id,
      id: m.id,
      displayName: m.display_name,
      description: m.description ?? undefined,
      isDefault: bool(m.is_default),
      supportedEffortLevels: parseStoredEffortLevels(
        m.effort_levels,
        `${m.provider_id}/${m.id}`,
      ),
      supportsFastMode: bool(m.supports_fast_mode),
    })),
    "providerId",
  );
  const skills = group(
    query(`select * from skills where backend_id='${b}' order by provider_id, sort_order;`).map((s) => ({
      providerId: s.provider_id,
      name: s.name,
      displayName: s.display_name ?? undefined,
      description: s.description ?? undefined,
      shortDescription: s.short_description ?? undefined,
      argumentHint: s.argument_hint ?? undefined,
      brandColor: s.brand_color ?? undefined,
      scope: s.scope ?? undefined,
      userInvokable: true,
    })),
    "providerId",
  );
  for (const id of Object.keys(skills)) skills[id] = skills[id].slice(0, SKILL_LIMIT);
  const commands = group(
    query(`select * from commands where backend_id='${b}' order by provider_id, sort_order;`).map((c) => ({
      providerId: c.provider_id,
      name: c.name,
      description: c.description ?? undefined,
      argumentHint: c.argument_hint ?? undefined,
      userFacing: true,
    })),
    "providerId",
  );
  for (const id of Object.keys(commands)) commands[id] = commands[id].slice(0, COMMAND_LIMIT);
  return { models, skills, commands };
}

/** Prefer a paired Mac; fall back to the built-in demo when it is all we have. */
function readSourceBackendId(query) {
  return query(`
    select backend_id
    from backends
    order by case when backend_id = 'demo-mac' then 1 else 0 end,
             last_synced_at desc,
             rowid desc
    limit 1;
  `)[0]?.backend_id;
}

// ── The Mac's content ───────────────────────────────────────────────────────

function readDesktop(dbPath) {
  const query = reader(dbPath);
  const isWanted = runFilter();

  const runRows = query(
    "select * from runs where is_archived=0 order by created_at desc;",
  ).filter((r) => isWanted(r.id));
  const runs = runRows.map((r) => ({
    id: r.id,
    accountId: "demo-account",
    workspaceId: r.workspace_id,
    collectionId: r.collection_id,
    spaceId: r.space_id,
    providerId: r.provider_id,
    mode: r.mode ?? "developer",
    model: r.model,
    title: r.title,
    goal: r.goal,
    status: r.status,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    lastError: r.last_error,
    stopReason: r.stop_reason,
    isArchived: false,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  }));
  const ids = runs.map((r) => `'${r.id.replaceAll("'", "''")}'`).join(",") || "''";

  const turns = group(
    query(`select * from run_turns where run_id in (${ids}) order by turn_index;`).map((t) => ({
      runId: t.run_id,
      id: t.id,
      turnIndex: t.turn_index,
      promptContent: t.prompt_content,
      responseContent: t.response_content,
      startedAt: iso(t.started_at),
      endedAt: iso(t.ended_at),
      elapsedMs: t.elapsed_ms,
      status: t.status ?? "completed",
      model: t.model,
      createdAt: iso(t.created_at ?? t.started_at),
    })),
    "runId",
  );
  const toolCalls = group(
    query(`select * from tool_calls where run_id in (${ids}) order by created_at, id;`).map((c) => ({
      runId: c.run_id,
      id: c.id,
      toolName: c.tool_name,
      status: c.status,
      input: trim(parse(c.input), INPUT_LIMIT),
      output: trim(parse(c.output), OUTPUT_LIMIT),
      error: c.error,
      startedAt: iso(c.started_at),
      endedAt: iso(c.ended_at),
      createdAt: iso(c.created_at),
      updatedAt: iso(c.updated_at),
    })),
    "runId",
  );
  // `blob_data` is a BLOB: never select it as JSON, only its length.
  const artifactRows = query(
    `select id, run_id, kind, path, content, metadata, created_at, length(blob_data) as blob_len
     from run_artifacts where run_id in (${ids}) order by created_at, id;`,
  );
  const artifacts = group(
    artifactRows.map((a) => ({
      runId: a.run_id,
      id: a.id,
      kind: a.kind,
      path: a.path,
      content: a.content,
      metadata: parse(a.metadata),
      createdAt: iso(a.created_at),
    })),
    "runId",
  );

  const workspaceRows = query("select * from workspaces where is_archived=0;");
  const workspaces = workspaceRows.map((w) => ({
    id: w.id,
    projectId: w.project_id ?? "",
    name: w.name,
    rootPath: w.root_path ?? "",
    status: w.status ?? undefined,
    isArchived: false,
    updatedAt: iso(w.updated_at),
  }));
  const gitStates = workspaceRows.map((w) => ({
    workspaceId: w.id,
    branch: w.base_branch ?? null,
    pathExists: true,
  }));
  const diffSummaries = {};
  for (const w of workspaceRows) diffSummaries[w.id] = null;
  for (const d of query(
    "select * from workspace_diffs order by created_at desc;",
  )) {
    if (diffSummaries[d.workspace_id]) continue; // newest per workspace wins
    const stats = parse(d.stats_json);
    if (!stats?.shortstat) continue;
    diffSummaries[d.workspace_id] = {
      id: String(d.id),
      workspaceId: d.workspace_id,
      runId: d.run_id ?? null,
      stats: { shortstat: stats.shortstat, createdAt: iso(d.created_at) },
    };
  }

  const projects = query("select * from projects where is_archived=0;").map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    isArchived: false,
  }));
  const collections = query("select * from collections where is_archived=0;").map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    isArchived: false,
  }));
  const providers = query("select * from providers;").map((p) => ({
    id: p.id,
    displayName: p.display_name,
    isEnabled: bool(p.is_enabled),
    config: parse(p.config) ?? {},
  }));

  // Raw: the mode each space opens in is decided once the runs are final
  // (see `deriveSpaces`), because a reassignment moves runs between providers.
  const spaces = query("select * from spaces where is_archived=0 order by sort_order, name;").map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug ?? s.id,
    icon: s.icon,
    providerId: s.provider_id,
    mode: s.mode,
    model: s.model,
    sortOrder: s.sort_order,
    isArchived: false,
  }));

  return {
    runs, turns, toolCalls, artifacts, artifactRows,
    workspaces, gitStates, diffSummaries, projects, collections, providers, spaces,
    appVersion: null,
  };
}

// ── The phone's own projection, as a source ────────────────────────────────

function readPhone() {
  const dbPath =
    flag("db") ??
    path.join(
      execFileSync("xcrun", ["simctl", "get_app_container", "booted", APP_ID, "data"], {
        encoding: "utf8",
      }).trim(),
      "Documents", "SQLite", "mains.db",
    );
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}`);
  const query = reader(dbPath);
  const backendId = readSourceBackendId(query);
  if (!backendId) throw new Error("No backend in the phone database");
  const b = backendId.replaceAll("'", "''");
  const isWanted = runFilter();

  const runRows = query(
    `select * from runs where backend_id='${b}' and is_archived=0 order by updated_at desc;`,
  ).filter((r) => isWanted(r.id));
  const runs = runRows.map((r) => ({
    id: r.id, accountId: "demo-account", workspaceId: r.workspace_id, collectionId: r.collection_id,
    spaceId: null, providerId: r.provider_id, mode: r.mode, model: r.model, title: r.title,
    goal: null, status: r.status, startedAt: iso(r.started_at), endedAt: iso(r.ended_at),
    lastError: r.last_error, stopReason: null, isArchived: false,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  }));
  const ids = runs.map((r) => `'${r.id.replaceAll("'", "''")}'`).join(",") || "''";

  const turns = group(
    query(`select * from run_turns where backend_id='${b}' and run_id in (${ids}) order by turn_index;`).map((t) => ({
      runId: t.run_id, id: t.id, turnIndex: t.turn_index, promptContent: t.prompt_content,
      responseContent: t.response_content, startedAt: iso(t.started_at), endedAt: iso(t.ended_at),
      elapsedMs: t.elapsed_ms, status: t.status ?? "completed", model: t.model, createdAt: iso(t.started_at),
    })),
    "runId",
  );
  const toolCalls = group(
    query(`select * from tool_calls where backend_id='${b}' and run_id in (${ids}) order by created_at, id;`).map((c) => ({
      runId: c.run_id, id: c.id, toolName: c.tool_name, status: c.status,
      input: trim(parse(c.input_json), INPUT_LIMIT), output: trim(parse(c.output_json), OUTPUT_LIMIT),
      error: c.error,
      startedAt: iso(c.started_at), endedAt: iso(c.ended_at),
      createdAt: iso(c.created_at), updatedAt: iso(c.updated_at),
    })),
    "runId",
  );
  const artifactRows = query(
    `select id, run_id, kind, path, content, metadata_json as metadata, created_at, 0 as blob_len
     from run_artifacts where backend_id='${b}' and run_id in (${ids}) order by created_at, id;`,
  );
  const artifacts = group(
    artifactRows.map((a) => ({
      runId: a.run_id, id: a.id, kind: a.kind, path: a.path, content: a.content,
      metadata: parse(a.metadata), createdAt: iso(a.created_at),
    })),
    "runId",
  );

  const workspaceRows = query(`select * from workspaces where backend_id='${b}';`);
  return {
    runs, turns, toolCalls, artifacts, artifactRows,
    workspaces: workspaceRows.map((w) => ({
      id: w.id, projectId: w.project_id ?? "", name: w.name, rootPath: w.root_path ?? "",
      status: w.status ?? undefined, isArchived: bool(w.is_archived), updatedAt: iso(w.updated_at),
    })),
    gitStates: workspaceRows.map((w) => ({
      workspaceId: w.id, branch: w.branch ?? null, pathExists: w.path_exists !== 0,
    })),
    diffSummaries: Object.fromEntries(
      workspaceRows.map((w) => [
        w.id,
        w.diff_additions === null && w.diff_deletions === null
          ? null
          : {
              id: `demo-diff-${w.id}`, workspaceId: w.id, runId: null,
              stats: {
                shortstat: ` ${w.diff_additions ?? 0} insertions(+), ${w.diff_deletions ?? 0} deletions(-)`,
                createdAt: iso(w.updated_at) ?? new Date().toISOString(),
              },
            },
      ]),
    ),
    projects: query(`select * from projects where backend_id='${b}';`).map((p) => ({
      id: p.id, name: p.name, icon: p.icon, isArchived: bool(p.is_archived),
    })),
    collections: query(`select * from collections where backend_id='${b}';`).map((c) => ({
      id: c.id, name: c.name, icon: c.icon, isArchived: bool(c.is_archived),
    })),
    providers: query(`select * from providers where backend_id='${b}';`).map((p) => ({
      id: p.id, displayName: p.display_name, isEnabled: bool(p.is_enabled),
      config: providerConfigFromPhoneRow(p),
    })),
    spaces: query(`select * from spaces where backend_id='${b}' order by sort_order, name;`).map((s) => ({
      id: s.id, name: s.name, slug: s.id, icon: s.icon, providerId: s.provider_id,
      mode: s.mode, model: s.model, sortOrder: s.sort_order, isArchived: bool(s.is_archived),
    })),
    appVersion: query(`select app_version from backends where backend_id='${b}';`)[0]?.app_version ?? null,
  };
}

/** Rebuild the config blob the phone's `runSettingsFromConfig` reads back out. */
function providerConfigFromPhoneRow(row) {
  const config = {};
  const effortCoupled = row.id === "codex" || row.id === "cursor";
  if (effortCoupled) {
    if (row.effort_level) config.modelReasoningEffort = row.effort_level;
  } else {
    if (row.effort_level === "ultracode") config.ultracode = true;
    else if (row.effort_level) config.effortLevel = row.effort_level;
    config.thinkingMode = bool(row.thinking_mode);
  }
  const key = { claude_code: "permissionMode", copilot_cli: "permissionMode", codex: "sandboxMode", cursor: "mode" }[row.id];
  if (key && row.permission_mode) config[key] = row.permission_mode;
  if (row.id === "codex") {
    if (bool(row.fast_mode)) config.serviceTier = "fast";
    if (bool(row.goal_mode)) config.goalMode = true;
    if (bool(row.plan_mode)) config.planMode = true;
  } else if (bool(row.fast_mode)) {
    config.fastMode = true;
  }
  return config;
}

// ── Build ───────────────────────────────────────────────────────────────────

const useDesktop = has("desktop");
const desktopPath = flag("desktop") ?? DESKTOP_DB;
if (useDesktop && !fs.existsSync(desktopPath)) throw new Error(`No desktop database at ${desktopPath}`);
const content = useDesktop ? readDesktop(desktopPath) : readPhone();
const catalog = readCatalog();

/**
 * `--reassign <providerId>=<runPrefix>` hands a recorded run to another
 * provider. The desktop only ever ran two of the four agents, and a space with
 * nothing in it is dropped — so this is how Copilot and Cursor get a
 * transcript to show. Only runs whose tools are common to every agent should
 * move; the model comes from the new provider's own catalog, and any log line
 * naming the old one is dropped on the way.
 */
for (const pair of (flag("reassign") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const [providerId, prefix] = pair.split("=").map((s) => s.trim());
  const run = content.runs.find((r) => r.id.startsWith(prefix ?? ""));
  if (!providerId || !run) throw new Error(`--reassign: no run matches "${pair}"`);
  const models = catalog.models[providerId] ?? [];
  const was = run.providerId;
  run.providerId = providerId;
  run.model = (models.find((m) => m.isDefault) ?? models[0])?.id ?? null;
  const artifacts = content.artifacts[run.id];
  if (artifacts) {
    content.artifacts[run.id] = artifacts.filter(
      (a) => !(a.kind === "log" && String(a.content ?? "").toLowerCase().includes(was.split("_")[0])),
    );
  }
  console.log(`  reassigned  ${run.title ?? run.id} → ${providerId} (${run.model ?? "no model"})`);
}

/**
 * The sidebar lists a space's chats by provider *and* mode, so a space whose
 * pair has no runs looks broken. Two derivations keep that from happening: a
 * space whose provider never ran is dropped, and a kept space takes its
 * provider's busiest mode — skipping any mode an earlier space already
 * claimed, so the demo opens showing Code *and* Work rather than the same mode
 * twice. Whatever is left is a mode-chip away.
 */
content.spaces = content.spaces
  .filter((space) => content.runs.some((r) => r.providerId === space.providerId))
  .map((space, _index, kept) => {
    const counts = new Map();
    for (const r of content.runs) {
      if (r.providerId === space.providerId) counts.set(r.mode, (counts.get(r.mode) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([mode]) => mode);
    const mode = ranked.find((m) => !kept.taken?.has(m)) ?? ranked[0] ?? space.mode;
    (kept.taken ??= new Set()).add(mode);
    return { ...space, mode };
  });

/**
 * The run a send replays. Named by prefix on the command line, like the
 * others — but stored whole, because the demo backend looks it up by id.
 * Left alone, it picks a settled run with something to show *and* tool calls
 * to show it with, so the live run has visible work in it.
 */
const replayPrefix = flag("replay");
const replayRunId =
  (replayPrefix
    ? content.runs.find((r) => r.id.startsWith(replayPrefix))
    : content.runs.find(
        (r) =>
          r.status === "succeeded" &&
          (content.artifacts[r.id]?.length ?? 0) >= 3 &&
          (content.toolCalls[r.id]?.length ?? 0) > 0,
      ) ??
      content.runs.find(
        (r) => r.status === "succeeded" && (content.artifacts[r.id]?.length ?? 0) >= 3,
      ))?.id ??
  content.runs[0]?.id ??
  null;
if (replayPrefix && !replayRunId?.startsWith(replayPrefix)) {
  throw new Error(`No exported run starts with "${replayPrefix}"`);
}

let text = JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: useDesktop ? "desktop" : "phone",
  backend: { backendId: "demo-mac", name: "Demo Mac", appVersion: content.appVersion ?? "0.9.0" },
  account: { id: "demo-account", displayName: "Demo" },
  spaces: content.spaces,
  collections: content.collections,
  projects: content.projects,
  providers: content.providers,
  models: catalog.models,
  skills: catalog.skills,
  commands: catalog.commands,
  workspaces: content.workspaces,
  gitStates: content.gitStates,
  diffSummaries: content.diffSummaries,
  runs: content.runs,
  turns: content.turns,
  toolCalls: content.toolCalls,
  artifacts: content.artifacts,
  replayRunId,
});
for (const [from, to] of SCRUB) {
  text = text.replaceAll(from, to);
  // The same string as it appears escaped inside JSON values.
  text = text.replaceAll(JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1));
}
const snapshot = stripIcons(JSON.parse(text));

/**
 * A security review of our own product is the one recording that must not
 * ship: the transcript names the vulnerable file and line and spells out the
 * chain to abuse it, which is a head start for anyone who unzips the app. The
 * run itself is worth keeping — parallel subagents, thirty-odd tool calls,
 * findings sorted by severity — so the shape stays and the map goes. A short
 * line says so, rather than leaving a reader to wonder.
 */
const REDACTED_FINDINGS = [
  {
    match: /^\s*Security findings/i,
    text: `Security findings (read-only):

Details are held back in this sample transcript — the specifics are filed privately with the owners.

1. **Critical (1)** — a local HTTP route serves content it should not vouch for. Fix: authenticate it, pin the response type, keep it off the app's own origin.
2. **High (2)** — local-network transport is plaintext by default, and one file-serving API reaches outside its intended root. Fix: require TLS or restrict to a private network; apply root, type and size checks consistently.
3. **Medium (3)** — one token path falls back to a weak encoding, and two handlers trust the shape of their input.

Nothing was modified during the review.`,
  },
  {
    match: /^\s*#+\s*Test-gap review/i,
    text: `## Test-gap review

Gaps are grouped by area; the file references are held back in this sample transcript.

### Critical — one app ships without an automated suite
Only lint, typecheck and build scripts are wired up, and no test files exist. The paths that carry the most risk are therefore uncovered: pairing and credential lifecycle, connection resilience across offline and foreground transitions, transport correctness (queued sends, timeouts, malformed frames), projection consistency under incremental sync, and the remote run controls.

### High — service-level orchestration is untested
Strong lower-level tests exist, but the composition above them has none: host rebinding, port semantics, rollback on a failed start, restore, shutdown, and status construction.

### High — the scheduler has no tests
Timer scheduling and persistence-sensitive execution are uncovered: create/update/delete cancellation, startup scheduling, run history on success and error, rescheduling after failure, and timer cleanup on shutdown.

### Medium — protocol integration and external processes
URL matching is covered; handler behaviour, response headers, streaming limits and expiry are not. The CLI and in-app browser integrations lack deterministic tests for missing binaries, timeouts, malformed output and lifecycle teardown.

### Medium — startup and teardown, end to end
Components are well covered individually; their lifecycle ordering and failure containment are not.`,
  },
  {
    match: /^\s*#+\s*Security risks/i,
    text: `## Security risks

Both subagents finished. Consolidated below by severity; the file references and reproductions are held back in this sample transcript.

- **Critical — 1 finding.** An unauthenticated local route returns content under the app's own origin. Authenticate it, constrain the response type, isolate the origin.
- **High — 2 findings.** Plaintext transport on the local network, and a file API that can reach past its root. Require TLS (or a private network) and apply consistent path checks.
- **Medium — 3 findings.** A weak token-encoding fallback and two handlers that trust unvalidated input.
- **Low — 2 findings.** Logging that is noisier than it needs to be around credentials, and an error path that leaks an internal path.

Read-only throughout: no files were changed.`,
  },
];

function redactFindings(value) {
  let redacted = 0;
  const runs = new Set();
  for (const [runId, list] of Object.entries(value.artifacts ?? {})) {
    for (const artifact of list) {
      const content = typeof artifact.content === "string" ? artifact.content : null;
      if (!content) continue;
      const rule = REDACTED_FINDINGS.find((r) => r.match.test(content));
      if (!rule) continue;
      artifact.content = rule.text;
      runs.add(runId);
      redacted += 1;
    }
  }
  // The write-up is only half of it: the search that found the weakness names
  // the same file. A redacted run keeps its tool rows — the verbs, the count,
  // the timing — and loses what they were pointed at.
  for (const runId of runs) {
    for (const call of value.toolCalls?.[runId] ?? []) {
      call.input = {};
      call.output = "Withheld in this sample transcript.";
      if (call.error) call.error = "Withheld in this sample transcript.";
    }
  }
  value.redactedFindings = redacted;
  value.redactedRuns = runs.size;
  return value;
}

redactFindings(snapshot);

/**
 * Drop every skill's artwork. `iconSmall` / `iconLarge` are either absolute
 * paths on the Mac or signed, expiring CDN links — the phone renders neither,
 * and a signed URL has no business inside a shipped binary.
 */
function stripIcons(value) {
  if (Array.isArray(value)) return value.map(stripIcons);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === "iconSmall" || key === "iconLarge") continue;
      out[key] = stripIcons(inner);
    }
    return out;
  }
  return value;
}

// ── Images: read the files the *unscrubbed* rows point at, shrink, embed ────

snapshot.images = {};
let missing = 0;
for (const a of content.artifactRows) {
  if (a.kind !== "image") continue;
  const meta = parse(a.metadata) ?? {};
  let source = a.path || meta.path || null;
  let temp = null;
  if (!source && a.blob_len > 0 && useDesktop) {
    // Stored in the database rather than on disk: write it out to read it back.
    temp = path.join(os.tmpdir(), `mains-demo-blob-${a.id}.bin`);
    try {
      execFileSync("sqlite3", ["-readonly", desktopPath, `select writefile('${temp}', blob_data) from run_artifacts where id=${a.id};`], { stdio: "ignore" });
      source = temp;
    } catch {
      source = null;
    }
  }
  if (!source || !fs.existsSync(source)) {
    missing += 1;
    continue;
  }
  const out = path.join(os.tmpdir(), `mains-demo-${a.id}.jpg`);
  try {
    execFileSync("sips", ["-Z", String(IMAGE_MAX_SIDE), "-s", "format", "jpeg", "-s", "formatOptions", "78", source, "--out", out], { stdio: "ignore" });
    const info = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", out], { encoding: "utf8" });
    snapshot.images[String(a.id)] = {
      mime: "image/jpeg",
      base64: fs.readFileSync(out).toString("base64"),
      width: Number(/pixelWidth: (\d+)/.exec(info)?.[1] ?? 0) || null,
      height: Number(/pixelHeight: (\d+)/.exec(info)?.[1] ?? 0) || null,
    };
  } catch {
    missing += 1;
  } finally {
    fs.rmSync(out, { force: true });
    if (temp) fs.rmSync(temp, { force: true });
  }
}

fs.writeFileSync(OUT, JSON.stringify(snapshot));

const kb = Math.round(fs.statSync(OUT).size / 1024);
const byMode = {};
for (const r of snapshot.runs) byMode[`${r.providerId}/${r.mode}`] = (byMode[`${r.providerId}/${r.mode}`] ?? 0) + 1;
console.log(`Wrote ${path.relative(ROOT, OUT)} — ${kb} KB, source: ${snapshot.source}`);
console.log(`  runs        ${snapshot.runs.length}  (${Object.entries(byMode).map(([k, v]) => `${k}: ${v}`).join(", ")})`);
console.log(`  spaces      ${snapshot.spaces.map((s) => `${s.name}/${s.mode}`).join(", ") || "none"}`);
console.log(`  workspaces  ${snapshot.workspaces.length}   projects ${snapshot.projects.length}   collections ${snapshot.collections.length}`);
console.log(`  images      ${Object.keys(snapshot.images).length}${missing ? ` (${missing} unreadable)` : ""}`);
console.log(`  catalog     models ${Object.values(snapshot.models).flat().length}, skills ${Object.values(snapshot.skills).flat().length}, commands ${Object.values(snapshot.commands).flat().length}`);
console.log(`  replay      ${snapshot.replayRunId ?? "none"}`);
if (snapshot.redactedFindings) {
  console.log(
    `  redacted    ${snapshot.redactedFindings} security write-up(s), and every tool call in ${snapshot.redactedRuns} run(s)`,
  );
}
