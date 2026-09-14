/**
 * What a tool call looks like on the phone.
 *
 * The phone's port of the desktop's `lib/tool-registry.tsx` + `lib/resolve-tool.tsx`,
 * kept deliberately separate rather than shared: the desktop's entries carry React
 * SVG icons and Tailwind classes, neither of which crosses to native. What travels
 * is the *table* — the same aliases, the same past-tense verbs, the same MCP
 * `vendor_verb_entity` parse — with SF Symbols in place of the SVGs.
 *
 * Keep the alias lists in step with the desktop's when a provider adds a tool.
 */

/** Which body renderer a resolved tool wants. */
export type ToolKind =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "glob"
  | "grep"
  | "web"
  | "task"
  | "skill"
  | "todo"
  | "plan"
  | "question"
  | "sql"
  | "generic";

export interface ResolvedTool {
  /** Full label ("Bash", "Linear listed issues") — the row's fallback verb. */
  displayName: string;
  /** Past-tense head of the row ("Ran", "Read", "Edited"). */
  verb: string;
  /** SF Symbol drawn ahead of the verb. */
  symbol: string;
  kind: ToolKind;
  /** Set for MCP tools; the vendor label ("Linear"). */
  vendor?: string;
}

interface BuiltinTool {
  displayName: string;
  verb: string;
  symbol: string;
  kind: ToolKind;
  /** Lowercased tool-name aliases. Order matters — specific before loose. */
  aliases: string[];
}

/**
 * Built-in (non-MCP) tools, in resolution order: the loose contains-match pass
 * walks this list top-down, so `webfetch` has to precede `fetch`.
 */
const BUILTIN_TOOLS: BuiltinTool[] = [
  // Todo bookkeeping — every provider's spelling of "the plan changed".
  // `todowrite` is not in the desktop's table (its drivers emit TaskCreate /
  // TaskUpdate instead) but is listed here so the loose contains-match below
  // cannot land it on Write — "todowrite" contains "write".
  { displayName: "Todos", verb: "Updated todos", symbol: "checklist", kind: "todo", aliases: ["taskcreate", "taskupdate", "updatetodos", "todowrite"] },
  { displayName: "TaskGet", verb: "Read todo", symbol: "checklist", kind: "todo", aliases: ["taskget"] },
  { displayName: "TaskList", verb: "Listed todos", symbol: "checklist", kind: "todo", aliases: ["tasklist"] },

  { displayName: "Task", verb: "Task", symbol: "person.crop.square", kind: "task", aliases: ["task"] },
  { displayName: "Agent", verb: "Ran subagent", symbol: "person.crop.square", kind: "task", aliases: ["agent"] },
  { displayName: "Workflow", verb: "Workflow", symbol: "point.3.connected.trianglepath.dotted", kind: "task", aliases: ["workflow"] },
  { displayName: "SendMessage", verb: "Sent", symbol: "paperplane", kind: "task", aliases: ["sendmessage", "send_message"] },
  { displayName: "Monitor", verb: "Monitored", symbol: "waveform", kind: "bash", aliases: ["monitor"] },

  { displayName: "EnterPlanMode", verb: "Plan", symbol: "list.bullet.rectangle", kind: "plan", aliases: ["enterplanmode"] },
  { displayName: "ExitPlanMode", verb: "Plan", symbol: "list.bullet.rectangle", kind: "plan", aliases: ["exitplanmode"] },
  { displayName: "Plan", verb: "Plan", symbol: "list.bullet.rectangle", kind: "plan", aliases: ["plan", "create plan"] },

  { displayName: "Skill", verb: "Skill", symbol: "sparkles", kind: "skill", aliases: ["skill"] },
  { displayName: "AskUserQuestion", verb: "Question", symbol: "questionmark.circle", kind: "question", aliases: ["askuserquestion", "ask_user", "askuser"] },
  { displayName: "Intent", verb: "Intent", symbol: "sparkles", kind: "generic", aliases: ["report_intent"] },

  { displayName: "WebFetch", verb: "Fetched", symbol: "globe", kind: "web", aliases: ["webfetch", "web_fetch"] },
  { displayName: "WebSearch", verb: "Searched the web", symbol: "globe", kind: "web", aliases: ["websearch", "web_search"] },
  { displayName: "ToolSearch", verb: "Searched tools", symbol: "magnifyingglass", kind: "grep", aliases: ["toolsearch"] },

  { displayName: "Read", verb: "Read", symbol: "doc.text", kind: "read", aliases: ["read", "read_file"] },
  { displayName: "View", verb: "Viewed", symbol: "eye", kind: "read", aliases: ["view"] },
  { displayName: "Edit", verb: "Edited", symbol: "pencil", kind: "edit", aliases: ["edit", "replace", "edit_file"] },
  { displayName: "Apply Patch", verb: "Edited", symbol: "pencil", kind: "edit", aliases: ["apply_patch"] },
  { displayName: "Write", verb: "Wrote", symbol: "square.and.pencil", kind: "write", aliases: ["write", "writeifempty", "create_file", "write_file"] },
  { displayName: "Create", verb: "Created", symbol: "doc.badge.plus", kind: "write", aliases: ["create"] },
  { displayName: "Delete", verb: "Deleted", symbol: "trash", kind: "delete", aliases: ["delete", "delete_file"] },

  { displayName: "Bash", verb: "Ran", symbol: "terminal", kind: "bash", aliases: ["bash", "terminal"] },
  { displayName: "Shell", verb: "Ran", symbol: "terminal", kind: "bash", aliases: ["shell"] },
  { displayName: "Glob", verb: "Searched", symbol: "folder", kind: "glob", aliases: ["glob", "find"] },
  { displayName: "Grep", verb: "Grepped", symbol: "text.magnifyingglass", kind: "grep", aliases: ["grep", "rg"] },
  { displayName: "SQL", verb: "SQL", symbol: "tablecells", kind: "sql", aliases: ["sql"] },
  { displayName: "Search", verb: "Searched", symbol: "magnifyingglass", kind: "grep", aliases: ["search"] },

  // Mains' own review tools, as the desktop names them.
  { displayName: "CheckPackage", verb: "Checked package", symbol: "shippingbox", kind: "generic", aliases: ["checkpackage"] },
  { displayName: "SaveReview", verb: "Saved review", symbol: "checkmark.seal", kind: "generic", aliases: ["savereview"] },
  { displayName: "SaveFindings", verb: "Saved findings", symbol: "checkmark.seal", kind: "generic", aliases: ["savefinding", "savefindings"] },
];

interface VerbInfo {
  label: string;
  symbol: string;
  kind: ToolKind;
}

/** Past-tense verb labels for MCP tools, mirroring the desktop's DEFAULT_VERBS. */
const DEFAULT_VERBS: Record<string, VerbInfo> = {
  list: { label: "listed", symbol: "list.bullet", kind: "generic" },
  get: { label: "got", symbol: "eye", kind: "generic" },
  view: { label: "viewed", symbol: "eye", kind: "generic" },
  fetch: { label: "fetched", symbol: "eye", kind: "generic" },
  read: { label: "read", symbol: "doc.text", kind: "generic" },
  search: { label: "searched", symbol: "magnifyingglass", kind: "generic" },
  research: { label: "researched", symbol: "magnifyingglass", kind: "generic" },
  save: { label: "saved", symbol: "pencil", kind: "generic" },
  create: { label: "created", symbol: "plus", kind: "generic" },
  update: { label: "updated", symbol: "pencil", kind: "generic" },
  delete: { label: "deleted", symbol: "trash", kind: "generic" },
  archive: { label: "archived", symbol: "trash", kind: "generic" },
  extract: { label: "extracted", symbol: "eye", kind: "generic" },
  add: { label: "added", symbol: "plus", kind: "generic" },
  remove: { label: "removed", symbol: "trash", kind: "generic" },
  send: { label: "sent", symbol: "paperplane", kind: "generic" },
  run: { label: "ran", symbol: "terminal", kind: "generic" },
  draft: { label: "drafted", symbol: "pencil", kind: "generic" },
  reply: { label: "replied", symbol: "paperplane", kind: "generic" },
  open: { label: "opened", symbol: "eye", kind: "generic" },
  close: { label: "closed", symbol: "trash", kind: "generic" },
};

const MCP_SYMBOL = "puzzlepiece.extension";

function findBuiltin(lower: string): BuiltinTool | null {
  for (const tool of BUILTIN_TOOLS) {
    if (tool.aliases.includes(lower)) return tool;
  }
  // Loose pass for provider variants (`agent_read`, `bash_exec`). Restricted to
  // aliases of 4+ characters so "search" doesn't match inside "research".
  for (const tool of BUILTIN_TOOLS) {
    for (const alias of tool.aliases) {
      if (alias.length >= 4 && lower.includes(alias)) return tool;
    }
  }
  return null;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

function snakeToWords(value: string): string {
  return value.replace(/_/g, " ").trim();
}

/**
 * `mcp__<server>__<tool>` → a sentence. Bridge servers (codex routes several
 * upstream MCPs through one) prefix the tool with the real app, delimited by a
 * dot on newer builds and an underscore on older ones — prefer the dot.
 */
function resolveMcp(lower: string): ResolvedTool {
  const afterMcp = lower.slice("mcp__".length);
  const sepIdx = afterMcp.indexOf("__");
  const server = sepIdx > 0 ? afterMcp.slice(0, sepIdx) : afterMcp;
  const toolName = sepIdx > 0 ? afterMcp.slice(sepIdx + 2) : "";

  let vendor = titleCase(snakeToWords(server));
  let rest = toolName;

  const dotIdx = toolName.indexOf(".");
  if (dotIdx > 0) {
    vendor = titleCase(snakeToWords(toolName.slice(0, dotIdx)));
    rest = toolName.slice(dotIdx + 1);
  } else {
    const underscore = toolName.indexOf("_");
    if (underscore > 0 && !DEFAULT_VERBS[toolName.slice(0, underscore)]) {
      vendor = titleCase(toolName.slice(0, underscore));
      rest = toolName.slice(underscore + 1);
    }
  }

  const underscore = rest.indexOf("_");
  const rawVerb = underscore > 0 ? rest.slice(0, underscore) : rest;
  const entity = snakeToWords(underscore > 0 ? rest.slice(underscore + 1) : "");
  const verbInfo = DEFAULT_VERBS[rawVerb];

  if (verbInfo) {
    const label = entity ? `${vendor} ${verbInfo.label} ${entity}` : `${vendor} ${verbInfo.label}`;
    return { displayName: label, verb: label, symbol: verbInfo.symbol, kind: "generic", vendor };
  }

  const whole = snakeToWords(rest);
  const label = whole ? `${vendor} ${whole}` : vendor;
  return { displayName: label, verb: label, symbol: MCP_SYMBOL, kind: "generic", vendor };
}

/** Resolve a `tool_calls.tool_name` to how the row should read. */
export function resolveTool(toolName: string): ResolvedTool {
  const lower = toolName.trim().toLowerCase();

  if (lower.startsWith("mcp__")) return resolveMcp(lower);

  const builtin = findBuiltin(lower);
  if (builtin) {
    return {
      displayName: builtin.displayName,
      verb: builtin.verb,
      symbol: builtin.symbol,
      kind: builtin.kind,
    };
  }

  // Unknown tool — a newly shipped SDK tool or a plugin's own. Show its name
  // rather than a dead "tool call" line.
  const label = titleCase(snakeToWords(toolName.trim())) || "Tool";
  return { displayName: label, verb: label, symbol: "wrench.and.screwdriver", kind: "generic" };
}

/**
 * Past-tense → present-participle, so a call still in flight reads
 * "Reading…" rather than "Read". Words outside the map pass through.
 */
const GERUND_BY_PAST: Record<string, string> = {
  listed: "listing",
  got: "getting",
  fetched: "fetching",
  read: "reading",
  searched: "searching",
  researched: "researching",
  saved: "saving",
  created: "creating",
  updated: "updating",
  deleted: "deleting",
  archived: "archiving",
  extracted: "extracting",
  added: "adding",
  removed: "removing",
  sent: "sending",
  ran: "running",
  drafted: "drafting",
  replied: "replying",
  opened: "opening",
  closed: "closing",
  monitored: "monitoring",
  grepped: "grepping",
  viewed: "viewing",
  edited: "editing",
  checked: "checking",
  wrote: "writing",
};

/** Rewrite the first recognized past-tense word of a verb label to its gerund. */
export function toPresentTense(label: string): string {
  const words = label.split(" ");
  for (let i = 0; i < words.length; i++) {
    const gerund = GERUND_BY_PAST[words[i].toLowerCase()];
    if (!gerund) continue;
    words[i] =
      words[i][0] === words[i][0].toUpperCase()
        ? gerund[0].toUpperCase() + gerund.slice(1)
        : gerund;
    return words.join(" ");
  }
  return label;
}
