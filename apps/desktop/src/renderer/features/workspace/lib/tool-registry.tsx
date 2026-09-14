import {
  Bash,
  Check,
  Document,
  Edit,
  EnterPlan,
  ExitPlan,
  Glob,
  Grep,
  Infinite,
  Layers,
  Mains,
  Plus,
  Question,
  Read,
  Search,
  SendMessage,
  Sparkles,
  Task,
  Trash,
  View,
  Web,
  Workflow,
  Write,
} from "@/components/ui/icons";
import { FolderIcon } from "@/components/ui/icons/file-icons";

export interface VerbInfo {
  /** Past-tense label used in display, e.g. "listed" → "Linear listed issues". */
  label: string;
  icon: React.ReactNode;
}

export interface VendorInfo {
  id: string;
  /** Human-readable vendor label, e.g. "Linear", "GitHub". */
  label: string;
  category: string;
  /** Tool name prefixes (with trailing separator) that identify this vendor. */
  prefixes: string[];
  icon: React.ReactNode;
  /**
   * Direct mapping from tool name (after prefix strip, lowercased) to a fixed
   * displayName. Used for tools that have specialized renderers in
   * `tool-call-item.tsx` (Mains: SaveReview, CheckPackage, …).
   */
  specialTools?: Record<string, string>;
  /** Verb-level overrides; merged onto DEFAULT_VERBS. */
  verbs?: Record<string, VerbInfo>;
}

export interface BuiltinTool {
  /** Canonical display name, e.g. "Read", "Bash". */
  displayName: string;
  /** Stable grouping key (lowercase). Tools that share a key group together. */
  groupKey: string;
  category: string;
  icon: React.ReactNode;
  /**
   * Lowercased tool-name aliases that resolve to this builtin. Order matters —
   * earlier entries win when matched via prefix/contains rules.
   */
  aliases: string[];
  /**
   * `true` for tools that should always start a new group on their own
   * (Task, TaskCreate/TaskUpdate). Mirrors the legacy `isSpecial` behavior.
   */
  isSpecialGroup?: boolean;
}

/** Past-tense verb labels used for any vendor that doesn't override them. */
export const DEFAULT_VERBS: Record<string, VerbInfo> = {
  list: { label: "listed", icon: <Search className="size-3.5" /> },
  get: { label: "got", icon: <View className="size-4" /> },
  view: { label: "viewed", icon: <View className="size-4" /> },
  fetch: { label: "fetched", icon: <View className="size-4" /> },
  read: { label: "read", icon: <Read className="size-4" /> },
  search: { label: "searched", icon: <Search className="size-3.5" /> },
  research: { label: "researched", icon: <Search className="size-3.5" /> },
  save: { label: "saved", icon: <Edit className="size-3.5" /> },
  create: { label: "created", icon: <Plus className="size-4" /> },
  update: { label: "updated", icon: <Edit className="size-3.5" /> },
  delete: { label: "deleted", icon: <Trash className="size-3.5" /> },
  archive: { label: "archived", icon: <Trash className="size-3.5" /> },
  extract: { label: "extracted", icon: <View className="size-4" /> },
  add: { label: "added", icon: <Plus className="size-4" /> },
  remove: { label: "removed", icon: <Trash className="size-3.5" /> },
  send: { label: "sent", icon: <SendMessage className="size-4" /> },
  run: { label: "ran", icon: <Bash className="size-4" /> },
  draft: { label: "drafted", icon: <Edit className="size-3.5" /> },
  reply: { label: "replied", icon: <SendMessage className="size-4" /> },
  open: { label: "opened", icon: <View className="size-4" /> },
  close: { label: "closed", icon: <Trash className="size-3.5" /> },
};

/**
 * Vendor registry. Add a new MCP provider here — its tools will be parsed as
 * `{verb}_{entity}` automatically and rendered through `McpDisplay` without
 * any further wiring.
 */
/**
 * Tools whose point is producing or changing a file, by the `displayName`
 * `resolveTool()` resolves them to — so every provider's spelling
 * (`write` / `create_file` / `apply_patch` / …) collapses to one name here.
 *
 * Read is absent on purpose: this is the set whose output is a deliverable,
 * not the set that touches the filesystem.
 */
export const FILE_WRITING_TOOLS: ReadonlySet<string> = new Set([
  "Write",
  "Edit",
  "Create",
  "Apply Patch",
]);

export const VENDORS: VendorInfo[] = [
  {
    id: "mains",
    label: "Mains",
    category: "Review",
    prefixes: ["mcp__mains__"],
    icon: <Mains className="size-4" />,
    // These have specialized renderers in tool-call-item.tsx — keep their
    // displayNames stable so the dispatch keeps matching.
    specialTools: {
      savereview: "SaveReview",
      savefinding: "SaveFinding",
      savefindings: "SaveFindings",
      checkpackage: "CheckPackage",
    },
  },
];

/**
 * Built-in (non-MCP) tools. Order is significant for the contains-fallback
 * resolution path — more specific aliases must come before less specific ones
 * (e.g. `webfetch` before `fetch`).
 */
export const BUILTIN_TOOLS: BuiltinTool[] = [
  // Task plan tools — claude_code emits TaskCreate (one call per item) +
  // TaskUpdate (taskId/status). They share the `task-plan` groupKey so
  // `stripTaskPlanEvents` strips them from the timeline and the
  // `TodoSummaryBar` aggregator picks them up as the source of truth.
  // TaskGet / TaskList are read-only queries → own keys, not isSpecialGroup.
  {
    displayName: "TaskCreate",
    groupKey: "task-plan",
    category: "Todo",
    icon: <Check className="size-4" />,
    aliases: ["taskcreate"],
    isSpecialGroup: true,
  },
  {
    displayName: "TaskUpdate",
    groupKey: "task-plan",
    category: "Todo",
    icon: <Check className="size-4" />,
    aliases: ["taskupdate"],
    isSpecialGroup: true,
  },
  // Copilot's full-snapshot todo writes (synthesized from session.todos_changed).
  // Shares the `task-plan` groupKey so `stripTaskPlanEvents` removes the raw
  // cards from the timeline and the TodoSummaryBar renders the latest snapshot.
  {
    displayName: "UpdateTodos",
    groupKey: "task-plan",
    category: "Todo",
    icon: <Check className="size-4" />,
    aliases: ["updatetodos"],
    isSpecialGroup: true,
  },
  {
    displayName: "TaskGet",
    groupKey: "taskget",
    category: "Todo",
    icon: <View className="size-4" />,
    aliases: ["taskget"],
  },
  {
    displayName: "TaskList",
    groupKey: "tasklist",
    category: "Todo",
    icon: <Search className="size-3.5" />,
    aliases: ["tasklist"],
  },
  {
    displayName: "Task",
    groupKey: "task",
    category: "Agent",
    icon: <Task className="size-4" />,
    aliases: ["task"],
    isSpecialGroup: true,
  },
  {
    displayName: "Agent",
    groupKey: "agent",
    category: "Agent",
    icon: <Task className="size-4" />,
    aliases: ["agent"],
  },
  // Multi-agent orchestration tool. Input carries the workflow `script`
  // (meta.name / description / phases) or a scriptPath+resumeFromRunId; output
  // is the launch receipt. Rendered by WorkflowDisplay in tool-call-item.tsx.
  {
    displayName: "Workflow",
    groupKey: "workflow",
    category: "Agent",
    icon: <Workflow className="size-4" />,
    aliases: ["workflow"],
  },
  // Agent-to-agent message. Input carries `to` + `summary` + `message` (plain
  // text, or a protocol object for shutdown / plan-approval handshakes); output
  // is the delivery receipt. Rendered by SendMessageDisplay in tool-call-item.tsx.
  {
    displayName: "SendMessage",
    groupKey: "sendmessage",
    category: "Agent",
    icon: <SendMessage className="size-4" />,
    aliases: ["sendmessage", "send_message"],
  },
  // Background watch. Input carries the `description` plus either a shell
  // `command` (each stdout line is an event) or a `ws` endpoint (each text
  // frame is an event), bounded by `timeout_ms` unless `persistent`.
  // Rendered by MonitorDisplay in tool-call-item.tsx.
  {
    displayName: "Monitor",
    groupKey: "monitor",
    category: "Shell",
    icon: <Infinite className="size-4" />,
    aliases: ["monitor"],
  },
  {
    displayName: "EnterPlanMode",
    groupKey: "enterplanmode",
    category: "Todo",
    icon: <EnterPlan className="size-4" />,
    aliases: ["enterplanmode"],
  },
  {
    displayName: "ExitPlanMode",
    groupKey: "exitplanmode",
    category: "Todo",
    icon: <ExitPlan className="size-4" />,
    aliases: ["exitplanmode"],
  },
  {
    displayName: "Plan",
    groupKey: "plan",
    category: "Todo",
    icon: <EnterPlan className="size-4" />,
    aliases: ["plan", "create plan"],
  },
  {
    displayName: "Skill",
    groupKey: "skill",
    category: "Skill",
    icon: <Sparkles className="size-4" />,
    aliases: ["skill"],
  },
  {
    displayName: "AskUserQuestion",
    groupKey: "askuserquestion",
    category: "Interaction",
    icon: <Question className="size-4" />,
    aliases: ["askuserquestion", "ask_user", "askuser"],
  },
  {
    displayName: "WebFetch",
    groupKey: "webfetch",
    category: "Search",
    icon: <Web className="size-4" />,
    aliases: ["webfetch", "web_fetch"],
  },
  {
    displayName: "WebSearch",
    groupKey: "websearch",
    category: "Search",
    icon: <Web className="size-4" />,
    aliases: ["websearch", "web_search"],
  },
  {
    displayName: "ToolSearch",
    groupKey: "toolsearch",
    category: "Search",
    icon: <Search className="size-3.5" />,
    aliases: ["toolsearch"],
  },
  {
    displayName: "Intent",
    groupKey: "intent",
    category: "Agent",
    icon: <Sparkles className="size-4" />,
    aliases: ["report_intent"],
  },
  {
    displayName: "Read",
    groupKey: "read",
    category: "File",
    icon: <Read className="size-4" />,
    aliases: ["read", "read_file"],
  },
  {
    displayName: "View",
    groupKey: "view",
    category: "File",
    icon: <Document className="size-4" />,
    aliases: ["view"],
  },
  {
    displayName: "Edit",
    groupKey: "edit",
    category: "File",
    icon: <Edit className="size-3.5" />,
    aliases: ["edit", "replace", "edit_file"],
  },
  {
    displayName: "Write",
    groupKey: "write",
    category: "File",
    icon: <Write className="size-3.5" />,
    aliases: ["write", "writeifempty", "create_file", "write_file"],
  },
  // Copilot CLI's file-creation tool. Distinct alias (`create`) so it isn't
  // confused with `create_file`; rendered like Write (path + content diff)
  // via the `Create` renderers in tool-input-preview / write-display.
  {
    displayName: "Create",
    groupKey: "create",
    category: "File",
    icon: <FolderIcon className="size-4" />,
    aliases: ["create"],
  },
  {
    displayName: "Delete",
    groupKey: "delete",
    category: "File",
    icon: <Trash className="size-3.5" />,
    aliases: ["delete", "delete_file"],
  },
  // Copilot CLI's patch tool — input is a raw `*** Begin Patch …` envelope.
  // Rendered as a diff by ApplyPatchDisplay (timeline) / the Apply_patch
  // renderer (approval); registering it here gives the approval header a
  // proper Edit glyph + "Apply Patch" label instead of the generic MCP icon.
  {
    displayName: "Apply Patch",
    groupKey: "apply_patch",
    category: "File",
    icon: <Edit className="size-3.5" />,
    aliases: ["apply_patch"],
  },
  {
    displayName: "Bash",
    groupKey: "bash",
    category: "Shell",
    icon: <Bash className="size-4" />,
    aliases: ["bash", "terminal"],
  },
  {
    displayName: "Shell",
    groupKey: "shell",
    category: "Shell",
    icon: <Bash className="size-4" />,
    aliases: ["shell"],
  },
  {
    displayName: "Glob",
    groupKey: "glob",
    category: "File",
    icon: <Glob className="size-4" />,
    aliases: ["glob", "find"],
  },
  {
    displayName: "Grep",
    groupKey: "grep",
    category: "Search",
    icon: <Grep className="size-3.5" />,
    aliases: ["grep"],
  },
  // Copilot CLI's ripgrep tool. Shares the grep groupKey so consecutive
  // content searches collapse together; rendered by GrepDisplay (timeline) and
  // the Rg renderer (approval).
  {
    displayName: "Search",
    groupKey: "grep",
    category: "Search",
    icon: <Grep className="size-3.5" />,
    aliases: ["rg"],
  },
  // Copilot CLI's `sql` tool — runs queries against its session-state todo DB
  // (plan/todo bookkeeping). Input is { description, query }.
  {
    displayName: "SQL",
    groupKey: "sql",
    category: "Database",
    icon: <Layers className="size-4" />,
    aliases: ["sql"],
  },
  {
    displayName: "Search",
    groupKey: "search",
    category: "Search",
    icon: <Search className="size-3.5" />,
    aliases: ["search"],
  },
  {
    displayName: "CheckPackage",
    groupKey: "checkpackage",
    category: "Code",
    icon: <Mains className="size-4" />,
    aliases: ["checkpackage"],
  },
  {
    displayName: "SaveReview",
    groupKey: "savereview",
    category: "Code",
    icon: <Mains className="size-4" />,
    aliases: ["savereview"],
  },
  {
    displayName: "SaveFinding",
    groupKey: "savefinding",
    category: "Code",
    icon: <Mains className="size-4" />,
    aliases: ["savefinding"],
  },
  {
    displayName: "SaveFindings",
    groupKey: "savefindings",
    category: "Code",
    icon: <Mains className="size-4" />,
    aliases: ["savefindings"],
  },
];
