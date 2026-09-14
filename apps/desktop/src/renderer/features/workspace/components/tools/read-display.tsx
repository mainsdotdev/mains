import { useState } from "react";
import { Read } from "@/components/ui/icons";
import { useOpenFileInEditor } from "../../hooks/use-open-file-in-editor";
import { FileIconComponent } from "@/components/ui/icons";
import { TOOL_ROW_TEXT, ToolCollapse, ToolHeader, ToolOutputBody } from "./_shared";
import { coerceToolOutput } from "../../lib/parse-tool-content";
import { shortFileName } from "../../lib/path-utils";

export interface ReadParams {
  // Claude params
  file_path?: string;
  offset?: number;
  limit?: number;
  // Copilot params
  path?: string;
}

export function ReadDisplay({
  params,
  output,
  isCompact = false,
}: {
  params: ReadParams;
  output?: unknown;
  isCompact?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const openFile = useOpenFileInEditor();

  const { content, numLines } = parseReadOutput(output);
  const hasContent = !!content;
  const fullFilePath =
    params.file_path ||
    params.path ||
    ((params as any)._title &&
    ((params as any)._title.includes("/") ||
      (params as any)._title.includes("."))
      ? (params as any)._title
      : "") ||
    "";
  const fileNameOnly = fullFilePath.split("/").pop() || fullFilePath;
  const fileExt = (() => {
    const dotIdx = fileNameOnly.lastIndexOf(".");
    return dotIdx > 0 ? fileNameOnly.slice(dotIdx + 1) : undefined;
  })();

  return (
    <div>
      <ToolHeader
        icon={<Read className="size-4" />}
        verb="Read"
        hasDetails={hasContent}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((v) => !v)}
        isCompact={isCompact}
      >
        <span
          role={fullFilePath ? "link" : undefined}
          title={fullFilePath ? "Open in editor" : undefined}
          onClick={(e) => {
            if (!fullFilePath) return;
            e.stopPropagation();
            openFile(fullFilePath);
          }}
          className={`min-w-0 inline-flex items-center gap-1 text-left ${fullFilePath ? "cursor-pointer hover:underline hover:text-primary-950 hover:dark:text-primary" : ""} ${TOOL_ROW_TEXT}`}
        >
          {fullFilePath && (
            <FileIconComponent
              extension={fileExt}
              fileName={fileNameOnly}
              className="size-3.5 shrink-0"
            />
          )}
          <code className="min-w-0 font-sans truncate">
            {shortFileName(fullFilePath)}
          </code>
        </span>
        {numLines > 0 && (
          <span className={`shrink-0 ${TOOL_ROW_TEXT}`}>
            ({numLines} lines)
          </span>
        )}
      </ToolHeader>

      {hasContent && (
        <ToolCollapse isExpanded={isExpanded}>
          <ToolOutputBody className="text-xs font-mono whitespace-pre-wrap">
            {content}
          </ToolOutputBody>
        </ToolCollapse>
      )}
    </div>
  );
}

function parseReadOutput(output: unknown): {
  content: string | null;
  numLines: number;
} {
  const parsed = coerceToolOutput(output);
  if (typeof parsed === "string") {
    return {
      content: parsed,
      numLines: parsed.split("\n").length,
    };
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;

    // Handle { file: { content, numLines, ... } } structure
    if (typeof obj.file === "object" && obj.file !== null) {
      const file = obj.file as Record<string, unknown>;
      const content = typeof file.content === "string" ? file.content : null;
      const numLines = typeof file.numLines === "number" ? file.numLines : 0;
      return { content, numLines };
    }

    // Fallback: direct content/numLines (Copilot uses this format)
    const content = typeof obj.content === "string" ? obj.content : null;
    const numLines =
      typeof obj.numLines === "number"
        ? obj.numLines
        : content
          ? content.split("\n").filter((l) => l.length > 0).length
          : 0;
    return { content, numLines };
  }

  return { content: null, numLines: 0 };
}
