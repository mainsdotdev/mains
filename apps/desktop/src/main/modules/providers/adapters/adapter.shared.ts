// ─────────────────────────────────────────────────────────────
// Shared utilities for work run adapters (Claude & Copilot)
// Pure functions with no SDK-specific dependencies.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  WorkRunEvent,
  WorkRunEventHandler,
  WorkRunContextItem,
  FileAttachment,
} from "../../../../shared/adapter.types";

// ─────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────

export interface AdapterLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(prefix: string): AdapterLogger {
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}

// ─────────────────────────────────────────────────────────────
// Pre-approved tools (auto-allow without user dialog)
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Tool classification — tools that could plausibly modify files on disk.
// Used to trigger incremental workspace diff recomputation during a run.
// Bash is included because shell commands can touch arbitrary files.
// ─────────────────────────────────────────────────────────────

export const FILE_MODIFYING_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "write_file",
  "edit_file",
  "create_file",
  "str_replace_editor",
  "apply_patch",
  "apply_diff",
  "patch",
  "Bash",
  "bash",
  "shell",
]);

export function couldModifyFiles(toolName: string): boolean {
  return FILE_MODIFYING_TOOLS.has(toolName);
}

export const DEFAULT_ALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Glob",
  "Grep",
  "LSP",
  "Task",
  "TaskCreate",
  "TaskList",
  "TaskGet",
  "TaskUpdate",
  "EnterPlanMode",
  "ListMcpResources",
  "ReadMcpResource",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "Workflow",
  "StructuredOutput",
  "NotebookEdit",
  "Skill",
  "Agent",
  "mcp__mains__SaveReview",
  "mcp__mains__SaveFinding",
  "mcp__mains__SaveFindings",
  "mcp__mains__CheckPackage",
];

export const ALLOWED_TOOLS_SET = new Set(DEFAULT_ALLOWED_TOOLS);

/**
 * The tool set a run actually allows: the policy's allowlist (or the default
 * above) minus its hard-denied tools. The one place the mode harness's
 * abstract tool policy meets the adapter's default list — claude feeds the
 * result to `allowedTools`/`settings.permissions.allow` and its permission
 * bridge; copilot to its pre-tool-use gate.
 */
export function resolveEffectiveAllowedTools(
  policy?: {
    allowedTools: readonly string[] | null;
    disallowedTools: readonly string[];
  } | null,
): string[] {
  const base = policy?.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
  const disallowed = new Set(policy?.disallowedTools ?? []);
  return base.filter((tool) => !disallowed.has(tool));
}

// ─────────────────────────────────────────────────────────────
// Default-model resolution
// ─────────────────────────────────────────────────────────────

/**
 * Decide which entry of a live model catalog to mark `isDefault`.
 *
 * `providers.defaultModel` is a *user preference*, not a catalog fact: agent
 * CLIs rotate their models every few months and a configured id silently stops
 * matching. So a configured id only wins while it is still offered; otherwise
 * the driver's own preference (e.g. Copilot/Cursor's plan-agnostic "auto")
 * applies, and failing that the catalog's first entry — the CLIs list models in
 * preference order.
 *
 * @param ids catalog ids, in the order the CLI advertises them
 * @param configured `providers.defaultModel`, if the user pinned one
 * @param preferred driver-preferred fallbacks, most-preferred first
 */
export function resolveCatalogDefaultId(
  ids: readonly string[],
  configured: string | null | undefined,
  preferred: readonly string[] = [],
): string | undefined {
  const offered = new Set(ids);
  if (configured && offered.has(configured)) return configured;
  for (const id of preferred) {
    if (id && offered.has(id)) return id;
  }
  return ids[0];
}

// ─────────────────────────────────────────────────────────────
// Config refresh
// ─────────────────────────────────────────────────────────────

/**
 * Overwrite a driver's captured config *in place* — the backing implementation
 * of `ProviderDriver.updateConfig`.
 *
 * Every driver closes over the config object it was constructed with, and hands
 * that same reference to collaborators (Codex's session acquisition, Cursor's
 * selection resolver). Reassigning the local binding would leave those holding
 * the stale object, so we clear and refill the original: one object, every
 * reader current. Keys absent from `next` are dropped, so unsetting a setting
 * unsets it here too.
 */
export function adoptConfig<T extends object>(target: T, next: T): void {
  const current = target as Record<string, unknown>;
  for (const key of Object.keys(current)) delete current[key];
  Object.assign(current, next);
}

// ─────────────────────────────────────────────────────────────
// JSON helper
// ─────────────────────────────────────────────────────────────

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─────────────────────────────────────────────────────────────
// File attachments
// ─────────────────────────────────────────────────────────────

/** Where a run's attachments are written: `<tmp>/mains-uploads/<runId>`. */
export function attachmentUploadDir(runId: string): string {
  return path.join(os.tmpdir(), "mains-uploads", runId);
}

export function saveAttachments(
  attachments: FileAttachment[],
  runId: string,
): { savedPaths: string[]; inlineTexts: string[] } {
  const uploadDir = attachmentUploadDir(runId);
  fs.mkdirSync(uploadDir, { recursive: true });

  const savedPaths: string[] = [];
  const inlineTexts: string[] = [];

  for (const attachment of attachments) {
    // runs.service validates attachments before a run starts; this is the
    // write itself refusing to leave the upload directory regardless.
    const filePath = path.join(uploadDir, path.basename(attachment.name));
    if (path.dirname(filePath) !== uploadDir) {
      console.warn("[adapter.shared] skipped attachment with an unusable name:", attachment.name);
      continue;
    }
    const ext = path.extname(attachment.name).toLowerCase();
    const hasSource = typeof attachment.sourcePath === "string" && attachment.sourcePath.length > 0;

    // Inline text documents are read into the prompt regardless of source.
    if (attachment.type !== "image" && ext === ".txt") {
      let text = "";
      if (hasSource) {
        try {
          text = fs.readFileSync(attachment.sourcePath!, "utf-8");
        } catch {
          text = "";
        }
      } else if (attachment.data) {
        text = Buffer.from(attachment.data, "base64").toString("utf-8");
      }
      inlineTexts.push(`[Attached document: ${attachment.name}]\n${text}`);
      continue;
    }

    if (hasSource) {
      // Copy from disk directly — avoids holding base64 in memory.
      try {
        fs.copyFileSync(attachment.sourcePath!, filePath);
        savedPaths.push(filePath);
      } catch (err) {
        console.warn("[adapter.shared] failed to copy attachment from sourcePath:", err);
      }
    } else if (attachment.data) {
      fs.writeFileSync(filePath, Buffer.from(attachment.data, "base64"));
      savedPaths.push(filePath);
    }
  }

  return { savedPaths, inlineTexts };
}

function buildAttachmentPrompt(
  attachments: FileAttachment[],
  runId: string,
): string {
  if (!attachments || attachments.length === 0) return "";

  const { savedPaths, inlineTexts } = saveAttachments(attachments, runId);
  const parts: string[] = [];

  for (const filePath of savedPaths) {
    const ext = path.extname(filePath).toLowerCase();
    const isImage = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".bmp",
      ".svg",
    ].includes(ext);
    if (isImage) {
      parts.push(
        `I've attached an image: ${filePath}`,
      );
    } else {
      parts.push(
        `I've attached a file: ${filePath}`,
      );
    }
  }

  for (const text of inlineTexts) {
    parts.push(text);
  }

  return parts.join("\n\n");
}

// ─────────────────────────────────────────────────────────────
// Artifact extraction from tool output
// ─────────────────────────────────────────────────────────────

export function extractArtifactsFromToolOutput(
  toolName: string,
  output: unknown,
): WorkRunEvent[] {
  const artifacts: WorkRunEvent[] = [];

  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "write_file" ||
    toolName === "edit_file" ||
    toolName === "create_file" ||
    toolName === "str_replace_editor"
  ) {
    const out = output as Record<string, unknown> | undefined;
    if (out?.path && typeof out.path === "string") {
      artifacts.push({
        type: "artifact",
        kind: "file",
        path: out.path,
        content: typeof out.content === "string" ? out.content : undefined,
        metadata: { toolName },
      });
    } else if (out?.file_path && typeof out.file_path === "string") {
      artifacts.push({
        type: "artifact",
        kind: "file",
        path: out.file_path,
        content: typeof out.content === "string" ? out.content : undefined,
        metadata: { toolName },
      });
    }
  }

  if (
    toolName === "apply_patch" ||
    toolName === "apply_diff" ||
    toolName === "patch"
  ) {
    const out = output as Record<string, unknown> | undefined;
    const patch = (out as any)?.patch ?? (out as any)?.diff;
    if (patch) {
      artifacts.push({
        type: "artifact",
        kind: "patch",
        path:
          typeof (out as any)?.path === "string"
            ? String((out as any).path)
            : undefined,
        content: typeof patch === "string" ? patch : safeJson(patch),
        metadata: { toolName },
      });
    }
  }

  return artifacts;
}

// ─────────────────────────────────────────────────────────────
// Prompt building
// ─────────────────────────────────────────────────────────────

/**
 * Format context items into a section string.
 */
export function formatContextSection(
  context: WorkRunContextItem[],
): string {
  return context
    .map((ctx) => {
      const header = ctx.ref
        ? `[${ctx.kind}: ${ctx.ref}]`
        : `[${ctx.kind}]`;
      return `${header}\n${ctx.content || "(no content)"}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Format context issues into a section string.
 */
export function formatIssuesSection(
  issues: Array<{
    provider: string;
    number?: number | null;
    title: string;
    body?: string | null;
  }>,
  includeBody = true,
): string {
  return issues
    .map((i) => {
      const label = `[${i.provider.toUpperCase()}${i.number ? ` #${i.number}` : ""}] ${i.title}`;
      return includeBody && i.body ? `${label}\n${i.body}` : label;
    })
    .join("\n\n---\n\n");
}

/**
 * Format context signals into a section string.
 */
export function formatSignalsSection(
  signals: Array<{
    source: string;
    level: string;
    category: string;
    title: string;
    body?: string | null;
    stackTrace?: string | null;
    eventCount?: number;
  }>,
  includeBody = true,
): string {
  return signals
    .map((s) => {
      const label = `[${s.source.toUpperCase()} ${s.level.toUpperCase()}] ${s.title}${s.eventCount && s.eventCount > 1 ? ` (${s.eventCount}x)` : ""}`;
      const parts = [label];
      if (includeBody && s.body) parts.push(s.body);
      if (includeBody && s.stackTrace) parts.push(`Stack trace:\n${s.stackTrace}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Format context files into a section string.
 */
export function formatFilesSection(
  files: Array<{ path: string }>,
): string {
  return files.map((f) => `- ${f.path}`).join("\n");
}

/**
 * Append optional sections (issues, files, attachments) to a base prompt.
 */
export function appendPromptSections(
  prompt: string,
  options: {
    contextIssues?: Array<{
      provider: string;
      number?: number | null;
      title: string;
      body?: string | null;
    }>;
    contextSignals?: Array<{
      source: string;
      level: string;
      category: string;
      title: string;
      body?: string | null;
      stackTrace?: string | null;
      eventCount?: number;
    }>;
    contextFiles?: Array<{ path: string }>;
    attachments?: FileAttachment[];
    runId?: string;
    includeIssueBody?: boolean;
  },
): string {
  let result = prompt;

  if (options.contextIssues && options.contextIssues.length > 0) {
    const issuesList = formatIssuesSection(
      options.contextIssues,
      options.includeIssueBody ?? true,
    );
    result = `${result}\n\n---\n\nContext issues:\n${issuesList}`;
  }

  if (options.contextSignals && options.contextSignals.length > 0) {
    const signalsList = formatSignalsSection(
      options.contextSignals,
      options.includeIssueBody ?? true,
    );
    result = `${result}\n\n---\n\nContext signals:\n${signalsList}`;
  }

  // Context files are no longer appended as a block — every file the user attaches arrives in
  // `prompt` as an inline `@<path>` mention (file explorer's "Add to context" auto-appends one
  // via WorkspaceInput's reactive sync). `contextFiles` stays on the options shape so the
  // user-prompt artifact metadata still carries structured file info for the UI.

  if (
    options.attachments &&
    options.attachments.length > 0 &&
    options.runId
  ) {
    const attachmentSection = buildAttachmentPrompt(
      options.attachments,
      options.runId,
    );
    if (attachmentSection) {
      result = `${result}\n\n---\n\nAttached files:\n${attachmentSection}`;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// User prompt artifact emission
// ─────────────────────────────────────────────────────────────

export async function emitUserPromptArtifact(
  onEvent: WorkRunEventHandler,
  content: string,
  options?: {
    attachments?: FileAttachment[];
    contextIssues?: Array<{
      provider: string;
      number?: number | null;
      title: string;
      body?: string | null;
    }>;
    contextSignals?: Array<{
      source: string;
      level: string;
      category: string;
      title: string;
      body?: string | null;
      stackTrace?: string | null;
      eventCount?: number;
    }>;
    contextFiles?: Array<{ path: string }>;
    contextSkills?: Array<{
      name: string;
      path?: string;
      description?: string;
      displayName?: string;
      shortDescription?: string;
      iconSmall?: string;
      iconLarge?: string;
      brandColor?: string;
      scope?: string;
    }>;
    /** The run the attachments were saved under — locates their on-disk copies. */
    runId?: string;
  },
): Promise<void> {
  await onEvent({
    type: "artifact",
    kind: "user-prompt",
    content,
    metadata: {
      source: "user",
      attachments: options?.attachments?.map((a) => {
        const captureName =
          a.sourcePath && a.sourcePath.replace(/\\/g, "/").includes("/browser-captures/")
            ? path.basename(a.sourcePath)
            : undefined;
        // Documents land in the run's upload dir (see `saveAttachments`) — except
        // .txt, which is inlined into the prompt and never written — so the
        // transcript can open the copy the agent read.
        const uploadedPath =
          options?.runId &&
          a.type === "document" &&
          path.extname(a.name).toLowerCase() !== ".txt"
            ? path.join(attachmentUploadDir(options.runId), path.basename(a.name))
            : undefined;
        return {
          name: a.name,
          type: a.type,
          mimeType: a.mimeType,
          ...(a.type === "image" && a.data
            ? { dataUrl: `data:${a.mimeType};base64,${a.data}` }
            : {}),
          ...(a.sourcePath ? { sourcePath: a.sourcePath } : {}),
          ...(captureName ? { captureName } : {}),
          ...(uploadedPath ? { path: uploadedPath } : {}),
        };
      }),
      issues: options?.contextIssues,
      signals: options?.contextSignals,
      files: options?.contextFiles,
      skills: options?.contextSkills,
    },
  });
}
