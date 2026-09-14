import type { ReactNode } from "react";
import { Text } from "@/components/ui";
import type { RunEvent } from "../../types";
import { parseToolContent, type ParsedToolContent } from "../../lib/parse-tool-content";
import { resolveTool } from "../../lib/resolve-tool";
import { usePluginLogoMap, renderPluginIcon, normalizeSlug } from "../../hooks";
import { TaskDisplay, type TaskParams } from "./task-display";
import { PlanDisplay } from "./plan-display";
import { WriteDisplay, type WriteParams } from "./write-display";
import { McpDisplay } from "./mcp-display";
import { SaveReviewDisplay, type SaveReviewParams } from "./save-review-display";
import { CheckPackageDisplay, type CheckPackageParams } from "./check-package-display";
import { SaveFindingDisplay, type SaveFindingParams } from "./save-finding-display";
import { AgentDisplay, type AgentParams } from "./agent-display";
import { SendMessageDisplay, type SendMessageParams } from "./send-message-display";
import { MonitorDisplay, type MonitorParams } from "./monitor-display";
import { IntentDisplay, type IntentParams } from "./intent-display";
import { BashDisplay, type BashParams } from "./bash-display";
import { GlobDisplay, type GlobParams } from "./glob-display";
import { ReadDisplay, type ReadParams } from "./read-display";
import { GrepDisplay, type GrepParams } from "./grep-display";
import { SqlDisplay, type SqlParams } from "./sql-display";
import { EditDisplay, type EditParams } from "./edit-display";
import { ApplyPatchDisplay } from "./apply-patch-display";
import { DeleteDisplay, type DeleteParams } from "./delete-display";
import { ViewDisplay, type ViewParams } from "./view-display";
import { ToolSearchDisplay, type ToolSearchParams } from "./tool-search-display";
import { WorkflowDisplay, type WorkflowParams } from "./workflow-display";
import { SkillDisplay, type SkillParams } from "./skill-display";
import { AskUserQuestionDisplay, type AskUserQuestionParams } from "./ask-user-question-display";
import { WebFetchDisplay, type WebFetchParams } from "./web-fetch-display";
import { GenericToolDisplay } from "./generic-tool-display";
import { TOOL_ROW_TEXT, ToolStatusProvider, eventToolStatus } from "./_shared";
import {
  TaskProgressStrip,
  type SubagentMetadata,
  type TaskMetadata,
} from "./task-progress-strip";

interface ToolCallItemProps {
  event: RunEvent;
  isCompact?: boolean;
}

interface Ctx {
  toolNameLower: string;
  displayName: string;
  /** Tool icon, already swapped for the codex plugin logo when one matched. */
  icon: ReactNode;
  /** Plugin logo override for the Skill renderer; undefined → Sparkles fallback. */
  skillIcon: ReactNode | undefined;
  resolved: ReturnType<typeof resolveTool>;
  metadataInput: Record<string, unknown> | undefined;
  params: Record<string, unknown> | null;
  summary: string;
  event: RunEvent;
  isCompact: boolean;
}

type Renderer = (ctx: Ctx) => ReactNode | null;

function pickParams<T>(ctx: Ctx, fallback: T): T {
  if (ctx.metadataInput) return ctx.metadataInput as T;
  if (ctx.params) return ctx.params as T;
  return fallback;
}

function hasMeaningfulOutput(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

/**
 * Match toolNameLower ∈ names, render `<Display params output isCompact />`.
 * `buildFallback` runs only when neither metadata.input nor parsed params are present.
 */
function withOutput<T>(
  names: readonly string[],
  Display: React.ComponentType<{ params: T; output?: unknown; isCompact?: boolean }>,
  buildFallback: (ctx: Ctx) => T,
): Renderer {
  const renderer: Renderer = function renderWithOutput(ctx) {
    if (!names.includes(ctx.toolNameLower)) return null;
    const params = pickParams<T>(ctx, buildFallback(ctx));
    return <Display params={params} output={ctx.event.metadata?.output} isCompact={ctx.isCompact} />;
  };
  return renderer;
}

/** Same as `withOutput` but for displays that don't accept an `output` prop. */
function noOutput<T>(
  names: readonly string[],
  Display: React.ComponentType<{ params: T; isCompact?: boolean }>,
  buildFallback: (ctx: Ctx) => T,
): Renderer {
  const renderer: Renderer = function renderNoOutput(ctx) {
    if (!names.includes(ctx.toolNameLower)) return null;
    const params = pickParams<T>(ctx, buildFallback(ctx));
    return <Display params={params} isCompact={ctx.isCompact} />;
  };
  return renderer;
}

/** Mains-style tools resolve to a PascalCase `displayName` and use an empty-object fallback. */
function byDisplayName<T>(
  name: string,
  render: (ctx: Ctx, params: T) => ReactNode,
): Renderer {
  const renderer: Renderer = function renderByDisplayName(ctx) {
    if (ctx.displayName !== name) return null;
    return render(ctx, pickParams<T>(ctx, {} as T));
  };
  return renderer;
}

const summaryAs = (key: string) => (ctx: Ctx) => ({ [key]: ctx.summary }) as never;

const DISPATCH: Renderer[] = [
  // Plan / ExitPlanMode — PlanDisplay needs the raw event, not params.
  (ctx) =>
    ctx.toolNameLower === "plan" ||
    ctx.toolNameLower === "create plan" ||
    ctx.toolNameLower === "exitplanmode"
      ? <PlanDisplay event={ctx.event} />
      : null,

  // Codex collab tool calls (spawnAgent & co) have no renderer on purpose —
  // the transcript grouping drops them; subagents live in the session panel.

  noOutput<TaskParams>(["task"], TaskDisplay, (ctx) => ({ description: ctx.summary })),
  noOutput<AgentParams>(["agent"], AgentDisplay, (ctx) => ({ description: ctx.summary })),
  withOutput<SendMessageParams>(
    ["sendmessage", "send_message"],
    SendMessageDisplay,
    (ctx) => ({ summary: ctx.summary }),
  ),
  withOutput<MonitorParams>(["monitor"], MonitorDisplay, (ctx) => ({
    description: ctx.summary,
  })),

  withOutput<EditParams>(["edit", "replace"], EditDisplay, summaryAs("file_path")),

  // Copilot CLI's apply_patch — the input is a raw `*** Begin Patch …` envelope
  // string (no params object). `metadata.input` is dropped upstream (a bare
  // string fails the JSON re-parse) and `summary` is truncated to 60 chars, so
  // recover the envelope from the event content (the file path sits in its
  // first ~200 chars). The output is the authoritative diff/path source.
  (ctx) => {
    if (ctx.toolNameLower !== "apply_patch") return null;
    const rawInput: unknown = ctx.metadataInput;
    const begin = ctx.event.content.indexOf("*** Begin Patch");
    const patch =
      typeof rawInput === "string"
        ? rawInput
        : begin >= 0
          ? ctx.event.content.slice(begin)
          : ctx.summary;
    return (
      <ApplyPatchDisplay
        patch={patch}
        output={ctx.event.metadata?.output}
        isCompact={ctx.isCompact}
      />
    );
  },

  // WriteDisplay is the odd one — accepts `output` but not `isCompact`.
  (ctx) => {
    if (!["write", "writeifempty", "create_file", "create"].includes(ctx.toolNameLower)) return null;
    const params = pickParams<WriteParams>(ctx, { file_path: ctx.summary });
    return <WriteDisplay params={params} output={ctx.event.metadata?.output} />;
  },

  withOutput<BashParams>(["bash", "shell"], BashDisplay, summaryAs("command")),
  withOutput<GlobParams>(["glob", "find"], GlobDisplay, summaryAs("pattern")),
  withOutput<GrepParams>(["grep", "search", "rg"], GrepDisplay, summaryAs("pattern")),
  noOutput<SqlParams>(["sql"], SqlDisplay, summaryAs("query")),
  withOutput<ReadParams>(["read"], ReadDisplay, summaryAs("file_path")),
  withOutput<DeleteParams>(["delete"], DeleteDisplay, summaryAs("file_path")),
  withOutput<ViewParams>(["view"], ViewDisplay, summaryAs("path")),
  noOutput<IntentParams>(["report_intent"], IntentDisplay, summaryAs("intent")),
  withOutput<ToolSearchParams>(["toolsearch"], ToolSearchDisplay, summaryAs("query")),
  withOutput<WorkflowParams>(["workflow"], WorkflowDisplay, () => ({})),
  (ctx) => {
    if (ctx.toolNameLower !== "skill") return null;
    const params = pickParams<SkillParams>(ctx, { skill: ctx.summary });
    return <SkillDisplay params={params} icon={ctx.skillIcon} isCompact={ctx.isCompact} />;
  },
  withOutput<AskUserQuestionParams>(
    ["askuserquestion", "ask_user", "askuser"],
    AskUserQuestionDisplay,
    summaryAs("question"),
  ),
  withOutput<WebFetchParams>(
    ["webfetch", "web_fetch", "websearch"],
    WebFetchDisplay,
    (ctx) =>
      ctx.toolNameLower === "websearch"
        ? { query: ctx.summary }
        : { url: ctx.summary },
  ),

  byDisplayName<SaveReviewParams>("SaveReview", (ctx, params) => (
    <SaveReviewDisplay params={params} isCompact={ctx.isCompact} />
  )),
  byDisplayName<SaveFindingParams>("SaveFinding", (ctx, params) => (
    <SaveFindingDisplay params={params} isCompact={ctx.isCompact} />
  )),
  byDisplayName<SaveFindingParams>("SaveFindings", (ctx, params) => (
    <SaveFindingDisplay params={params} isCompact={ctx.isCompact} />
  )),
  byDisplayName<CheckPackageParams>("CheckPackage", (ctx, params) => (
    <CheckPackageDisplay params={params} output={ctx.event.metadata?.output} isCompact={ctx.isCompact} />
  )),

  // Generic MCP fallback — the resolver tags any vendor-mapped tool (Linear, GitHub,
  // Figma, Notion, computer-use, Mains-without-special-renderer, …) with `vendorId`,
  // so we don't need a brittle string-includes chain.
  (ctx) => {
    if (ctx.resolved.vendorId === undefined) return null;
    return (
      <McpDisplay
        displayName={ctx.displayName}
        icon={ctx.icon}
        params={ctx.metadataInput ?? ctx.params}
        output={ctx.event.metadata?.output}
        isCompact={ctx.isCompact}
      />
    );
  },
];

export function ToolCallItem({ event, isCompact = true }: ToolCallItemProps) {
  // Mapper memoizes the parse on metadata.parsed; fall back for legacy events
  // (e.g. streaming artifacts that never went through `mapToolCallToEvent`).
  const { toolName, params, summary } =
    (event.metadata?.parsed as ParsedToolContent | undefined) ??
    parseToolContent(event.content);
  const metadataInput = event.metadata?.input as
    | Record<string, unknown>
    | undefined;
  const resolved = resolveTool(event.content);

  // Codex plugin tools/skills don't ship a curated brand glyph — swap the
  // generic MCP / Sparkles icon for the plugin's real logo when we can match it
  // by slug (`mcp__<slug>__…` tools, `<slug>:<skill>` skills). The plugin logo
  // wins whenever a match exists; otherwise the static icon stays. Off codex the
  // map is empty, so everything falls back to its original icon.
  const pluginLogos = usePluginLogoMap();
  const toolPlugin = resolved.vendorId
    ? pluginLogos.get(normalizeSlug(resolved.vendorId))
    : undefined;
  const toolIcon = renderPluginIcon(toolPlugin) ?? resolved.icon;

  const skillRaw =
    toolName.toLowerCase() === "skill"
      ? (typeof params?.skill === "string" ? params.skill : summary) || ""
      : "";
  const skillSlug = skillRaw.includes(":") ? skillRaw.split(":")[0] : undefined;
  const skillIcon =
    renderPluginIcon(
      skillSlug ? pluginLogos.get(normalizeSlug(skillSlug)) : undefined,
    ) ?? undefined;

  const hasParamsOrInput =
    (params !== null && Object.keys(params).length > 0) ||
    (metadataInput !== undefined && Object.keys(metadataInput).length > 0);
  const hasSummary = Boolean(summary?.trim());
  const isEmptyTool =
    !hasParamsOrInput && !hasSummary && !hasMeaningfulOutput(event.metadata?.output);

  // Lifecycle status (queued/running/done/error/canceled) flows down to every
  // ToolHeader via context, so the per-tool displays stay status-agnostic.
  const status = eventToolStatus(event);

  // A task can outlive the tool call that spawned it (a backgrounded command,
  // a subagent), so its outcome lands on the tool call's metadata after the
  // call itself has settled. Appended to whatever the per-tool renderer
  // produced rather than dispatched by tool name — any tool can be backgrounded.
  const task = event.metadata?.task as TaskMetadata | undefined;
  const subagent = event.metadata?.subagent as SubagentMetadata | undefined;
  const wrap = (node: ReactNode) => (
    <ToolStatusProvider value={status}>
      {node}
      {(task || subagent) && (
        <TaskProgressStrip task={task} subagent={subagent} isCompact={isCompact} />
      )}
    </ToolStatusProvider>
  );

  if (isEmptyTool) {
    if (isCompact) {
      return wrap(
        <Text as="div" size="s" tone="inherit" className="flex items-center gap-1 px-1 font-sans">
          <span className="text-primary-500 shrink-0" />
        </Text>,
      );
    }
    return wrap(
      <div className=" ">
        <Text as="div" size="s" tone="inherit" className="flex items-center gap-1 font-sans">
          <span className={TOOL_ROW_TEXT}>
            {toolIcon}
          </span>
          <span className={`font-medium ${TOOL_ROW_TEXT}`}>
            {resolved.displayName}
          </span>
          <span className="text-primary-500 italic truncate" />
        </Text>
      </div>,
    );
  }

  const ctx: Ctx = {
    toolNameLower: toolName.toLowerCase(),
    displayName: resolved.displayName,
    icon: toolIcon,
    skillIcon,
    resolved,
    metadataInput,
    params,
    summary,
    event,
    isCompact,
  };

  for (const renderer of DISPATCH) {
    const node = renderer(ctx);
    if (node !== null) return wrap(node);
  }

  // No dedicated renderer matched — a tool we haven't registered, a newly
  // shipped SDK tool, or a plugin's own. GenericToolDisplay derives a
  // status-aware header and an expandable input/output panel from the raw
  // payload, so an unknown tool degrades to "inspectable" instead of a dead
  // line whose result is unreachable in the UI.
  return wrap(
    <GenericToolDisplay
      icon={toolIcon}
      displayName={resolved.displayName}
      params={metadataInput ?? params}
      output={event.metadata?.output}
      summary={summary}
      isCompact={isCompact}
    />,
  );
}
