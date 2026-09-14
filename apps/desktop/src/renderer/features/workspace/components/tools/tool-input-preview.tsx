import { coerceToolOutput } from "../../lib/parse-tool-content";
import { Text } from "@/components/ui";
import { FileIconComponent } from "@/components/ui/icons";
import {
  buildApprovalDiffPreviews,
  type ApprovalDiffKind,
} from "../../lib/tool-approval-diff";
import { parseShellCommandPreview } from "../../lib/shell-command-preview";
import { CODE_FONT_SIZE_CSS } from "@/lib/appearance-fonts";
import { ToolDiffBody } from "./_shared";

interface ToolInputPreviewProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
}

export function ToolInputPreview({ toolName, toolInput }: ToolInputPreviewProps) {
  if (!toolInput || Object.keys(toolInput).length === 0) return null;

  // Normalize: if toolInput is { args: "<json>" }, parse it
  const input = normalizeInput(toolInput);

  // Case-insensitive lookup (Copilot sends "edit", Claude sends "Edit")
  const canonName = canonicalRendererName(toolName);
  const renderer = RENDERERS[canonName]
    ?? (toolName.startsWith("[permission:") ? renderPermissionFallback : renderFallback);
  const ownsSurface = SELF_CONTAINED_RENDERERS.has(canonName);
  return (
    <div
      className={`text-xs rounded-lg ${
        ownsSurface
          ? ""
          : "max-h-48 space-y-2 overflow-auto bg-primary-50 dark:bg-primary/5"
      }`}
    >
      {renderer(input)}
    </div>
  );
}

// --- helpers ---

/** If input is { args: "<json string>" }, parse args and merge into top level */
function normalizeInput(input: Record<string, unknown>): Record<string, unknown> {
  if (typeof input.args === "string") {
    const parsed = coerceToolOutput(input.args);
    if (typeof parsed === "object" && parsed !== null) return { ...input, ...parsed };
  }
  return input;
}

function filePath(input: Record<string, unknown>): string {
  return str(
    input.fileName ??
      input.filePath ??
      input.file_path ??
      input.path ??
      input.file ??
      "",
  );
}

/** Compact filename used by read-only previews and the mutation path row. */
function basenameDisplay(p: string): string {
  if (!p) return "";
  const normalized = p.replace(/\\/g, "/").trim();
  const withoutQuery = normalized.split("?")[0] ?? normalized;
  const parts = withoutQuery.split("/").filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1]! : p;
}

function str(val: unknown, maxLen = 300): string {
  const s = typeof val === "string" ? val : String(val ?? "");
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Text as="span" size="inherit" tone="muted" className="font-mono break-all">
      {children}
    </Text>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text as="span" size="xs" tone="subtle" className="capitalize tracking-wide">
      {children}
    </Text>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <Text as="pre" size="inherit" tone="muted" className="whitespace-pre-wrap break-all px-3 py-2 mt-1">
      {children}
    </Text>
  );
}

function ShellCommandPreview({ input }: { input: Record<string, unknown> }) {
  const rawCommand = typeof input.command === "string"
    ? input.command
    : String(input.command ?? "");
  const preview = parseShellCommandPreview(rawCommand);
  const cwd = typeof input.cwd === "string" ? input.cwd : "";
  const hasMeta = !!preview.shell || !!cwd || !!input.timeout;

  return (
    <div className="space-y-1.5">
      {!!input.description && (
        <Text
          as="div"
          size="xs"
          tone="subtle"
          className="px-0.5 leading-relaxed whitespace-pre-wrap wrap-break-word"
        >
          {str(input.description, 500)}
        </Text>
      )}
      <div
        className="overflow-hidden rounded-xl glass-outline bg-primary-50 dark:bg-primary/5"
        title={preview.shell ? rawCommand : undefined}
      >
        {hasMeta && (
          <div className="flex min-w-0 items-center gap-2 border-b border-primary-200/50 px-2.5 py-2 dark:border-primary-700/30">
            {preview.shell && (
              <Text as="span" size="xxs" tone="muted" className="shrink-0 font-mono">
                {preview.shell}
              </Text>
            )}
            {cwd && (
              <Text
                as="span"
                size="xxs"
                tone="faint"
                className="min-w-0 truncate font-mono"
                title={cwd}
              >
                {cwd}
              </Text>
            )}
            {!!input.timeout && (
              <Text as="span" size="xxs" tone="faint" className="ml-auto shrink-0">
                {String(input.timeout)}ms
              </Text>
            )}
          </div>
        )}
        <Text
          as="pre"
          size="inherit"
          tone="muted"
          className="noscrollbar max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word px-3 py-2.5 font-mono leading-relaxed"
          style={{ fontSize: CODE_FONT_SIZE_CSS }}
        >
          <span
            aria-hidden
            className="select-none text-primary-400 dark:text-primary-600"
          >
            ${" "}
          </span>
          {preview.command}
        </Text>
      </div>
    </div>
  );
}

function FileMutationPreview({
  kind,
  input,
}: {
  kind: ApprovalDiffKind;
  input: Record<string, unknown>;
}) {
  const previews = buildApprovalDiffPreviews(kind, input);

  return (
    <div
      className={`noscrollbar space-y-3 ${
        previews.length > 1 ? "max-h-80 overflow-y-auto" : ""
      }`}
    >
      {previews.map((preview, index) => (
        <FileMutationCard
          key={`${preview.filePath}:${index}`}
          filePath={preview.filePath}
          patch={preview.patch}
          shareScroll={previews.length > 1}
        />
      ))}
    </div>
  );
}

function FileMutationCard({
  filePath,
  patch,
  shareScroll,
}: {
  filePath: string;
  patch: string;
  shareScroll: boolean;
}) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const fileName = basenameDisplay(normalizedPath) || "File";
  const directory = normalizedPath.slice(0, -fileName.length);
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".") + 1)
    : undefined;

  return (
    <div className="space-y-1.5">
      <div
        className="flex min-w-0 items-center gap-1.5 px-0.5"
        title={normalizedPath || undefined}
      >
        <FileIconComponent
          extension={extension}
          fileName={fileName}
          className="size-3.5 shrink-0"
        />
        <Text
          as="div"
          size="xs"
          tone="muted"
          className="flex min-w-0 font-mono"
        >
          {directory && (
            <span className="min-w-0 truncate text-primary-500 dark:text-primary-500">
              {directory}
            </span>
          )}
          <span className="shrink-0">{fileName}</span>
        </Text>
      </div>
      {patch && (
        <div className="overflow-hidden rounded-md border border-primary-200/50 dark:border-primary-700/30">
          <ToolDiffBody
            patch={patch}
            className={shareScroll ? "max-h-none" : undefined}
          />
        </div>
      )}
    </div>
  );
}

// --- per-tool renderers ---

type Renderer = (input: Record<string, unknown>) => React.ReactNode;

const RENDERERS: Record<string, Renderer> = {
  Bash: (input) => <ShellCommandPreview input={input} />,

  Read: (input) => (
    <>
      <div>
        <Label>file</Label>{" "}
        <Mono>{basenameDisplay(str(input.file_path))}</Mono>
      </div>
      {!!(input.offset || input.limit) && (
        <Text as="div" size="xxs" tone="faint">
          {input.offset ? `from line ${input.offset}` : ""}
          {input.offset && input.limit ? ", " : ""}
          {input.limit ? `${input.limit} lines` : ""}
        </Text>
      )}
    </>
  ),

  Write: (input) => <FileMutationPreview kind="write" input={input} />,

  // Copilot CLI file-creation tool: input is { file_text, path }. Show the
  // filename + the new content as an all-added diff (mirrors Write) instead of
  // dumping the entire file_text as a raw param value.
  Create: (input) => <FileMutationPreview kind="write" input={input} />,

  Edit: (input) => <FileMutationPreview kind="edit" input={input} />,

  Delete: (input) => <FileMutationPreview kind="delete" input={input} />,

  Apply_patch: (input) => (
    <FileMutationPreview kind="apply-patch" input={input} />
  ),

  // Copilot CLI's sql tool: { description, query } (session-state todo DB).
  Sql: (input) => (
    <>
      {!!input.description && (
        <Text as="div" size="inherit" tone="subtle" className="px-3 pt-2 leading-relaxed whitespace-pre-wrap wrap-break-word">
          {str(input.description, 300)}
        </Text>
      )}
      <CodeBlock>{str(input.query, 1200)}</CodeBlock>
    </>
  ),

  Grep: (input) => (
    <>
      <div>
        <Label>pattern</Label>{" "}
        <Mono>{str(input.pattern)}</Mono>
      </div>
      {!!input.path && (
        <div>
          <Label>path</Label> <Mono>{str(input.path)}</Mono>
        </div>
      )}
      {!!input.glob && (
        <div>
          <Label>glob</Label> <Mono>{str(input.glob)}</Mono>
        </div>
      )}
    </>
  ),

  // Copilot CLI's ripgrep tool: { pattern, paths, output_mode } where `paths`
  // is usually a single path string (sometimes an array).
  Rg: (input) => {
    const paths = Array.isArray(input.paths)
      ? input.paths.map((p) => String(p))
      : typeof input.paths === "string" && input.paths
        ? [input.paths]
        : input.path
          ? [String(input.path)]
          : [];
    return (
      <>
        <div>
          <Label>pattern</Label>{" "}
          <Mono>{str(input.pattern ?? input.query ?? input.regex ?? "")}</Mono>
        </div>
        {paths.length > 0 && (
          <div>
            <Label>path</Label>{" "}
            <Mono>{paths.map(basenameDisplay).join(", ")}</Mono>
          </div>
        )}
        {!!input.glob && (
          <div>
            <Label>glob</Label> <Mono>{str(input.glob)}</Mono>
          </div>
        )}
        {!!input.output_mode && (
          <Text as="div" size="xxs" tone="faint">
            {str(input.output_mode)}
          </Text>
        )}
      </>
    );
  },

  Glob: (input) => (
    <>
      <div>
        <Label>pattern</Label>{" "}
        <Mono>{str(input.pattern)}</Mono>
      </div>
      {!!input.path && (
        <div>
          <Label>path</Label> <Mono>{str(input.path)}</Mono>
        </div>
      )}
    </>
  ),

  WebFetch: (input) => (
    <>
      <div>
        <Label>url</Label> <Mono>{str(input.url)}</Mono>
      </div>
      {!!input.prompt && (
        <Text as="div" size="inherit" tone="subtle" className="mt-1">
          {str(input.prompt)}
        </Text>
      )}
    </>
  ),

  WebSearch: (input) => (
    <div>
      <Label>query</Label>{" "}
      <Mono>{str(input.query)}</Mono>
    </div>
  ),

  Task: (input) => (
    <>
      {!!input.subagent_type && (
        <div>
          <Label>agent</Label>{" "}
          <Text as="span" size="inherit" tone="muted">
            {str(input.subagent_type)}
          </Text>
        </div>
      )}
      {!!input.description && (
        <Text as="div" size="inherit" tone="subtle">
          {str(input.description)}
        </Text>
      )}
    </>
  ),

   Plan: (input) => (
    <div className="px-3 py-2 space-y-1">
      {!!input.name && (
        <Text as="div" size="sm" tone="secondary" weight="medium">
          {str(input.name)}
        </Text>
      )}
      {!!input.overview && (
        <Text as="div" size="inherit" tone="subtle">
          {str(input.overview, 500)}
        </Text>
      )}
      {!!input.plan && (
        <Text as="pre" size="inherit" tone="muted" className="whitespace-pre-wrap wrap-break-word leading-relaxed mt-1">
          {str(input.plan, 2000)}
        </Text>
      )}
    </div>
  ),

  AskUser: (input) => (
    <Text as="div" size="inherit" tone="muted" className="px-3 py-2">
      {str(input.question, 500)}
    </Text>
  ),

  Ask_user: (input) => (
    <Text as="div" size="inherit" tone="muted" className="px-3 py-2">
      {str(input.question, 500)}
    </Text>
  ),

  NotebookEdit: (input) => (
    <>
      <div>
        <Label>notebook</Label>{" "}
        <Mono>{basenameDisplay(str(input.notebook_path))}</Mono>
      </div>
      {!!input.edit_mode && (
        <div>
          <Label>mode</Label>{" "}
          <Text as="span" size="inherit" tone="muted">
            {str(input.edit_mode)}
          </Text>
        </div>
      )}
      {!!input.new_source && (
        <CodeBlock>{str(input.new_source, 400)}</CodeBlock>
      )}
    </>
  ),

  "[permission:write]": (input) => (
    <FileMutationPreview
      kind={permissionDiffKind(input.kind)}
      input={input}
    />
  ),

  "[permission:shell]": (input) => <ShellCommandPreview input={input} />,

  "[permission:read]": (input) => (
    <div className="px-3 py-2">
      <Label>file</Label> <Mono>{basenameDisplay(filePath(input))}</Mono>
    </div>
  ),
};

const RENDERER_ALIASES: Record<string, string> = {
  bash: "Bash",
  shell: "Bash",
  edit: "Edit",
  replace: "Edit",
  edit_file: "Edit",
  write: "Write",
  writeifempty: "Write",
  write_file: "Write",
  create_file: "Write",
  create: "Create",
  delete: "Delete",
  delete_file: "Delete",
  apply_patch: "Apply_patch",
  "[permission:write]": "[permission:write]",
};

const SELF_CONTAINED_RENDERERS = new Set([
  "Bash",
  "Edit",
  "Write",
  "Create",
  "Delete",
  "Apply_patch",
  "[permission:shell]",
  "[permission:write]",
]);

function canonicalRendererName(toolName: string): string {
  return RENDERER_ALIASES[toolName.toLowerCase()]
    ?? (RENDERERS[toolName]
      ? toolName
      : toolName.charAt(0).toUpperCase() + toolName.slice(1));
}

function permissionDiffKind(kind: unknown): ApprovalDiffKind {
  if (kind === "add" || kind === "create") return "write";
  if (kind === "delete") return "delete";
  return "edit";
}

function renderPermissionFallback(input: Record<string, unknown>): React.ReactNode {
  const { kind: _, toolCallId: __, ...rest } = input;
  return renderFallback(rest);
}

function renderFallback(input: Record<string, unknown>): React.ReactNode {
  try {
    const s = JSON.stringify(input, null, 2);
    return (
      <Text as="pre" size="inherit" tone="subtle" className="whitespace-pre-wrap break-all">
        {s.length > 500 ? s.slice(0, 500) + "\n…" : s}
      </Text>
    );
  } catch {
    return null;
  }
}
