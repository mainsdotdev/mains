import { useMemo, useState } from "react";
import { Edit } from "@/components/ui/icons";
import { normalizePatchForPatchDiff } from "../../lib/patch-utils";
import { useOpenFileInEditor } from "../../hooks/use-open-file-in-editor";
import { FileIconComponent } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolDiffBody, ToolHeader } from "./_shared";

export interface EditParams {
  // Claude params
  file_path?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  // Copilot params
  path?: string;
  old_str?: string;
  new_str?: string;
}

interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

export function EditDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: EditParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openFile = useOpenFileInEditor();

  const filePath = params.file_path ?? params.path ?? "";
  const fileName = filePath.split("/").pop() || filePath;
  const fileExt = (() => {
    const dotIdx = fileName.lastIndexOf(".");
    return dotIdx > 0 ? fileName.slice(dotIdx + 1) : undefined;
  })();
  const {
    lines: patchLines,
    // added,
    // removed,
  } = useMemo(() => parsePatch(output, params), [output, params]);
  const hasDiff = patchLines.length > 0;

  const unifiedDiff = useMemo(() => {
    if (!hasDiff) return "";
    return normalizePatchForPatchDiff(buildUnifiedDiff(patchLines, fileName), filePath || undefined);
  }, [patchLines, hasDiff, fileName, filePath]);

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
          <span className="truncate">{fileName}</span>
        </span>
        {/* {(added > 0 || removed > 0) && (
          <span className={`text-xs shrink-0 ${TOOL_ROW_TEXT}`}>
            {added > 0 && (
              <Text as="span" size="inherit" tone="success">
                +{added}
              </Text>
            )}
            {added > 0 && removed > 0 && " "}
            {removed > 0 && (
              <Text as="span" size="inherit" tone="danger">-{removed}</Text>
            )}
          </span>
        )} */}
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

function buildUnifiedDiff(lines: DiffLine[], fileName: string): string {
  // Each physical line must carry +/-/' ' prefix. Embedded \n in text otherwise emits raw
  // lines; a continuation starting with `--- ` makes @pierre/diffs treat it as a second file
  // in unified mode (no diff --git).
  const hunkLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const l of lines) {
    const parts = l.text.split("\n");
    for (const part of parts) {
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
  // `diff --git` forces git-style parsing so stray `---`-looking lines inside hunks never
  // start a new logical file.
  return [
    `diff --git a/${fileName} b/${fileName}`,
    `--- a/${fileName}`,
    `+++ b/${fileName}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...hunkLines,
  ].join("\n");
}

function parsePatch(
  output: unknown,
  params: EditParams,
): { lines: DiffLine[]; added: number; removed: number } {
  // Try structuredPatch from output first (Claude)
  const patch = extractPatchLines(output);
  if (patch.length > 0) {
    return parsePatchLines(patch);
  }

  // Try detailedContent unified diff from output (Copilot)
  const unifiedLines = extractUnifiedDiff(output);
  if (unifiedLines.length > 0) {
    return parsePatchLines(unifiedLines);
  }

  // Fallback: build diff from old_string/new_string (Claude) or old_str/new_str (Copilot)
  const oldStr = params.old_string ?? params.old_str;
  const newStr = params.new_string ?? params.new_str;
  if (oldStr || newStr) {
    const oldLines = (oldStr || "").split("\n");
    const newLines = (newStr || "").split("\n");
    const lines: DiffLine[] = [];
    for (const l of oldLines) lines.push({ type: "remove", text: l });
    for (const l of newLines) lines.push({ type: "add", text: l });
    return { lines, added: newLines.length, removed: oldLines.length };
  }

  return { lines: [], added: 0, removed: 0 };
}

function extractPatchLines(output: unknown): string[] {
  if (!output) return [];

  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    const sp = obj.structuredPatch;
    if (Array.isArray(sp)) {
      const allLines: string[] = [];
      for (const hunk of sp) {
        if (
          typeof hunk === "object" &&
          hunk !== null &&
          Array.isArray((hunk as any).lines)
        ) {
          allLines.push(...(hunk as any).lines);
        }
      }
      return allLines;
    }
  }

  return [];
}

function extractUnifiedDiff(output: unknown): string[] {
  if (!output) return [];

  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.detailedContent === "string") {
      const content = obj.detailedContent;

      // If it doesn't look like a unified diff, treat all lines as additions (new file)
      const isUnifiedDiff =
        content.startsWith("--- ") ||
        content.startsWith("diff ") ||
        content.startsWith("@@");
      if (!isUnifiedDiff) {
        return content
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => `+${l}`);
      }

      // Standard unified diff — skip headers, keep +/-/context lines
      return content.split("\n").filter((l) => {
        if (
          l.startsWith("diff ") ||
          l.startsWith("index ") ||
          l.startsWith("--- ") ||
          l.startsWith("+++ ") ||
          l.startsWith("@@")
        )
          return false;
        if (l === "") return false;
        return true;
      });
    }
  }

  return [];
}

function parsePatchLines(raw: string[]): {
  lines: DiffLine[];
  added: number;
  removed: number;
} {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;

  for (const l of raw) {
    if (l.startsWith("+")) {
      lines.push({ type: "add", text: l.slice(1) });
      added++;
    } else if (l.startsWith("-")) {
      lines.push({ type: "remove", text: l.slice(1) });
      removed++;
    } else {
      lines.push({ type: "context", text: l.startsWith(" ") ? l.slice(1) : l });
    }
  }

  return { lines, added, removed };
}
