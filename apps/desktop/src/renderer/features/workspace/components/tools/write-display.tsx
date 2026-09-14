import { useMemo, useState } from "react";
import {  Write } from "@/components/ui/icons";
import { normalizePatchForPatchDiff } from "../../lib/patch-utils";
import { useOpenFileInEditor } from "../../hooks/use-open-file-in-editor";
import { FileIconComponent } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolDiffBody, ToolHeader } from "./_shared";

export interface WriteParams {
  file_path?: string;
  path?: string;
  content?: string;
  /** Copilot CLI's `create` tool sends the new file body under `file_text`. */
  file_text?: string;
}

interface StructuredHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

function extractDetailedContent(output: unknown): string | undefined {
  if (!output) return undefined;
  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.detailedContent === "string") return obj.detailedContent;
  }
  return undefined;
}

function parseStructuredPatchOutput(output: unknown): {
  hunks: StructuredHunk[];
  outputFilePath?: string;
} | null {
  if (!output) return null;
  let parsed: unknown = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const sp = obj.structuredPatch;
  if (!Array.isArray(sp) || sp.length === 0) return null;

  const hunks: StructuredHunk[] = [];
  for (const h of sp) {
    if (typeof h !== "object" || h === null) continue;
    const hunk = h as Record<string, unknown>;
    const lines = hunk.lines;
    if (!Array.isArray(lines)) continue;
    hunks.push({
      oldStart: Number(hunk.oldStart) || 0,
      oldLines: Number(hunk.oldLines) || 0,
      newStart: Number(hunk.newStart) || 0,
      newLines: Number(hunk.newLines) || 0,
      lines: lines.map((l) => (typeof l === "string" ? l : String(l))),
    });
  }
  if (hunks.length === 0) return null;

  return {
    hunks,
    outputFilePath: typeof obj.filePath === "string" ? obj.filePath : undefined,
  };
}

/** One unified-diff physical line (prefix + body segment). */
function expandStructuredHunkLine(line: string): string[] {
  if (line.startsWith("\\")) return [line];
  const prefix = line[0];
  if (prefix === "+" || prefix === "-" || prefix === " ") {
    const body = line.slice(1);
    const segs = body.split("\n");
    return segs.map((seg) => `${prefix}${seg}`);
  }
  const segs = line.split("\n");
  return segs.map((seg) => (seg === "" ? " " : ` ${seg}`));
}

function structuredPatchToUnifiedDiff(
  hunks: StructuredHunk[],
  fileName: string,
): string {
  const parts = [
    `diff --git a/${fileName} b/${fileName}`,
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
  ];
  for (const h of hunks) {
    parts.push(
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    );
    for (const line of h.lines) {
      parts.push(...expandStructuredHunkLine(line));
    }
  }
  return parts.join("\n");
}

function countStructuredPatchChanges(hunks: StructuredHunk[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}

export function WriteDisplay({
  params,
  output,
}: {
  params: WriteParams;
  output?: unknown;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openFile = useOpenFileInEditor();

  const parsedPatch = useMemo(
    () => parseStructuredPatchOutput(output),
    [output],
  );

  const filePath =
    params.file_path ?? params.path ?? parsedPatch?.outputFilePath ?? "";
  const content = params.content ?? params.file_text ?? extractDetailedContent(output) ?? "";
  const fileName = filePath.split("/").pop() || filePath || "file";
  const fileExt = (() => {
    const dotIdx = fileName.lastIndexOf(".");
    return dotIdx > 0 ? fileName.slice(dotIdx + 1) : undefined;
  })();

  const {
    unifiedDiff,
    // added,
    // removed,
    // lineCount,
    hasDiff,
  } = useMemo(() => {
    if (parsedPatch) {
      const { added: a, removed: r } = countStructuredPatchChanges(
        parsedPatch.hunks,
      );
      const raw = structuredPatchToUnifiedDiff(parsedPatch.hunks, fileName);
      return {
        unifiedDiff: normalizePatchForPatchDiff(raw, filePath || undefined),
        added: a,
        removed: r,
        lineCount: 0,
        hasDiff: true,
      };
    }
    if (!content) {
      return {
        unifiedDiff: "",
        added: 0,
        removed: 0,
        lineCount: 0,
        hasDiff: false,
      };
    }
    const lines = content.split("\n");
    const addedLines = lines.flatMap((l) =>
      l.split("\n").map((seg) => `+${seg}`),
    );
    const raw = [
      `diff --git a/${fileName} b/${fileName}`,
      `new file mode 100644`,
      `--- /dev/null`,
      `+++ b/${fileName}`,
      `@@ -0,0 +1,${addedLines.length} @@`,
      ...addedLines,
    ].join("\n");
    return {
      unifiedDiff: normalizePatchForPatchDiff(raw, filePath || undefined),
      added: addedLines.length,
      removed: 0,
      lineCount: addedLines.length,
      hasDiff: true,
    };
  }, [parsedPatch, content, fileName, filePath]);

  return (
    <div>
      <ToolHeader
        icon={<Write className="size-4" />}
        verb="Wrote"
        hasDetails={hasDiff}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
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
          <span className="truncate">{fileName}</span>
        </span>
        {/* {parsedPatch ? (
          (added > 0 || removed > 0) && (
            <span className={`text-xs shrink-0 ${TOOL_ROW_TEXT}`}>
              {added > 0 && (
                <Text as="span" size="inherit" tone="success">+{added}</Text>
              )}
              {added > 0 && removed > 0 && " "}
              {removed > 0 && (
                <Text as="span" size="inherit" tone="danger">-{removed}</Text>
              )}
            </span>
          )
        ) : (
          lineCount > 0 && (
            <Text as="span" size="xs" tone="success" className="shrink-0">
              +{lineCount}
            </Text>
          )
        )} */}
      </ToolHeader>

      {unifiedDiff && (
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
