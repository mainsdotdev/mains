import { useMemo, useState } from "react";
import { Edit } from "@/components/ui/icons";
import { normalizePatchForPatchDiff } from "../../lib/patch-utils";
import { useOpenFileInEditor } from "../../hooks/use-open-file-in-editor";
import { FileIconComponent } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolDiffBody, ToolHeader } from "./_shared";

export interface ApplyPatchParams {
  /** Copilot CLI's apply_patch passes the whole `*** Begin Patch …` envelope as a string. */
  patch?: string;
}

interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

/**
 * Copilot CLI's `apply_patch` tool. The input is a single `*** Begin Patch …`
 * envelope string; the output carries a real unified git diff under
 * `detailedContent`. Renders the same collapsible PatchDiff card as Edit/Write
 * — preferring the completed output diff, falling back to the envelope so the
 * card still shows a diff while the call is still running.
 */
export function ApplyPatchDisplay({
  patch,
  output,
  isCompact = false,
}: {
  patch: string;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openFile = useOpenFileInEditor();

  // Prefer the completed output (full absolute path), since the envelope passed
  // in can be truncated to ~200 chars on the transcript event — long enough to
  // cut off the `*** Update File:` path and show a bogus filename.
  const filePath = useMemo(
    () => extractOutputFilePath(output) || extractEnvelopeFilePath(patch),
    [patch, output],
  );
  const fileName = filePath.split("/").pop() || filePath;
  const fileExt = (() => {
    const dotIdx = fileName.lastIndexOf(".");
    return dotIdx > 0 ? fileName.slice(dotIdx + 1) : undefined;
  })();

  const unifiedDiff = useMemo(() => {
    // Prefer the completed unified diff from output; fall back to the envelope
    // lines (e.g. while the call is still running and no output exists yet).
    const lines =
      extractOutputDiffLines(output) || parseEnvelopeLines(patch);
    if (lines.length === 0) return "";
    return normalizePatchForPatchDiff(
      buildUnifiedDiff(lines, fileName || "file"),
      filePath || undefined,
    );
  }, [output, patch, fileName, filePath]);

  const hasDiff = unifiedDiff.length > 0;

  return (
    <div>
      <ToolHeader
        icon={<Edit className="size-4" />}
        verb="Edited"
        hasDetails={hasDiff}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span
          role={filePath ? "link" : undefined}
          title={filePath ? "Open in editor" : undefined}
          onClick={(e) => {
            if (!filePath) return;
            e.stopPropagation();
            openFile(filePath);
          }}
          className={`inline-flex items-center gap-1 min-w-0 ${filePath ? "cursor-pointer hover:underline hover:text-primary-950 hover:dark:text-primary" : ""} ${TOOL_ROW_TEXT}`}
        >
          {filePath && (
            <FileIconComponent
              extension={fileExt}
              fileName={fileName}
              className="size-3.5 shrink-0"
            />
          )}
          <span className="truncate">{fileName || "patch"}</span>
        </span>
      </ToolHeader>

      {hasDiff && (
        <ToolCollapse
          isExpanded={isExpanded}
          className="rounded-md border border-primary-200/50 dark:border-primary-700/30"
        >
          <ToolDiffBody patch={unifiedDiff} />
        </ToolCollapse>
      )}
    </div>
  );
}

// --- helpers ---

function parseOutputObject(output: unknown): Record<string, unknown> | null {
  if (!output) return null;
  let parsed: unknown = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return typeof parsed === "object" && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;
}

/** `*** Update File: <path>` / `Add File` / `Delete File` / `Move to`. */
function extractEnvelopeFilePath(patch: string): string {
  if (!patch) return "";
  const m = patch.match(/\*\*\* (?:Update|Add|Delete|Move to) File: (.+)/);
  return m ? m[1].trim() : "";
}

/** `Modified 1 file(s): <path>` summary, or the `+++ b/<path>` diff header. */
function extractOutputFilePath(output: unknown): string {
  const obj = parseOutputObject(output);
  if (!obj) return "";
  if (typeof obj.content === "string") {
    const m = obj.content.match(/file\(s\):\s*(.+)/);
    if (m) return m[1].split(",")[0].trim();
  }
  if (typeof obj.detailedContent === "string") {
    const m = obj.detailedContent.match(/^\+\+\+ b\/(.+)$/m);
    if (m) return m[1].trim();
  }
  return "";
}

/** Diff lines from output.detailedContent (a real unified diff). */
function extractOutputDiffLines(output: unknown): DiffLine[] | null {
  const obj = parseOutputObject(output);
  const content =
    obj && typeof obj.detailedContent === "string" ? obj.detailedContent : "";
  if (!content) return null;

  const isUnifiedDiff =
    /^(diff |--- |\+\+\+ |@@)/m.test(content);
  if (!isUnifiedDiff) {
    // Not a recognized diff — render every non-empty line as an addition.
    const lines = content
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => ({ type: "add" as const, text: l }));
    return lines.length > 0 ? lines : null;
  }

  const lines = content
    .split("\n")
    .filter(
      (l) =>
        !l.startsWith("diff ") &&
        !l.startsWith("index ") &&
        !l.startsWith("--- ") &&
        !l.startsWith("+++ ") &&
        !l.startsWith("@@") &&
        l !== "",
    )
    .map(toDiffLine);
  return lines.length > 0 ? lines : null;
}

/** Diff lines from the `*** Begin Patch …` envelope (input). */
function parseEnvelopeLines(patch: string): DiffLine[] {
  if (!patch || !patch.includes("*** Begin Patch")) return [];
  const lines: DiffLine[] = [];
  let started = false;
  for (const l of patch.split("\n")) {
    if (l.startsWith("*** Begin Patch")) continue;
    if (l.startsWith("*** End Patch")) break;
    // `*** Update File:` / `*** Add File:` etc. mark the start of the body.
    if (l.startsWith("*** ")) {
      started = true;
      continue;
    }
    if (!started) continue;
    if (l.startsWith("@@")) continue; // hunk separator
    lines.push(toDiffLine(l));
  }
  return lines;
}

function toDiffLine(l: string): DiffLine {
  if (l.startsWith("+")) return { type: "add", text: l.slice(1) };
  if (l.startsWith("-")) return { type: "remove", text: l.slice(1) };
  return { type: "context", text: l.startsWith(" ") ? l.slice(1) : l };
}

/**
 * Rebuild a single-hunk unified diff from clean +/-/context lines so PatchDiff
 * never has to parse the agent's absolute paths (which can contain spaces).
 * Mirrors the approach in edit-display/write-display.
 */
function buildUnifiedDiff(lines: DiffLine[], fileName: string): string {
  const hunkLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const l of lines) {
    for (const part of l.text.split("\n")) {
      if (l.type === "add") {
        hunkLines.push(`+${part}`);
        newCount++;
      } else if (l.type === "remove") {
        hunkLines.push(`-${part}`);
        oldCount++;
      } else {
        hunkLines.push(` ${part}`);
        oldCount++;
        newCount++;
      }
    }
  }
  return [
    `diff --git a/${fileName} b/${fileName}`,
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...hunkLines,
  ].join("\n");
}
